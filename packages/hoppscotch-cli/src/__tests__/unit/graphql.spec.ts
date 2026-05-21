import { describe, expect, test, vi } from "vitest";

import {
  graphqlRequest,
  normalizeGraphQLServerUrl,
  pingGraphQLServer,
  refreshGraphQLTokens,
} from "../../utils/graphql";

const mockResponse = (
  status: number,
  body: unknown,
  headers: Record<string, unknown> = {}
) => ({
  status,
  statusText: status === 200 ? "OK" : "Unauthorized",
  ok: status >= 200 && status < 300,
  text: async () => JSON.stringify(body),
  headers: {
    getSetCookie: () => [],
    get: () => null,
    ...headers,
  },
});

describe("graphql utils", () => {
  test("normalizes base server urls to graphql endpoints", () => {
    expect(normalizeGraphQLServerUrl("https://api.example.com")).toBe(
      "https://api.example.com/graphql"
    );
  });

  test("keeps explicit graphql urls unchanged", () => {
    expect(normalizeGraphQLServerUrl("https://api.example.com/graphql")).toBe(
      "https://api.example.com/graphql"
    );
  });

  test("sends bearer token and content-type headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(200, {
        data: { me: { uid: "user-1" } },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await graphqlRequest(
      "query Me { me { uid } }",
      {},
      {
        serverUrl: "https://api.example.com",
        token: "pat-123",
      }
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/graphql",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "content-type": "application/json",
          authorization: "Bearer pat-123",
        }),
      })
    );
    vi.unstubAllGlobals();
  });

  test("pings successfully with an authenticated user", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(200, {
        data: {
          me: {
            uid: "user-1",
            displayName: "Test User",
            photoURL: null,
          },
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      pingGraphQLServer({
        serverUrl: "https://api.example.com",
        token: "pat-123",
      })
    ).resolves.toEqual({
      ok: true,
      authenticated: true,
      serverUrl: "https://api.example.com/graphql",
      user: {
        uid: "user-1",
        displayName: "Test User",
        photoURL: null,
      },
    });

    vi.unstubAllGlobals();
  });

  test("defaults to the hosted Hoppscotch backend when server is omitted", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(200, {
        data: {
          me: {
            uid: "user-1",
          },
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await pingGraphQLServer({
      serverUrl: "",
      token: "pat-123",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.hoppscotch.io/graphql",
      expect.any(Object)
    );

    vi.unstubAllGlobals();
  });

  test("fails when no token is configured", async () => {
    await expect(
      pingGraphQLServer({
        serverUrl: "https://api.example.com",
      })
    ).resolves.toEqual({
      ok: false,
      authenticated: false,
      serverUrl: "https://api.example.com/graphql",
      error: "No token configured. Run `hopp config set token <token>` first.",
    });
  });

  test("reports graphql errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(200, {
        errors: [{ message: "auth/fail" }],
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      pingGraphQLServer({
        serverUrl: "https://api.example.com",
        token: "pat-123",
      })
    ).resolves.toEqual({
      ok: false,
      authenticated: false,
      serverUrl: "https://api.example.com/graphql",
      error: "auth/fail",
    });

    vi.unstubAllGlobals();
  });

  test("refreshes tokens when graphql returns unauthorized", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        status: 401,
        ok: false,
        text: async () => JSON.stringify({
          errors: [{ message: "Unauthorized" }],
        }),
        statusText: "Unauthorized",
        headers: {
          getSetCookie: () => [],
          get: () => null,
        },
      })
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        text: async () => "",
        headers: {
          getSetCookie: () => [
            "access_token=new-access-token; Path=/; HttpOnly",
            "refresh_token=new-refresh-token; Path=/; HttpOnly",
          ],
          get: () => null,
        },
      })
      .mockResolvedValueOnce({
        status: 200,
        text: async () => JSON.stringify({
          data: {
            me: {
              uid: "user-1",
            },
          },
        }),
      });

    vi.stubGlobal("fetch", fetchMock);

    const refreshedTokens: Array<{ token: string; refreshToken: string }> = [];

    await expect(
      pingGraphQLServer(
        {
          serverUrl: "https://api.example.com",
          token: "expired-access-token",
          refreshToken: "refresh-token",
        },
        async (tokens) => {
          refreshedTokens.push(tokens);
        }
      )
    ).resolves.toEqual({
      ok: true,
      authenticated: true,
      refreshed: true,
      serverUrl: "https://api.example.com/graphql",
      user: {
        uid: "user-1",
      },
    });

    expect(refreshedTokens).toEqual([
      {
        token: "new-access-token",
        refreshToken: "new-refresh-token",
      },
    ]);

    vi.unstubAllGlobals();
  });

  test("refresh token exchange returns parsed tokens", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(
        200,
        {},
        {
          getSetCookie: () => [
            "access_token=access-from-cookie; Path=/; HttpOnly",
            "refresh_token=refresh-from-cookie; Path=/; HttpOnly",
          ],
          get: () => null,
        }
      )
    );

    vi.stubGlobal("fetch", fetchMock);

    await expect(
      refreshGraphQLTokens({
        serverUrl: "https://api.example.com",
        refreshToken: "refresh-token",
      })
    ).resolves.toEqual({
      ok: true,
      serverUrl: "https://api.example.com/graphql",
      tokens: {
        token: "access-from-cookie",
        refreshToken: "refresh-from-cookie",
      },
    });

    vi.unstubAllGlobals();
  });
});
