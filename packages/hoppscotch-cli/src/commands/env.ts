import { Command } from "commander";

import { resolveCliRuntimeConfig, updateCliConfig } from "../utils/config";
import {
  clearGlobalEnvironment,
  clearTeamEnvironmentVariables,
  applyEnvironment,
  createEnvironment,
  deleteAllPersonalEnvironments,
  deleteEnvironment,
  listEnvironments,
  listTeams,
  readVariablesInput,
  updateEnvironment,
} from "../utils/environment";

const printJson = (value: unknown) => {
  console.log(JSON.stringify(value, null, 2));
};

const persistRefreshedTokens = async (
  server: string | undefined,
  tokens: { token: string; refreshToken: string }
) => {
  await updateCliConfig({
    server,
    token: tokens.token,
    refreshToken: tokens.refreshToken,
  });
};

const resolveRuntime = async (options: {
  server?: string;
  token?: string;
  refreshToken?: string;
}) =>
  resolveCliRuntimeConfig({
    server: options.server,
    token: options.token,
    refreshToken: options.refreshToken,
  });

export const registerEnvCommand = (program: Command) => {
  const envCommand = program
    .command("env")
    .description("Manage Hoppscotch GraphQL environments")
    .showHelpAfterError();

  const teamCommand = program
    .command("team")
    .description("Inspect Hoppscotch teams");

  teamCommand
    .command("list")
    .option("--server <server_url>", "server URL for the GraphQL backend")
    .option("--token <access_token>", "access token for the backend")
    .option("--refresh-token <refresh_token>", "refresh token for the backend")
    .description("List teams the current user belongs to")
    .action(async (options) => {
      const runtime = await resolveRuntime(options);
      const result = await listTeams(
        {
          serverUrl: runtime.server ?? options.server,
          token: runtime.token ?? options.token,
          refreshToken: runtime.refreshToken ?? options.refreshToken,
        },
        async (tokens) =>
          persistRefreshedTokens(runtime.server ?? options.server, tokens)
      );

      printJson({
        ok: !result.errors?.length,
        teams: result.teams,
        errors: result.errors?.map((error) => error.message),
      });

      if (result.errors?.length) process.exitCode = 1;
    });

  envCommand
    .command("apply")
    .argument("[name]", "environment name")
    .requiredOption("--variables <json_or_file>", "environment variables JSON or file path")
    .option("--id <environment_id>", "apply to an existing environment by id")
    .option("--team <team_id>", "apply to a team environment")
    .option("--global", "apply to the global environment")
    .option("--server <server_url>", "server URL for the GraphQL backend")
    .option("--token <access_token>", "access token for the backend")
    .option("--refresh-token <refresh_token>", "refresh token for the backend")
    .description(
      "Merge variables into an existing environment, or create it if it does not exist"
    )
    .action(async (name: string | undefined, options) => {
      if (!options.global && !options.id && !name) {
        throw new Error(
          "Environment name or id is required unless you are applying to the global environment."
        );
      }

      const runtime = await resolveRuntime(options);
      const variables = await readVariablesInput(options.variables);
      const result = await applyEnvironment(
        {
          serverUrl: runtime.server ?? options.server,
          token: runtime.token ?? options.token,
          refreshToken: runtime.refreshToken ?? options.refreshToken,
        },
        {
          id: options.id,
          name,
          variables,
          teamID: options.team,
          global: Boolean(options.global),
        },
        async (tokens) =>
          persistRefreshedTokens(runtime.server ?? options.server, tokens)
      );

      printJson({
        ok: !result.errors?.length,
        environment: result.environment,
        errors: result.errors?.map((error) => error.message),
      });

      if (result.errors?.length) process.exitCode = 1;
    });

  envCommand
    .command("list")
    .option("--team <team_id>", "list team environments for a team")
    .option("--global", "list the global environment instead of personal ones")
    .option("--server <server_url>", "server URL for the GraphQL backend")
    .option("--token <access_token>", "access token for the backend")
    .option("--refresh-token <refresh_token>", "refresh token for the backend")
    .description("List environments")
    .action(async (options) => {
      const runtime = await resolveRuntime(options);
      const result = await listEnvironments(
        {
          serverUrl: runtime.server ?? options.server,
          token: runtime.token ?? options.token,
          refreshToken: runtime.refreshToken ?? options.refreshToken,
        },
        options.team ? "team" : options.global ? "global" : "personal",
        options.team,
        async (tokens) =>
          persistRefreshedTokens(runtime.server ?? options.server, tokens)
      );

      printJson({
        ok: !result.errors?.length,
        scope: options.team ? "team" : options.global ? "global" : "personal",
        teamID: options.team ?? undefined,
        environments: result.environments,
        errors: result.errors?.map((error) => error.message),
      });

      if (result.errors?.length) process.exitCode = 1;
    });

  envCommand
    .command("create")
    .alias("add")
    .argument("[name]", "environment name")
    .requiredOption("--variables <json_or_file>", "environment variables JSON or file path")
    .option("--team <team_id>", "create a team environment")
    .option("--global", "create a global environment")
    .option("--server <server_url>", "server URL for the GraphQL backend")
    .option("--token <access_token>", "access token for the backend")
    .option("--refresh-token <refresh_token>", "refresh token for the backend")
    .description("Create a new environment without merging into existing ones")
    .action(async (name: string | undefined, options) => {
      const runtime = await resolveRuntime(options);
      const variables = await readVariablesInput(options.variables);
      const result = await createEnvironment(
        {
          serverUrl: runtime.server ?? options.server,
          token: runtime.token ?? options.token,
          refreshToken: runtime.refreshToken ?? options.refreshToken,
        },
        {
          name,
          variables,
          teamID: options.team,
          global: Boolean(options.global),
        },
        async (tokens) =>
          persistRefreshedTokens(runtime.server ?? options.server, tokens)
      );

      printJson({
        ok: !result.errors?.length,
        environment: result.environment,
        errors: result.errors?.map((error) => error.message),
      });

      if (result.errors?.length) process.exitCode = 1;
    });

  envCommand
    .command("update")
    .argument("<id>", "environment id")
    .requiredOption("--variables <json_or_file>", "environment variables JSON or file path")
    .option("--name <name>", "environment name", "")
    .option("--team <team_id>", "update a team environment")
    .option("--server <server_url>", "server URL for the GraphQL backend")
    .option("--token <access_token>", "access token for the backend")
    .option("--refresh-token <refresh_token>", "refresh token for the backend")
    .description("Update an environment by id")
    .action(async (id: string, options) => {
      const runtime = await resolveRuntime(options);
      const variables = await readVariablesInput(options.variables);
      const result = await updateEnvironment(
        {
          serverUrl: runtime.server ?? options.server,
          token: runtime.token ?? options.token,
          refreshToken: runtime.refreshToken ?? options.refreshToken,
        },
        {
          id,
          name: options.name ?? "",
          variables,
          teamID: options.team,
        },
        async (tokens) =>
          persistRefreshedTokens(runtime.server ?? options.server, tokens)
      );

      printJson({
        ok: !result.errors?.length,
        environment: result.environment,
        errors: result.errors?.map((error) => error.message),
      });

      if (result.errors?.length) process.exitCode = 1;
    });

  envCommand
    .command("delete")
    .alias("del")
    .argument("<id>", "environment id")
    .option("--team <team_id>", "delete a team environment")
    .option("--server <server_url>", "server URL for the GraphQL backend")
    .option("--token <access_token>", "access token for the backend")
    .option("--refresh-token <refresh_token>", "refresh token for the backend")
    .description("Delete an environment by id")
    .action(async (id: string, options) => {
      const runtime = await resolveRuntime(options);
      const result = await deleteEnvironment(
        {
          serverUrl: runtime.server ?? options.server,
          token: runtime.token ?? options.token,
          refreshToken: runtime.refreshToken ?? options.refreshToken,
        },
        id,
        options.team,
        async (tokens) =>
          persistRefreshedTokens(runtime.server ?? options.server, tokens)
      );

      printJson({
        ok: !result.errors?.length && result.deleted,
        deleted: result.deleted,
        errors: result.errors?.map((error) => error.message),
      });

      if (result.errors?.length || !result.deleted) process.exitCode = 1;
    });

  envCommand
    .command("delete-all")
    .option("--server <server_url>", "server URL for the GraphQL backend")
    .option("--token <access_token>", "access token for the backend")
    .option("--refresh-token <refresh_token>", "refresh token for the backend")
    .description("Delete all personal environments")
    .action(async (options) => {
      const runtime = await resolveRuntime(options);
      const result = await deleteAllPersonalEnvironments(
        {
          serverUrl: runtime.server ?? options.server,
          token: runtime.token ?? options.token,
          refreshToken: runtime.refreshToken ?? options.refreshToken,
        },
        async (tokens) =>
          persistRefreshedTokens(runtime.server ?? options.server, tokens)
      );

      printJson({
        ok: !result.errors?.length,
        deletedCount: result.deletedCount,
        errors: result.errors?.map((error) => error.message),
      });

      if (result.errors?.length) process.exitCode = 1;
    });

  envCommand
    .command("clear-global")
    .argument("<id>", "global environment id")
    .option("--server <server_url>", "server URL for the GraphQL backend")
    .option("--token <access_token>", "access token for the backend")
    .option("--refresh-token <refresh_token>", "refresh token for the backend")
    .description("Remove all variables from a global environment")
    .action(async (id: string, options) => {
      const runtime = await resolveRuntime(options);
      const result = await clearGlobalEnvironment(
        {
          serverUrl: runtime.server ?? options.server,
          token: runtime.token ?? options.token,
          refreshToken: runtime.refreshToken ?? options.refreshToken,
        },
        id,
        async (tokens) =>
          persistRefreshedTokens(runtime.server ?? options.server, tokens)
      );

      printJson({
        ok: !result.errors?.length,
        environment: result.environment,
        errors: result.errors?.map((error) => error.message),
      });

      if (result.errors?.length) process.exitCode = 1;
    });

  envCommand
    .command("clear")
    .argument("<id>", "team environment id")
    .option("--team <team_id>", "team id that owns the environment")
    .option("--server <server_url>", "server URL for the GraphQL backend")
    .option("--token <access_token>", "access token for the backend")
    .option("--refresh-token <refresh_token>", "refresh token for the backend")
    .description("Remove all variables from a team environment")
    .action(async (id: string, options) => {
      const runtime = await resolveRuntime(options);
      const result = await clearTeamEnvironmentVariables(
        {
          serverUrl: runtime.server ?? options.server,
          token: runtime.token ?? options.token,
          refreshToken: runtime.refreshToken ?? options.refreshToken,
        },
        id,
        async (tokens) =>
          persistRefreshedTokens(runtime.server ?? options.server, tokens)
      );

      printJson({
        ok: !result.errors?.length,
        environment: result.environment,
        errors: result.errors?.map((error) => error.message),
      });

      if (result.errors?.length) process.exitCode = 1;
    });
};
