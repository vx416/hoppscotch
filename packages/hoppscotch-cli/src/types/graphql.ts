export type GraphQLResponseError = {
  message: string;
  path?: string[];
  extensions?: Record<string, unknown>;
};

export type GraphQLRequestOptions = {
  serverUrl: string;
  token?: string;
  refreshToken?: string;
};

export type GraphQLRequestResult<T> = {
  data: T | null;
  errors?: GraphQLResponseError[];
  status: number;
};

export type GraphQLAuthTokens = {
  token: string;
  refreshToken: string;
};

export type GraphQLPingResult = {
  ok: boolean;
  serverUrl: string;
  authenticated: boolean;
  refreshed?: boolean;
  user?: {
    uid: string;
    displayName?: string | null;
    photoURL?: string | null;
  };
  error?: string;
};
