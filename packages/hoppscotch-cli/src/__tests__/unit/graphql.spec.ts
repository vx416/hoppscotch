import { describe, expect, test, vi } from "vitest";

import {
  graphqlRequest,
  normalizeGraphQLServerUrl,
  pingGraphQLServer,
} from "../../utils/graphql";

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
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({
        data: { me: { uid: "user-1" } },
      }),
    });
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
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({
        data: {
          me: {
            uid: "user-1",
            displayName: "Test User",
            photoURL: null,
          },
        },
      }),
    });
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
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({
        data: {
          me: {
            uid: "user-1",
          },
        },
      }),
    });
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
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({
        errors: [{ message: "auth/fail" }],
      }),
    });
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
});
