import {
  GraphQLPingResult,
  GraphQLRequestOptions,
  GraphQLRequestResult,
} from "../types/graphql";

export const normalizeGraphQLServerUrl = (serverUrl: string) => {
  const trimmed = serverUrl.trim();
  if (trimmed.endsWith("/graphql")) return trimmed;
  return trimmed.replace(/\/$/, "") + "/graphql";
};

export const graphqlRequest = async <T>(
  query: string,
  variables: Record<string, unknown> = {},
  options: GraphQLRequestOptions
): Promise<GraphQLRequestResult<T>> => {
  const serverUrl = options.serverUrl || "https://api.hoppscotch.io";
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

  const body = (await response.json().catch(() => null)) as
    | {
        data?: T;
        errors?: { message: string; path?: string[] }[];
        message?: string;
        error?: string;
      }
    | null;

  const isSuccessStatus = response.status >= 200 && response.status < 300;
  const errors =
    body?.errors ??
    (!isSuccessStatus
      ? [
          {
              message:
                body?.message ??
                body?.error ??
              response.statusText ??
              `HTTP ${response.status}`,
          },
        ]
      : undefined);

  return {
    data: body?.data ?? null,
    errors,
    status: response.status,
  };
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
  options: GraphQLRequestOptions
): Promise<GraphQLPingResult> => {
  const serverUrl = options.serverUrl || "https://api.hoppscotch.io";
  if (!options.token) {
    return {
      ok: false,
      authenticated: false,
      serverUrl: normalizeGraphQLServerUrl(serverUrl),
      error: "No token configured. Run `hopp config set token <token>` first.",
    };
  }

  try {
    const result = await graphqlRequest<{
      me: { uid: string; displayName?: string | null; photoURL?: string | null };
    }>(PING_QUERY, {}, { ...options, serverUrl });

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
