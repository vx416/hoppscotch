import fs from "fs/promises";

import { executeGraphQLWithAuth } from "./graphql";
import { GraphQLEnvironmentRecord, NormalizedEnvironmentRecord } from "../types/environment";
import { GraphQLRequestOptions, GraphQLAuthTokens } from "../types/graphql";
import { HoppEnvPair, HoppEnvs } from "../types/request";

export type EnvironmentScope = "personal" | "global" | "team";

export type TeamRecord = {
  id: string;
  name: string;
  myRole?: string | null;
  ownersCount?: number | null;
};

const GET_USER_ENVIRONMENTS = /* GraphQL */ `
  query GetUserEnvironments {
    me {
      environments {
        id
        isGlobal
        name
        userUid
        variables
      }
    }
  }
`;

const GET_GLOBAL_ENVIRONMENTS = /* GraphQL */ `
  query GetGlobalEnvironments {
    me {
      globalEnvironments {
        id
        isGlobal
        name
        userUid
        variables
      }
    }
  }
`;

const GET_TEAM_ENVIRONMENTS = /* GraphQL */ `
  query GetTeamEnvironments($teamID: ID!) {
    team(teamID: $teamID) {
      teamEnvironments {
        id
        name
        variables
        teamID
      }
    }
  }
`;

const GET_MY_TEAMS = /* GraphQL */ `
  query GetMyTeams($cursor: ID) {
    myTeams(cursor: $cursor) {
      id
      name
      myRole
      ownersCount
    }
  }
`;

const CREATE_USER_ENVIRONMENT = /* GraphQL */ `
  mutation CreateUserEnvironment($name: String!, $variables: String!) {
    createUserEnvironment(name: $name, variables: $variables) {
      id
      userUid
      name
      variables
      isGlobal
    }
  }
`;

const CREATE_USER_GLOBAL_ENVIRONMENT = /* GraphQL */ `
  mutation CreateUserGlobalEnvironment($variables: String!) {
    createUserGlobalEnvironment(variables: $variables) {
      id
    }
  }
`;

const CREATE_TEAM_ENVIRONMENT = /* GraphQL */ `
  mutation CreateTeamEnvironment(
    $name: String!
    $teamID: ID!
    $variables: String!
  ) {
    createTeamEnvironment(name: $name, teamID: $teamID, variables: $variables) {
      id
      teamID
      name
      variables
    }
  }
`;

const UPDATE_USER_ENVIRONMENT = /* GraphQL */ `
  mutation UpdateUserEnvironment($id: ID!, $name: String!, $variables: String!) {
    updateUserEnvironment(id: $id, name: $name, variables: $variables) {
      id
      userUid
      name
      variables
      isGlobal
    }
  }
`;

const UPDATE_TEAM_ENVIRONMENT = /* GraphQL */ `
  mutation UpdateTeamEnvironment($id: ID!, $name: String!, $variables: String!) {
    updateTeamEnvironment(id: $id, name: $name, variables: $variables) {
      id
      teamID
      name
      variables
    }
  }
`;

const DELETE_USER_ENVIRONMENT = /* GraphQL */ `
  mutation DeleteUserEnvironment($id: ID!) {
    deleteUserEnvironment(id: $id)
  }
`;

const DELETE_TEAM_ENVIRONMENT = /* GraphQL */ `
  mutation DeleteTeamEnvironment($id: ID!) {
    deleteTeamEnvironment(id: $id)
  }
`;

const DELETE_USER_ENVIRONMENTS = /* GraphQL */ `
  mutation DeleteUserEnvironments {
    deleteUserEnvironments
  }
`;

const CLEAR_GLOBAL_ENVIRONMENTS = /* GraphQL */ `
  mutation ClearGlobalEnvironments($id: ID!) {
    clearGlobalEnvironments(id: $id) {
      id
      userUid
      name
      variables
      isGlobal
    }
  }
`;

const CLEAR_TEAM_ENVIRONMENT = /* GraphQL */ `
  mutation DeleteAllVariablesFromTeamEnvironment($id: ID!) {
    deleteAllVariablesFromTeamEnvironment(id: $id) {
      id
      teamID
      name
      variables
    }
  }
`;

const parseMaybeJson = (value: string) => {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const toEnvPairs = (record: GraphQLEnvironmentRecord): HoppEnvPair[] => {
  const parsed = normalizeEnvironmentRecord(record).parsedVariables;

  if (Array.isArray(parsed)) {
    return parsed
      .map((variable) => {
        if (!isPlainObject(variable) || typeof variable.key !== "string") {
          return null;
        }

        return {
          key: variable.key,
          initialValue:
            typeof variable.initialValue === "string"
              ? variable.initialValue
              : normalizeScalarValue(variable.initialValue ?? variable.value),
          currentValue:
            typeof variable.currentValue === "string"
              ? variable.currentValue
              : normalizeScalarValue(variable.currentValue ?? variable.value),
          secret: Boolean(variable.secret),
        };
      })
      .filter((variable): variable is HoppEnvPair => Boolean(variable));
  }

  if (isPlainObject(parsed)) {
    return Object.entries(parsed).map(([key, value]) => ({
      key,
      initialValue: normalizeScalarValue(value),
      currentValue: normalizeScalarValue(value),
      secret: false,
    }));
  }

  return [];
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value);

const normalizeScalarValue = (value: unknown) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
};

const normalizeEnvironmentVariables = (variables: unknown) => {
  if (Array.isArray(variables)) {
    return variables.map((variable) => {
      if (!isPlainObject(variable) || typeof variable.key !== "string") {
        throw new Error(
          "Environment variables arrays must contain objects with a string key."
        );
      }

      return {
        key: variable.key,
        initialValue:
          typeof variable.initialValue === "string"
            ? variable.initialValue
            : normalizeScalarValue(variable.initialValue ?? variable.value),
        currentValue:
          typeof variable.currentValue === "string"
            ? variable.currentValue
            : normalizeScalarValue(variable.currentValue ?? variable.value),
        secret: Boolean(variable.secret),
      };
    });
  }

  if (isPlainObject(variables)) {
    return Object.entries(variables).map(([key, value]) => ({
      key,
      initialValue: normalizeScalarValue(value),
      currentValue: normalizeScalarValue(value),
      secret: false,
    }));
  }

  throw new Error(
    "Environment variables must be a JSON object or an array of variable objects."
  );
};

const normalizeEnvironmentVariablesPayload = (variables: string) =>
  JSON.stringify(normalizeEnvironmentVariables(JSON.parse(variables)));

const looksLikeFilePath = (input: string) =>
  input.startsWith("./") ||
  input.startsWith("../") ||
  input.startsWith("/") ||
  input.startsWith("~") ||
  input.startsWith("file://");

const mergeEnvironmentVariables = (
  existingVariables: unknown,
  incomingVariables: unknown
) => {
  const existing = normalizeEnvironmentVariables(existingVariables);
  const incoming = normalizeEnvironmentVariables(incomingVariables);

  const incomingByKey = new Map(incoming.map((variable) => [variable.key, variable]));
  const merged = existing.map((variable) => {
    const incomingVariable = incomingByKey.get(variable.key);
    if (!incomingVariable) return variable;

    return {
      key: variable.key,
      initialValue: incomingVariable.initialValue,
      currentValue: incomingVariable.currentValue,
      secret: incomingVariable.secret || variable.secret,
    };
  });

  const existingKeys = new Set(existing.map((variable) => variable.key));
  for (const variable of incoming) {
    if (existingKeys.has(variable.key)) continue;
    merged.push(variable);
  }

  return merged;
};

const findEnvironmentForScope = async (
  options: GraphQLRequestOptions,
  scope: EnvironmentScope,
  teamID?: string,
  name?: string,
  onTokensRefreshed?: (tokens: GraphQLAuthTokens) => Promise<void> | void
) => {
  const result = await listEnvironments(
    options,
    scope,
    teamID,
    onTokensRefreshed
  );

  const environments = result.environments ?? [];

  if (scope === "global") {
    return environments[0] ?? null;
  }

  const targetName = name?.trim();
  if (!targetName) return null;

  const matches = environments.filter(
    (environment) => environment.name === targetName
  );

  if (matches.length > 1) {
    throw new Error(
      `Multiple ${scope} environments named "${targetName}" exist. Use env list and env update by id instead.`
    );
  }

  return matches[0] ?? null;
};

const findEnvironmentByIdForScope = async (
  options: GraphQLRequestOptions,
  scope: EnvironmentScope,
  teamID: string | undefined,
  id: string,
  onTokensRefreshed?: (tokens: GraphQLAuthTokens) => Promise<void> | void
) => {
  const result = await listEnvironments(
    options,
    scope,
    teamID,
    onTokensRefreshed
  );

  return result.environments?.find((environment) => environment.id === id) ?? null;
};

export const normalizeEnvironmentRecord = (
  environment: GraphQLEnvironmentRecord
): NormalizedEnvironmentRecord => ({
  ...environment,
  parsedVariables: parseMaybeJson(environment.variables),
});

export const readVariablesInput = async (input: string) => {
  const trimmed = input.trim();

  if (looksLikeFilePath(trimmed)) {
    try {
      const fileContents = await fs.readFile(trimmed, "utf8");
      return normalizeEnvironmentVariablesPayload(fileContents.trim());
    } catch (error) {
      const details =
        error instanceof Error
          ? `${(error as NodeJS.ErrnoException).code ?? "ERROR"}: ${error.message}`
          : String(error);
      throw new Error(
        `Environment variables file not found: ${trimmed} (${details})`
      );
    }
  }

  try {
    return normalizeEnvironmentVariablesPayload(trimmed);
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `Environment variables must be JSON or a readable file path: ${error.message}`
        : "Environment variables must be JSON or a readable file path."
    );
  }
};

const runGraphQLOperation = async <T>(
  query: string,
  variables: Record<string, unknown>,
  options: GraphQLRequestOptions,
  onTokensRefreshed?: (tokens: GraphQLAuthTokens) => Promise<void> | void
) => executeGraphQLWithAuth<T>(query, variables, options, onTokensRefreshed);

export const listEnvironments = async (
  options: GraphQLRequestOptions,
  scope: EnvironmentScope,
  teamID?: string,
  onTokensRefreshed?: (tokens: GraphQLAuthTokens) => Promise<void> | void
) => {
  if (scope === "team" && !teamID) {
    throw new Error("Team ID is required when listing team environments.");
  }

  const result = await runGraphQLOperation<{
    me: {
      environments?: GraphQLEnvironmentRecord[];
      globalEnvironments?: GraphQLEnvironmentRecord[];
    };
    team?: {
      teamEnvironments?: GraphQLEnvironmentRecord[];
    };
  }>(
    scope === "personal"
      ? GET_USER_ENVIRONMENTS
      : scope === "global"
        ? GET_GLOBAL_ENVIRONMENTS
        : GET_TEAM_ENVIRONMENTS,
    scope === "team" ? { teamID } : {},
    options,
    onTokensRefreshed
  );

  const environments = (() => {
    if (scope === "personal") return result.data?.me.environments ?? [];
    if (scope === "global") {
      const globalEnvironment = result.data?.me.globalEnvironments;
      return globalEnvironment ? [globalEnvironment] : [];
    }
    return result.data?.team?.teamEnvironments ?? [];
  })();

  return {
    ...result,
    environments: environments.map(normalizeEnvironmentRecord),
  };
};

export const createEnvironment = async (
  options: GraphQLRequestOptions,
  input: {
    name?: string;
    variables: string;
    global?: boolean;
    teamID?: string;
  },
  onTokensRefreshed?: (tokens: GraphQLAuthTokens) => Promise<void> | void
) => {
  const normalizedVariables = normalizeEnvironmentVariablesPayload(input.variables);
  const mutation = input.teamID
    ? CREATE_TEAM_ENVIRONMENT
    : input.global
      ? CREATE_USER_GLOBAL_ENVIRONMENT
      : CREATE_USER_ENVIRONMENT;

  const variables = input.teamID
    ? {
        name: input.name ?? "",
        teamID: input.teamID,
        variables: normalizedVariables,
      }
    : input.global
      ? { variables: normalizedVariables }
      : {
          name: input.name ?? "",
          variables: normalizedVariables,
        };

  const result = await runGraphQLOperation<{
    createUserEnvironment?: GraphQLEnvironmentRecord;
    createUserGlobalEnvironment?: { id: string };
    createTeamEnvironment?: GraphQLEnvironmentRecord;
  }>(mutation, variables, options, onTokensRefreshed);

  return {
    ...result,
    environment: result.data?.createUserEnvironment
      ? normalizeEnvironmentRecord(result.data.createUserEnvironment)
      : result.data?.createTeamEnvironment
        ? normalizeEnvironmentRecord(result.data.createTeamEnvironment)
        : result.data?.createUserGlobalEnvironment ?? null,
  };
};

export const applyEnvironment = async (
  options: GraphQLRequestOptions,
  input: {
    id?: string;
    name?: string;
    variables: string;
    global?: boolean;
    teamID?: string;
  },
  onTokensRefreshed?: (tokens: GraphQLAuthTokens) => Promise<void> | void
) => {
  const scope: EnvironmentScope = input.teamID
    ? "team"
    : input.global
      ? "global"
      : "personal";

  const existingEnvironment = input.id
    ? await findEnvironmentByIdForScope(
        options,
        scope,
        input.teamID,
        input.id,
        onTokensRefreshed
      )
    : await findEnvironmentForScope(
        options,
        scope,
        input.teamID,
        input.name,
        onTokensRefreshed
      );

  if (existingEnvironment) {
    const mergedVariables = JSON.stringify(
      mergeEnvironmentVariables(
        existingEnvironment.parsedVariables,
        JSON.parse(input.variables)
      )
    );

    return updateEnvironment(
      options,
      {
        id: existingEnvironment.id,
        name: existingEnvironment.name ?? input.name ?? "",
        variables: mergedVariables,
        teamID: input.teamID,
      },
      onTokensRefreshed
    );
  }

  return createEnvironment(options, input, onTokensRefreshed);
};

export const updateEnvironment = async (
  options: GraphQLRequestOptions,
  input: {
    id: string;
    name: string;
    variables: string;
    teamID?: string;
  },
  onTokensRefreshed?: (tokens: GraphQLAuthTokens) => Promise<void> | void
) => {
  const normalizedVariables = normalizeEnvironmentVariablesPayload(input.variables);
  const mutation = input.teamID ? UPDATE_TEAM_ENVIRONMENT : UPDATE_USER_ENVIRONMENT;

  const result = await runGraphQLOperation<{
    updateUserEnvironment?: GraphQLEnvironmentRecord;
    updateTeamEnvironment?: GraphQLEnvironmentRecord;
  }>(
    mutation,
    {
      ...input,
      variables: normalizedVariables,
    },
    options,
    onTokensRefreshed
  );

  return {
    ...result,
    environment: result.data?.updateUserEnvironment
      ? normalizeEnvironmentRecord(result.data.updateUserEnvironment)
      : result.data?.updateTeamEnvironment
        ? normalizeEnvironmentRecord(result.data.updateTeamEnvironment)
        : null,
  };
};

export const deleteEnvironment = async (
  options: GraphQLRequestOptions,
  id: string,
  teamID?: string,
  onTokensRefreshed?: (tokens: GraphQLAuthTokens) => Promise<void> | void
) => {
  const result = await runGraphQLOperation<{
    deleteUserEnvironment?: boolean;
    deleteTeamEnvironment?: boolean;
  }>(
    teamID ? DELETE_TEAM_ENVIRONMENT : DELETE_USER_ENVIRONMENT,
    { id },
    options,
    onTokensRefreshed
  );

  return {
    ...result,
    deleted:
      result.data?.deleteUserEnvironment ??
      result.data?.deleteTeamEnvironment ??
      false,
  };
};

export const deleteAllPersonalEnvironments = async (
  options: GraphQLRequestOptions,
  onTokensRefreshed?: (tokens: GraphQLAuthTokens) => Promise<void> | void
) => {
  const result = await runGraphQLOperation<{ deleteUserEnvironments?: number }>(
    DELETE_USER_ENVIRONMENTS,
    {},
    options,
    onTokensRefreshed
  );

  return {
    ...result,
    deletedCount: result.data?.deleteUserEnvironments ?? 0,
  };
};

export const clearGlobalEnvironment = async (
  options: GraphQLRequestOptions,
  id: string,
  onTokensRefreshed?: (tokens: GraphQLAuthTokens) => Promise<void> | void
) => {
  const result = await runGraphQLOperation<{
    clearGlobalEnvironments?: GraphQLEnvironmentRecord;
  }>(
    CLEAR_GLOBAL_ENVIRONMENTS,
    { id },
    options,
    onTokensRefreshed
  );

  return {
    ...result,
    environment: result.data?.clearGlobalEnvironments
      ? normalizeEnvironmentRecord(result.data.clearGlobalEnvironments)
      : null,
  };
};

export const clearTeamEnvironmentVariables = async (
  options: GraphQLRequestOptions,
  id: string,
  onTokensRefreshed?: (tokens: GraphQLAuthTokens) => Promise<void> | void
) => {
  const result = await runGraphQLOperation<{
    deleteAllVariablesFromTeamEnvironment?: GraphQLEnvironmentRecord;
  }>(
    CLEAR_TEAM_ENVIRONMENT,
    { id },
    options,
    onTokensRefreshed
  );

  return {
    ...result,
    environment: result.data?.deleteAllVariablesFromTeamEnvironment
      ? normalizeEnvironmentRecord(
          result.data.deleteAllVariablesFromTeamEnvironment
        )
      : null,
  };
};

export const listTeams = async (
  options: GraphQLRequestOptions,
  onTokensRefreshed?: (tokens: GraphQLAuthTokens) => Promise<void> | void
) => {
  const result = await runGraphQLOperation<{
    myTeams?: TeamRecord[];
  }>(GET_MY_TEAMS, {}, options, onTokensRefreshed);

  return {
    ...result,
    teams: result.data?.myTeams ?? [],
  };
};

export const loadRequestEnvironments = async (
  options: GraphQLRequestOptions,
  environmentId?: string,
  teamID?: string,
  onTokensRefreshed?: (tokens: GraphQLAuthTokens) => Promise<void> | void
): Promise<HoppEnvs> => {
  const currentOptions = {
    serverUrl: options.serverUrl,
    token: options.token,
    refreshToken: options.refreshToken,
  };

  const syncTokens = async (tokens: GraphQLAuthTokens) => {
    currentOptions.token = tokens.token;
    currentOptions.refreshToken = tokens.refreshToken;

    if (onTokensRefreshed) {
      await onTokensRefreshed(tokens);
    }
  };

  const personalResult = await listEnvironments(
    currentOptions,
    "personal",
    undefined,
    syncTokens
  );
  const globalResult = await listEnvironments(
    currentOptions,
    "global",
    undefined,
    syncTokens
  );
  const teamResult = teamID
    ? await listEnvironments(currentOptions, "team", teamID, syncTokens)
    : null;

  const personalEnvironments = personalResult.environments ?? [];
  const globalEnvironment = globalResult.environments?.[0] ?? null;
  const teamEnvironments = teamResult?.environments ?? [];

  const allEnvironments = [
    ...teamEnvironments,
    ...personalEnvironments,
    ...(globalEnvironment ? [globalEnvironment] : []),
  ];

  const selectedEnvironment = environmentId
    ? allEnvironments.find((environment) => environment.id === environmentId) ??
      null
    : null;

  if (environmentId && !selectedEnvironment) {
    throw new Error(
      `Unable to find an environment matching "${environmentId}".`
    );
  }

  return {
    global: globalEnvironment ? toEnvPairs(globalEnvironment) : [],
    selected:
      selectedEnvironment && !selectedEnvironment.isGlobal
        ? toEnvPairs(selectedEnvironment)
        : [],
  };
};
