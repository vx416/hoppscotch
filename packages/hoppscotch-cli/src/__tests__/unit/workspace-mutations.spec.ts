import { describe, expect, test, vi } from "vitest";
import { RESTReqSchemaVersion } from "@hoppscotch/data";

import {
  createTeamCollection,
  deleteTeamCollection,
  createTeamRequest,
  deleteTeamRequest,
  updateTeamRequest,
  updateTeamCollection,
} from "../../utils/workspace-mutations";

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

describe("workspace mutations", () => {
  test("creates a root team collection", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(200, {
        data: {
          createRootCollection: {
            id: "collection-1",
            title: "new collection",
            data: null,
            parentID: null,
          },
        },
      })
    );

    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createTeamCollection(
        {
          serverUrl: "https://api.example.com/graphql",
          token: "token",
          refreshToken: "refresh-token",
        },
        {
          teamID: "team-1",
          title: "new collection",
        }
      )
    ).resolves.toMatchObject({
      id: "collection-1",
      name: "new collection",
    });

    vi.unstubAllGlobals();
  });

  test("creates nested team collections from a slash-delimited path", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockResponse(200, {
          data: {
            exportCollectionsToJSON: JSON.stringify([]),
          },
        })
      )
      .mockResolvedValueOnce(
        mockResponse(200, {
          data: {
            createRootCollection: {
              id: "parent-collection",
              title: "parent",
              data: null,
              parentID: null,
            },
          },
        })
      )
      .mockResolvedValueOnce(
        mockResponse(200, {
          data: {
            createChildCollection: {
              id: "child-collection",
              title: "child",
              data: null,
              parentID: "parent-collection",
            },
          },
        })
      );

    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createTeamCollection(
        {
          serverUrl: "https://api.example.com/graphql",
          token: "token",
          refreshToken: "refresh-token",
        },
        {
          teamID: "team-1",
          title: "parent/child",
        }
      )
    ).resolves.toMatchObject({
      id: "child-collection",
      name: "child",
      folders: [],
    });

    vi.unstubAllGlobals();
  });

  test("creates a team request in a matched collection", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        mockResponse(200, {
          data: {
            exportCollectionsToJSON: JSON.stringify([
              {
                id: "collection-1",
                name: "apigate",
                requests: [],
                folders: [],
              },
            ]),
          },
        })
      )
      .mockResolvedValueOnce(
        mockResponse(200, {
          data: {
            createRequestInCollection: {
              id: "request-1",
              title: "login",
              collectionID: "collection-1",
              teamID: "team-1",
            },
          },
        })
      );

    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createTeamRequest(
        {
          serverUrl: "https://api.example.com/graphql",
          token: "token",
          refreshToken: "refresh-token",
        },
        {
          teamID: "team-1",
          collectionTarget: "apigate",
          title: "login",
          request: JSON.stringify({ method: "GET", endpoint: "https://example.com" }),
        }
      )
    ).resolves.toEqual(
      expect.objectContaining({
        data: {
          createRequestInCollection: {
            id: "request-1",
            title: "login",
            collectionID: "collection-1",
            teamID: "team-1",
          },
        },
      })
    );

    const requestBody = JSON.parse(fetchMock.mock.calls[1][1]?.body as string);
    const createdRequest = JSON.parse(
      requestBody.variables.data.request as string
    );

    expect(createdRequest).toMatchObject({
      v: RESTReqSchemaVersion,
      name: "login",
      method: "GET",
      endpoint: "https://example.com",
      params: [],
      headers: [],
      requestVariables: [],
      responses: {},
      description: null,
    });

    vi.unstubAllGlobals();
  });

  test("updates a team collection by id", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockResponse(200, {
          data: {
            exportCollectionsToJSON: JSON.stringify([
              {
                id: "collection-1",
                name: "old-name",
                requests: [],
                folders: [],
              },
            ]),
          },
        })
      )
      .mockResolvedValueOnce(
        mockResponse(200, {
          data: {
            updateTeamCollection: {
              id: "collection-1",
              title: "new-name",
              data: null,
              parentID: null,
            },
          },
        })
      );

    vi.stubGlobal("fetch", fetchMock);

    await expect(
      updateTeamCollection(
        {
          serverUrl: "https://api.example.com/graphql",
          token: "token",
          refreshToken: "refresh-token",
        },
        {
          teamID: "team-1",
          collectionTarget: "collection-1",
          newTitle: "new-name",
        }
      )
    ).resolves.toMatchObject({
      id: "collection-1",
      name: "new-name",
    });

    vi.unstubAllGlobals();
  });

  test("deletes a team collection by id", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockResponse(200, {
          data: {
            exportCollectionsToJSON: JSON.stringify([
              {
                id: "collection-1",
                name: "delete-me",
                requests: [],
                folders: [],
              },
            ]),
          },
        })
      )
      .mockResolvedValueOnce(
        mockResponse(200, {
          data: {
            deleteCollection: true,
          },
        })
      );

    vi.stubGlobal("fetch", fetchMock);

    await expect(
      deleteTeamCollection(
        {
          serverUrl: "https://api.example.com/graphql",
          token: "token",
          refreshToken: "refresh-token",
        },
        {
          teamID: "team-1",
          collectionTarget: "collection-1",
        }
      )
    ).resolves.toEqual({
      deleted: true,
      id: "collection-1",
      name: "delete-me",
    });

    vi.unstubAllGlobals();
  });

  test("updates a team request by id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(200, {
        data: {
          updateRequest: {
            id: "request-1",
            title: "new title",
            collectionID: "collection-1",
            teamID: "team-1",
          },
        },
      })
    );

    vi.stubGlobal("fetch", fetchMock);

    await expect(
      updateTeamRequest(
        {
          serverUrl: "https://api.example.com/graphql",
          token: "token",
          refreshToken: "refresh-token",
        },
        {
          requestID: "request-1",
          title: "new title",
        }
      )
    ).resolves.toEqual(
      expect.objectContaining({
        id: "request-1",
        title: "new title",
        collectionID: "collection-1",
        teamID: "team-1",
      })
    );

    vi.unstubAllGlobals();
  });

  test("deletes a team request by id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(200, {
        data: {
          deleteRequest: true,
        },
      })
    );

    vi.stubGlobal("fetch", fetchMock);

    await expect(
      deleteTeamRequest(
        {
          serverUrl: "https://api.example.com/graphql",
          token: "token",
          refreshToken: "refresh-token",
        },
        {
          requestID: "request-1",
        }
      )
    ).resolves.toEqual({
      deleted: true,
      requestID: "request-1",
    });

    vi.unstubAllGlobals();
  });
});
