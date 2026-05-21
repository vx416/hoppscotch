import { Command } from "commander";

import { updateCliConfig, resolveCliRuntimeConfig } from "../utils/config";
import { listCollections } from "../utils/collection";
import {
  createTeamCollection,
  deleteTeamCollection,
  updateTeamCollection,
} from "../utils/workspace-mutations";
import { error } from "../types/errors";

const printJson = (value: unknown) => {
  console.log(JSON.stringify(value, null, 2));
};

const resolveRuntime = async (options: {
  server?: string;
  token?: string;
  refreshToken?: string;
  teamId?: string;
}) =>
  resolveCliRuntimeConfig({
    server: options.server,
    token: options.token,
    refreshToken: options.refreshToken,
    teamId: options.teamId,
  });

export const registerCollectionCommand = (program: Command) => {
  const collectionCommand = program
    .command("collection")
    .description("Inspect Hoppscotch collections");

  collectionCommand
    .command("list")
    .option("--server <server_url>", "server URL for the GraphQL backend")
    .option("--token <access_token>", "access token for the backend")
    .option(
      "--refresh-token <refresh_token>",
      "refresh token for the GraphQL backend"
    )
    .option(
      "--type <REST|GQL>",
      "collection type to list",
      "REST"
    )
    .option("--team <team_id>", "team ID to list collections from")
    .description("List collections and their paths")
    .action(async (options) => {
      const runtime = await resolveRuntime(options);
      const teamID = options.team ?? runtime.teamId;
      const result = await listCollections(
        {
          serverUrl: runtime.server ?? options.server,
          token: runtime.token ?? options.token,
          refreshToken: runtime.refreshToken ?? options.refreshToken,
        },
        options.type,
        teamID,
        async (tokens) => {
          await updateCliConfig({
            token: tokens.token,
            refreshToken: tokens.refreshToken,
            server: runtime.server ?? options.server,
            teamId: teamID,
          });
        }
      );

      printJson({
        ok: result.ok,
        collectionType: result.collectionType,
        teamID,
        collections: result.collections,
        errors: result.errors,
      });

      if (!result.ok) {
        process.exitCode = 1;
      }
    });

  collectionCommand
    .command("use")
    .argument("<collection_id>", "collection id to store as the default")
    .option("--team <team_id>", "also persist the default team id")
    .description("Persist the default collection id used by request run")
    .action(async (collectionId: string, options) => {
      await updateCliConfig({
        collectionId,
        teamId: options.team,
      });
      console.log(`Saved collectionId to local config: ${collectionId}`);
      if (options.team) {
        console.log(`Saved teamId to local config: ${options.team}`);
      }
    });

  collectionCommand
    .command("create")
    .argument("<title>", "title of the new collection")
    .argument(
      "[parent_collection_id_or_name]",
      "optional parent collection id, name, or full path; omit to create a root collection"
    )
    .option("--server <server_url>", "server URL for the GraphQL backend")
    .option("--token <access_token>", "access token for the backend")
    .option(
      "--refresh-token <refresh_token>",
      "refresh token for the GraphQL backend"
    )
    .option("--team <team_id>", "team ID to create the collection in")
    .option(
      "--data <json_or_path>",
      "optional JSON string or path to a JSON file for collection metadata"
    )
    .description("Create a new team collection")
    .action(async (title: string, parentTarget: string | undefined, options) => {
      const runtime = await resolveCliRuntimeConfig({
        server: options.server,
        token: options.token,
        refreshToken: options.refreshToken,
        teamId: options.team,
      });

      const teamID = options.team ?? runtime.teamId;

      if (!teamID) {
        throw error({
          code: "INVALID_ARGUMENT",
          data:
            "A team id is required to create a collection. Pass --team <team_id> or save a default teamId with `hopp config set teamId <id>`.",
        });
      }

      const result = await createTeamCollection(
        {
          serverUrl: runtime.server ?? options.server ?? "",
          token: runtime.token ?? options.token,
          refreshToken: runtime.refreshToken ?? options.refreshToken,
        },
        {
          teamID,
          title,
          data: options.data,
          parentCollectionTarget: parentTarget,
        },
        async (tokens) => {
          await updateCliConfig({
            token: tokens.token,
            refreshToken: tokens.refreshToken,
            server: runtime.server ?? options.server,
            teamId: teamID,
          });
        }
      );

      await updateCliConfig({
        teamId: teamID,
        server: runtime.server ?? options.server,
        token: runtime.token ?? options.token,
        refreshToken: runtime.refreshToken ?? options.refreshToken,
      });

      console.log(
        JSON.stringify(
          {
            ok: Boolean(result),
            collection: result,
            errors: [],
          },
          null,
          2
        )
      );

      if (!result) {
        process.exitCode = 1;
      }
    });

  collectionCommand
    .command("update")
    .argument("<collection_target>", "collection id, name, or full path to rename")
    .argument("<new_title>", "new title for the collection")
    .option("--server <server_url>", "server URL for the GraphQL backend")
    .option("--token <access_token>", "access token for the backend")
    .option(
      "--refresh-token <refresh_token>",
      "refresh token for the GraphQL backend"
    )
    .option("--team <team_id>", "team ID that owns the collection")
    .description("Rename a team collection by id, name, or full path")
    .action(async (collectionTarget: string, newTitle: string, options) => {
      const runtime = await resolveRuntime(options);
      const teamID = options.team ?? runtime.teamId;

      if (!teamID) {
        throw error({
          code: "INVALID_ARGUMENT",
          data:
            "A team id is required to update a collection. Pass --team <team_id> or save a default teamId with `hopp config set teamId <id>`.",
        });
      }

      const result = await updateTeamCollection(
        {
          serverUrl: runtime.server ?? options.server ?? "",
          token: runtime.token ?? options.token,
          refreshToken: runtime.refreshToken ?? options.refreshToken,
        },
        {
          teamID,
          collectionTarget,
          newTitle,
        },
        async (tokens) => {
          await updateCliConfig({
            token: tokens.token,
            refreshToken: tokens.refreshToken,
            server: runtime.server ?? options.server,
            teamId: teamID,
          });
        }
      );

      await updateCliConfig({
        teamId: teamID,
        server: runtime.server ?? options.server,
        token: runtime.token ?? options.token,
        refreshToken: runtime.refreshToken ?? options.refreshToken,
      });

      printJson({
        ok: Boolean(result),
        collection: result,
        errors: [],
      });

      if (!result) {
        process.exitCode = 1;
      }
    });

  collectionCommand
    .command("delete")
    .argument("<collection_target>", "collection id, name, or full path to delete")
    .option("--server <server_url>", "server URL for the GraphQL backend")
    .option("--token <access_token>", "access token for the backend")
    .option(
      "--refresh-token <refresh_token>",
      "refresh token for the GraphQL backend"
    )
    .option("--team <team_id>", "team ID that owns the collection")
    .description("Delete a team collection by id, name, or full path")
    .action(async (collectionTarget: string, options) => {
      const runtime = await resolveRuntime(options);
      const teamID = options.team ?? runtime.teamId;

      if (!teamID) {
        throw error({
          code: "INVALID_ARGUMENT",
          data:
            "A team id is required to delete a collection. Pass --team <team_id> or save a default teamId with `hopp config set teamId <id>`.",
        });
      }

      const result = await deleteTeamCollection(
        {
          serverUrl: runtime.server ?? options.server ?? "",
          token: runtime.token ?? options.token,
          refreshToken: runtime.refreshToken ?? options.refreshToken,
        },
        {
          teamID,
          collectionTarget,
        },
        async (tokens) => {
          await updateCliConfig({
            token: tokens.token,
            refreshToken: tokens.refreshToken,
            server: runtime.server ?? options.server,
            teamId: teamID,
          });
        }
      );

      await updateCliConfig({
        teamId: teamID,
        server: runtime.server ?? options.server,
        token: runtime.token ?? options.token,
        refreshToken: runtime.refreshToken ?? options.refreshToken,
      });

      printJson({
        ok: Boolean(result.deleted),
        deleted: result,
        errors: [],
      });
    });
};
