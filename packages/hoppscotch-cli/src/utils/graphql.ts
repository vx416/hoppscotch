import {
  GraphQLAuthTokens,
  GraphQLPingResult,
  GraphQLRequestOptions,
  GraphQLRequestResult,
} from "../types/graphql";

const DEFAULT_GRAPHQL_SERVER_URL = "https://api.hoppscotch.io";

const extractErrorMessage = (body: unknown, statusText: string, status: number) => {
  if (
    body &&
    typeof body === "object" &&
    "message" in body &&
    typeof (body as { message?: unknown }).message === "string"
  ) {
    return (body as { message: string }).message;
  }

  if (
    body &&
    typeof body === "object" &&
    "error" in body &&
    typeof (body as { error?: unknown }).error === "string"
  ) {
    return (body as { error: string }).error;
  }

  return statusText || `HTTP ${status}`;
};

const parseJsonSafely = async <T>(response: Response): Promise<T | null> => {
  const raw = await response.text().catch(() => "");
  if (!raw.trim()) return null;

  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

export const normalizeGraphQLServerUrl = (serverUrl: string) => {
  const trimmed = serverUrl.trim();
  if (trimmed.endsWith("/graphql")) return trimmed;
  return trimmed.replace(/\/$/, "") + "/graphql";
};

const buildBackendUrl = (serverUrl: string, endpointPath: string) => {
  const url = new URL(normalizeGraphQLServerUrl(serverUrl));
  const basePath = url.pathname.replace(/\/graphql$/, "");
  const normalizedEndpoint = endpointPath.startsWith("/")
    ? endpointPath
    : `/${endpointPath}`;
  url.pathname = `${basePath.replace(/\/$/, "")}${normalizedEndpoint}`;
  return url.toString();
};

const getSetCookies = (headers: Headers) => {
  const headersWithSetCookie = headers as Headers & {
    getSetCookie?: () => string[];
  };

  if (typeof headersWithSetCookie.getSetCookie === "function") {
    const setCookies = headersWithSetCookie.getSetCookie();
    if (Array.isArray(setCookies) && setCookies.length > 0) {
      return setCookies;
    }
  }

  const singleHeader = headers.get("set-cookie");
  return singleHeader ? [singleHeader] : [];
};

const extractCookieValue = (setCookieHeaders: string[], cookieName: string) => {
  for (const header of setCookieHeaders) {
    const cookiePair = header.split(";")[0];
    const separatorIndex = cookiePair.indexOf("=");

    if (separatorIndex === -1) continue;

    const key = cookiePair.slice(0, separatorIndex).trim();
    if (key !== cookieName) continue;

    return cookiePair.slice(separatorIndex + 1).trim();
  }

  return undefined;
};

const isUnauthorizedGraphQLResult = <T>(result: GraphQLRequestResult<T>) => {
  if (result.status === 401) return true;

  const errorMessage = result.errors?.map((error) => error.message).join("; ") ?? "";
  return /unauthorized|invalid access token|token expired/i.test(errorMessage);
};

export const refreshGraphQLTokens = async (
  options: GraphQLRequestOptions
): Promise<
  | { ok: true; tokens: GraphQLAuthTokens; serverUrl: string }
  | { ok: false; serverUrl: string; error: string }
> => {
  const serverUrl = options.serverUrl || DEFAULT_GRAPHQL_SERVER_URL;
  const normalizedServerUrl = normalizeGraphQLServerUrl(serverUrl);

  if (!options.refreshToken) {
    return {
      ok: false,
      serverUrl: normalizedServerUrl,
      error:
        "No refresh token configured. Run `hopp config set refreshToken <token>` first.",
    };
  }

  try {
    const response = await fetch(buildBackendUrl(serverUrl, "/v1/auth/refresh"), {
      method: "GET",
      headers: {
        accept: "application/json",
        cookie: `refresh_token=${encodeURIComponent(options.refreshToken)}`,
      },
    });

    const body = await parseJsonSafely<{
      message?: string;
      error?: string;
    }>(response);

    if (!response.ok) {
      return {
        ok: false,
        serverUrl: normalizedServerUrl,
        error: extractErrorMessage(body, response.statusText, response.status),
      };
    }

    const setCookies = getSetCookies(response.headers);
    const token = extractCookieValue(setCookies, "access_token");
    const refreshToken = extractCookieValue(setCookies, "refresh_token");

    if (!token || !refreshToken) {
      return {
        ok: false,
        serverUrl: normalizedServerUrl,
        error:
          "Refresh endpoint did not return new access and refresh tokens.",
      };
    }

    return {
      ok: true,
      serverUrl: normalizedServerUrl,
      tokens: {
        token,
        refreshToken,
      },
    };
  } catch (error) {
    return {
      ok: false,
      serverUrl: normalizedServerUrl,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

export const graphqlRequest = async <T>(
  query: string,
  variables: Record<string, unknown> = {},
  options: GraphQLRequestOptions
): Promise<GraphQLRequestResult<T>> => {
  const serverUrl = options.serverUrl || DEFAULT_GRAPHQL_SERVER_URL;
  const response = await fetch(normalizeGraphQLServerUrl(serverUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    },
    body: JSON.stringify({
      query,
      variables,
    }),
  });

  const body = await parseJsonSafely<{
    data?: T;
    errors?: { message: string; path?: string[] }[];
    message?: string;
    error?: string;
  }>(response);

  const isSuccessStatus = response.status >= 200 && response.status < 300;
  const errors =
    body?.errors ??
    (!isSuccessStatus
      ? [
          {
            message: extractErrorMessage(body, response.statusText, response.status),
          },
        ]
      : undefined);

  return {
    data: body?.data ?? null,
    errors,
    status: response.status,
  };
};

export const graphqlRequestWithAutoRefresh = async <T>(
  query: string,
  variables: Record<string, unknown> = {},
  options: GraphQLRequestOptions
): Promise<GraphQLRequestResult<T> & { refreshedTokens?: GraphQLAuthTokens }> => {
  const serverUrl = options.serverUrl || DEFAULT_GRAPHQL_SERVER_URL;
  const normalizedServerUrl = normalizeGraphQLServerUrl(serverUrl);

  const executeRequest = (token?: string) =>
    graphqlRequest<T>(query, variables, {
      ...options,
      serverUrl: normalizedServerUrl,
      token,
    });

  const refreshAndRetry = async (
    currentToken?: string
  ): Promise<GraphQLRequestResult<T> & { refreshedTokens?: GraphQLAuthTokens }> => {
    const refreshResult = await refreshGraphQLTokens({
      ...options,
      serverUrl: normalizedServerUrl,
      token: currentToken,
    });

    if (!refreshResult.ok) {
      return {
        data: null,
        errors: [{ message: refreshResult.error }],
        status: 401,
      };
    }

    const refreshed = await executeRequest(refreshResult.tokens.token);
    return {
      ...refreshed,
      refreshedTokens: refreshResult.tokens,
    };
  };

  if (!options.token && options.refreshToken) {
    return refreshAndRetry();
  }

  const initialResult = await executeRequest(options.token);
  if (!isUnauthorizedGraphQLResult(initialResult) || !options.refreshToken) {
    return initialResult;
  }

  return refreshAndRetry(options.token);
};

export const executeGraphQLWithAuth = async <T>(
  query: string,
  variables: Record<string, unknown>,
  options: GraphQLRequestOptions,
  onTokensRefreshed?: (tokens: GraphQLAuthTokens) => Promise<void> | void
) => {
  const result = await graphqlRequestWithAutoRefresh<T>(query, variables, options);
  if (result.refreshedTokens && onTokensRefreshed) {
    await onTokensRefreshed(result.refreshedTokens);
  }
  return result;
};

const PING_QUERY = /* GraphQL */ `
  query Me {
    me {
      uid
      displayName
      photoURL
    }
  }
`;

export const pingGraphQLServer = async (
  options: GraphQLRequestOptions,
  onTokensRefreshed?: (tokens: GraphQLAuthTokens) => Promise<void> | void
): Promise<GraphQLPingResult> => {
  const serverUrl = options.serverUrl || DEFAULT_GRAPHQL_SERVER_URL;

  if (!options.token && !options.refreshToken) {
    return {
      ok: false,
      authenticated: false,
      serverUrl: normalizeGraphQLServerUrl(serverUrl),
      error: "No token configured. Run `hopp config set token <token>` first.",
    };
  }

  try {
    const result = await graphqlRequestWithAutoRefresh<{
      me: { uid: string; displayName?: string | null; photoURL?: string | null };
    }>(PING_QUERY, {}, { ...options, serverUrl });

    if (result.refreshedTokens && onTokensRefreshed) {
      await onTokensRefreshed(result.refreshedTokens);
    }

    if (result.errors?.length) {
      return {
        ok: false,
        authenticated: false,
        serverUrl: normalizeGraphQLServerUrl(serverUrl),
        error: result.errors.map((err) => err.message).join("; "),
      };
    }

    if (!result.data?.me) {
      return {
        ok: false,
        authenticated: false,
        serverUrl: normalizeGraphQLServerUrl(serverUrl),
        error: "GraphQL server returned no user information.",
      };
    }

    return {
      ok: true,
      authenticated: true,
      ...(result.refreshedTokens ? { refreshed: true } : {}),
      serverUrl: normalizeGraphQLServerUrl(serverUrl),
      user: result.data.me,
    };
  } catch (error) {
    return {
      ok: false,
      authenticated: false,
      serverUrl: normalizeGraphQLServerUrl(serverUrl),
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
