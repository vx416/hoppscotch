import fs from "fs/promises";
import os from "os";
import path from "path";
import { describe, expect, test, vi } from "vitest";

import {
  applyEnvironment,
  clearTeamEnvironmentVariables,
  clearGlobalEnvironment,
  createEnvironment,
  deleteAllPersonalEnvironments,
  deleteEnvironment,
  listEnvironments,
  listTeams,
  normalizeEnvironmentRecord,
  readVariablesInput,
  updateEnvironment,
} from "../../utils/environment";

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

describe("environment utils", () => {
  test("normalizes environment records with parsed variables", () => {
    expect(
      normalizeEnvironmentRecord({
        id: "env-1",
        userUid: "user-1",
        name: "Prod",
        variables: JSON.stringify([{ key: "API", value: "https://api" }]),
        isGlobal: false,
      })
    ).toEqual({
      id: "env-1",
      userUid: "user-1",
      name: "Prod",
      variables: JSON.stringify([{ key: "API", value: "https://api" }]),
      isGlobal: false,
      parsedVariables: [{ key: "API", value: "https://api" }],
    });
  });

  test("reads environment variables from inline json", async () => {
    await expect(readVariablesInput('{ "foo": "bar" }')).resolves.toBe(
      '[{"key":"foo","initialValue":"bar","currentValue":"bar","secret":false}]'
    );
  });

  test("reads environment variables from a file path", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hopp-cli-env-"));
    const filePath = path.join(dir, "env.json");

    await fs.writeFile(filePath, '{ "foo": "bar" }', "utf8");

    await expect(readVariablesInput(filePath)).resolves.toBe(
      '[{"key":"foo","initialValue":"bar","currentValue":"bar","secret":false}]'
    );
  });

  test("fails with a clearer error when the variables file does not exist", async () => {
    await expect(readVariablesInput("./tmp/dev.json")).rejects.toThrow(
      "Environment variables file not found: ./tmp/dev.json"
    );
  });

  test("reads environment variables from a canonical array", async () => {
    await expect(
      readVariablesInput(
        '[{"key":"API","initialValue":"https://api","currentValue":"https://api","secret":true}]'
      )
    ).resolves.toBe(
      '[{"key":"API","initialValue":"https://api","currentValue":"https://api","secret":true}]'
    );
  });

  test("lists personal environments", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(200, {
        data: {
          me: {
            environments: [
              {
                id: "env-1",
                userUid: "user-1",
                name: "Prod",
                variables: '{"foo":"bar"}',
                isGlobal: false,
              },
            ],
          },
        },
      })
    );

    vi.stubGlobal("fetch", fetchMock);

    await expect(
      listEnvironments(
        {
          serverUrl: "https://api.example.com",
          token: "access-token",
          refreshToken: "refresh-token",
        },
        "personal"
      )
    ).resolves.toMatchObject({
      environments: [
        {
          id: "env-1",
          name: "Prod",
          parsedVariables: { foo: "bar" },
        },
      ],
    });

    vi.unstubAllGlobals();
  });

  test("lists team environments", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(200, {
        data: {
          team: {
            teamEnvironments: [
              {
                id: "team-env-1",
                userUid: "user-1",
                name: "dev",
                variables: '{"baseUrl":"https://api"}',
                isGlobal: false,
                teamID: "team-1",
              },
            ],
          },
        },
      })
    );

    vi.stubGlobal("fetch", fetchMock);

    await expect(
      listEnvironments(
        {
          serverUrl: "https://api.example.com",
          token: "access-token",
          refreshToken: "refresh-token",
        },
        "team",
        "team-1"
      )
    ).resolves.toMatchObject({
      environments: [
        {
          id: "team-env-1",
          name: "dev",
          parsedVariables: { baseUrl: "https://api" },
        },
      ],
    });

    vi.unstubAllGlobals();
  });

  test("creates a personal environment", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(200, {
        data: {
          createUserEnvironment: {
            id: "env-1",
            userUid: "user-1",
            name: "Prod",
            variables:
              '[{"key":"foo","initialValue":"bar","currentValue":"bar","secret":false}]',
            isGlobal: false,
          },
        },
      })
    );

    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createEnvironment(
        {
          serverUrl: "https://api.example.com",
          token: "access-token",
          refreshToken: "refresh-token",
        },
        {
          name: "Prod",
          variables: '{"foo":"bar"}',
        }
      )
    ).resolves.toMatchObject({
      environment: {
        id: "env-1",
        parsedVariables: [
          {
            key: "foo",
            initialValue: "bar",
            currentValue: "bar",
            secret: false,
          },
        ],
      },
    });

    const requestBody = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(requestBody.variables.variables).toBe(
      '[{"key":"foo","initialValue":"bar","currentValue":"bar","secret":false}]'
    );

    vi.unstubAllGlobals();
  });

  test("creates a team environment", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(200, {
        data: {
          createTeamEnvironment: {
            id: "team-env-1",
            teamID: "team-1",
            name: "dev",
            variables:
              '[{"key":"baseUrl","initialValue":"https://api","currentValue":"https://api","secret":false}]',
          },
        },
      })
    );

    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createEnvironment(
        {
          serverUrl: "https://api.example.com",
          token: "access-token",
          refreshToken: "refresh-token",
        },
        {
          name: "dev",
          teamID: "team-1",
          variables: '{"baseUrl":"https://api"}',
        }
      )
    ).resolves.toMatchObject({
      environment: {
        id: "team-env-1",
        parsedVariables: [
          {
            key: "baseUrl",
            initialValue: "https://api",
            currentValue: "https://api",
            secret: false,
          },
        ],
      },
    });

    const requestBody = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(requestBody.variables.variables).toBe(
      '[{"key":"baseUrl","initialValue":"https://api","currentValue":"https://api","secret":false}]'
    );

    vi.unstubAllGlobals();
  });

  test("applies variables to an existing team environment and updates existing keys", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockResponse(200, {
          data: {
            team: {
              teamEnvironments: [
                {
                  id: "team-env-1",
                  teamID: "team-1",
                  name: "dev",
                  variables:
                    '[{"key":"domain","currentValue":"https://api","initialValue":"https://api","secret":false},{"key":"test","currentValue":"test","initialValue":"test","secret":false}]',
                },
              ],
            },
          },
        })
      )
      .mockResolvedValueOnce(
        mockResponse(200, {
          data: {
            updateTeamEnvironment: {
              id: "team-env-1",
              teamID: "team-1",
              name: "dev",
              variables:
                '[{"key":"domain","currentValue":"https://api","initialValue":"https://api","secret":false},{"key":"test","currentValue":"test2","initialValue":"test2","secret":false}]',
            },
          },
        })
      );

    vi.stubGlobal("fetch", fetchMock);

    await expect(
      applyEnvironment(
        {
          serverUrl: "https://api.example.com",
          token: "access-token",
          refreshToken: "refresh-token",
        },
        {
          name: "dev",
          teamID: "team-1",
          variables: '{"test":"test2"}',
        }
      )
    ).resolves.toMatchObject({
      environment: {
        id: "team-env-1",
        parsedVariables: [
          {
            key: "domain",
            currentValue: "https://api",
            initialValue: "https://api",
            secret: false,
          },
          {
            key: "test",
            currentValue: "test2",
            initialValue: "test2",
            secret: false,
          },
        ],
      },
    });

    expect(fetchMock.mock.calls).toHaveLength(2);
    const requestBody = JSON.parse(fetchMock.mock.calls[1][1]?.body as string);
    expect(requestBody.variables.variables).toBe(
      '[{"key":"domain","initialValue":"https://api","currentValue":"https://api","secret":false},{"key":"test","initialValue":"test2","currentValue":"test2","secret":false}]'
    );

    vi.unstubAllGlobals();
  });

  test("applies variables to an existing team environment by id", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockResponse(200, {
          data: {
            team: {
              teamEnvironments: [
                {
                  id: "team-env-1",
                  teamID: "team-1",
                  name: "dev",
                  variables:
                    '[{"key":"domain","currentValue":"https://api","initialValue":"https://api","secret":false}]',
                },
                {
                  id: "team-env-2",
                  teamID: "team-1",
                  name: "dev",
                  variables:
                    '[{"key":"domain","currentValue":"https://api2","initialValue":"https://api2","secret":false}]',
                },
              ],
            },
          },
        })
      )
      .mockResolvedValueOnce(
        mockResponse(200, {
          data: {
            updateTeamEnvironment: {
              id: "team-env-2",
              teamID: "team-1",
              name: "dev",
              variables:
                '[{"key":"domain","currentValue":"https://api2","initialValue":"https://api2","secret":false},{"key":"uid","currentValue":"123","initialValue":"123","secret":false}]',
            },
          },
        })
      );

    vi.stubGlobal("fetch", fetchMock);

    await expect(
      applyEnvironment(
        {
          serverUrl: "https://api.example.com",
          token: "access-token",
          refreshToken: "refresh-token",
        },
        {
          id: "team-env-2",
          teamID: "team-1",
          variables: '{"uid":"123"}',
        }
      )
    ).resolves.toMatchObject({
      environment: {
        id: "team-env-2",
        parsedVariables: [
          {
            key: "domain",
            currentValue: "https://api2",
            initialValue: "https://api2",
            secret: false,
          },
          {
            key: "uid",
            currentValue: "123",
            initialValue: "123",
            secret: false,
          },
        ],
      },
    });

    expect(fetchMock.mock.calls).toHaveLength(2);
    const requestBody = JSON.parse(fetchMock.mock.calls[1][1]?.body as string);
    expect(requestBody.variables.variables).toBe(
      '[{"key":"domain","initialValue":"https://api2","currentValue":"https://api2","secret":false},{"key":"uid","initialValue":"123","currentValue":"123","secret":false}]'
    );

    vi.unstubAllGlobals();
  });

  test("updates a personal environment", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(200, {
        data: {
          updateUserEnvironment: {
            id: "env-1",
            userUid: "user-1",
            name: "Prod",
            variables:
              '[{"key":"foo","initialValue":"baz","currentValue":"baz","secret":false}]',
            isGlobal: false,
          },
        },
      })
    );

    vi.stubGlobal("fetch", fetchMock);

    await expect(
      updateEnvironment(
        {
          serverUrl: "https://api.example.com",
          token: "access-token",
          refreshToken: "refresh-token",
        },
        {
          id: "env-1",
          name: "Prod",
          variables: '{"foo":"baz"}',
        }
      )
    ).resolves.toMatchObject({
      environment: {
        id: "env-1",
        parsedVariables: [
          {
            key: "foo",
            initialValue: "baz",
            currentValue: "baz",
            secret: false,
          },
        ],
      },
    });

    const requestBody = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(requestBody.variables.variables).toBe(
      '[{"key":"foo","initialValue":"baz","currentValue":"baz","secret":false}]'
    );

    vi.unstubAllGlobals();
  });

  test("deletes a personal environment", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(200, {
        data: {
          deleteUserEnvironment: true,
        },
      })
    );

    vi.stubGlobal("fetch", fetchMock);

    await expect(
      deleteEnvironment(
        {
          serverUrl: "https://api.example.com",
          token: "access-token",
          refreshToken: "refresh-token",
        },
        "env-1"
      )
    ).resolves.toMatchObject({
      deleted: true,
    });

    vi.unstubAllGlobals();
  });

  test("clears a global environment", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(200, {
        data: {
          clearGlobalEnvironments: {
            id: "env-global",
            userUid: "user-1",
            name: "",
            variables: "[]",
            isGlobal: true,
          },
        },
      })
    );

    vi.stubGlobal("fetch", fetchMock);

    await expect(
      clearGlobalEnvironment(
        {
          serverUrl: "https://api.example.com",
          token: "access-token",
          refreshToken: "refresh-token",
        },
        "env-global"
      )
    ).resolves.toMatchObject({
      environment: {
        id: "env-global",
        isGlobal: true,
        parsedVariables: [],
      },
    });

    vi.unstubAllGlobals();
  });

  test("deletes all personal environments", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(200, {
        data: {
          deleteUserEnvironments: 2,
        },
      })
    );

    vi.stubGlobal("fetch", fetchMock);

    await expect(
      deleteAllPersonalEnvironments({
        serverUrl: "https://api.example.com",
        token: "access-token",
        refreshToken: "refresh-token",
      })
    ).resolves.toMatchObject({
      deletedCount: 2,
    });

    vi.unstubAllGlobals();
  });

  test("clears a team environment", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(200, {
        data: {
          deleteAllVariablesFromTeamEnvironment: {
            id: "team-env-1",
            userUid: "user-1",
            name: "dev",
            variables: "[]",
            isGlobal: false,
            teamID: "team-1",
          },
        },
      })
    );

    vi.stubGlobal("fetch", fetchMock);

    await expect(
      clearTeamEnvironmentVariables(
        {
          serverUrl: "https://api.example.com",
          token: "access-token",
          refreshToken: "refresh-token",
        },
        "team-env-1"
      )
    ).resolves.toMatchObject({
      environment: {
        id: "team-env-1",
        parsedVariables: [],
      },
    });

    vi.unstubAllGlobals();
  });

  test("lists teams", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(200, {
        data: {
          myTeams: [
            {
              id: "team-1",
              name: "clubwpt gold",
              myRole: "EDITOR",
              ownersCount: 1,
            },
          ],
        },
      })
    );

    vi.stubGlobal("fetch", fetchMock);

    await expect(
      listTeams({
        serverUrl: "https://api.example.com",
        token: "access-token",
        refreshToken: "refresh-token",
      })
    ).resolves.toMatchObject({
      teams: [
        {
          id: "team-1",
          name: "clubwpt gold",
          myRole: "EDITOR",
        },
      ],
    });

    vi.unstubAllGlobals();
  });
});
