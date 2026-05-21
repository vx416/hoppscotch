import { describe, expect, test, vi } from "vitest";

import {
  listCollections,
  resolveCollectionByName,
} from "../../utils/collection";

const mockResponse = (status: number, body: unknown) => ({
  status,
  ok: status >= 200 && status < 300,
  statusText: status === 200 ? "OK" : "Unauthorized",
  text: async () => JSON.stringify(body),
  headers: {
    getSetCookie: () => [],
    get: () => null,
  },
});

describe("collection utils", () => {
  test("lists and flattens nested collections", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(200, {
        data: {
          exportUserCollectionsToJSON: {
            collectionType: "REST",
            exportedCollection: JSON.stringify([
              {
                id: "root-1",
                name: "root",
                requests: [{ id: "request-1", name: "root-request" }],
                folders: [
                  {
                    id: "folder-1",
                    name: "folder",
                    requests: [{ id: "request-2", name: "nested-request" }],
                    folders: [],
                  },
                ],
              },
            ]),
          },
        },
      })
    );

    vi.stubGlobal("fetch", fetchMock);

    await expect(
      listCollections({
        serverUrl: "https://api.example.com",
        token: "token",
        refreshToken: "refresh-token",
      })
    ).resolves.toEqual({
      ok: true,
      collectionType: "REST",
      collections: [
        {
          id: "root-1",
          name: "root",
          path: "root",
          requestCount: 1,
          folderCount: 1,
        },
        {
          id: "folder-1",
          name: "folder",
          path: "root/folder",
          requestCount: 1,
          folderCount: 0,
        },
      ],
    });

    vi.unstubAllGlobals();
  });

  test("lists team collections via team export", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(200, {
        data: {
          exportCollectionsToJSON: JSON.stringify([
            {
              id: "team-root",
              name: "team-root",
              requests: [],
              folders: [
                {
                  id: "team-child",
                  name: "team-child",
                  requests: [],
                  folders: [],
                },
              ],
            },
          ]),
        },
      })
    );

    vi.stubGlobal("fetch", fetchMock);

    await expect(
      listCollections(
        {
          serverUrl: "https://api.example.com",
          token: "token",
          refreshToken: "refresh-token",
        },
        "REST",
        "team-1"
      )
    ).resolves.toEqual({
      ok: true,
      collectionType: "REST",
      collections: [
        {
          id: "team-root",
          name: "team-root",
          path: "team-root",
          requestCount: 0,
          folderCount: 1,
        },
        {
          id: "team-child",
          name: "team-child",
          path: "team-root/team-child",
          requestCount: 0,
          folderCount: 0,
        },
      ],
    });

    vi.unstubAllGlobals();
  });

  test("resolves a collection by name or path from a tree", () => {
    const matchByName = resolveCollectionByName([{
      id: "team-root",
      v: 12,
      name: "team-root",
      folders: [
        {
          id: "team-child",
          v: 12,
          name: "team-child",
          folders: [],
          requests: [],
          auth: {
            authActive: true,
            authType: "inherit",
          },
          headers: [],
          variables: [],
          description: null,
          preRequestScript: "",
          testScript: "",
        },
      ],
      requests: [],
      auth: {
        authActive: true,
        authType: "inherit",
      },
      headers: [],
      variables: [],
      description: null,
      preRequestScript: "",
      testScript: "",
    }], "team-child");

    expect(matchByName.collection.name).toBe("team-child");
    expect(matchByName.path).toBe("team-root/team-child");
  });

  test("resolves a collection by id from a tree", () => {
    const matchById = resolveCollectionByName([
      {
        id: "team-root",
        v: 12,
        name: "team-root",
        folders: [],
        requests: [],
        auth: {
          authActive: true,
          authType: "inherit",
        },
        headers: [],
        variables: [],
        description: null,
        preRequestScript: "",
        testScript: "",
      },
    ] as never, "team-root");

    expect(matchById.collection.id).toBe("team-root");
    expect(matchById.path).toBe("team-root");
  });

  test("prefers the first exact collection match when names duplicate", () => {
    const duplicatedTree = [
      {
        id: "root-1",
        v: 12,
        name: "shared",
        folders: [],
        requests: [],
        auth: {
          authActive: true,
          authType: "inherit",
        },
        headers: [],
        variables: [],
        description: null,
        preRequestScript: "",
        testScript: "",
      },
      {
        id: "root-2",
        v: 12,
        name: "shared",
        folders: [],
        requests: [],
        auth: {
          authActive: true,
          authType: "inherit",
        },
        headers: [],
        variables: [],
        description: null,
        preRequestScript: "",
        testScript: "",
      },
    ] as const;

    const match = resolveCollectionByName(duplicatedTree as never, "shared");

    expect(match.collection.id).toBe("root-1");
    expect(match.path).toBe("shared");
  });

  test("prefers the shortest exact collection path when names duplicate", () => {
    const duplicatedTree = [
      {
        id: "root-1",
        v: 12,
        name: "root",
        folders: [
          {
            id: "child-1",
            v: 12,
            name: "apigate",
            folders: [],
            requests: [],
            auth: {
              authActive: true,
              authType: "inherit",
            },
            headers: [],
            variables: [],
            description: null,
            preRequestScript: "",
            testScript: "",
          },
          {
            id: "child-2",
            v: 12,
            name: "wrapper",
            folders: [
              {
                id: "grandchild-1",
                v: 12,
                name: "apigate",
                folders: [],
                requests: [],
                auth: {
                  authActive: true,
                  authType: "inherit",
                },
                headers: [],
                variables: [],
                description: null,
                preRequestScript: "",
                testScript: "",
              },
            ],
            requests: [],
            auth: {
              authActive: true,
              authType: "inherit",
            },
            headers: [],
            variables: [],
            description: null,
            preRequestScript: "",
            testScript: "",
          },
        ],
        requests: [],
        auth: {
          authActive: true,
          authType: "inherit",
        },
        headers: [],
        variables: [],
        description: null,
        preRequestScript: "",
        testScript: "",
      },
    ] as const;

    const match = resolveCollectionByName(duplicatedTree as never, "apigate");

    expect(match.collection.id).toBe("child-1");
    expect(match.path).toBe("root/apigate");
  });
});
