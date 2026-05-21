import { Command } from "commander";

import { pingGraphQLServer } from "../utils/graphql";
import { resolveCliRuntimeConfig, updateCliConfig } from "../utils/config";

export const registerGraphqlCommand = (program: Command) => {
  const graphqlCommand = program
    .command("graphql")
    .description("Interact with a Hoppscotch GraphQL backend");

  graphqlCommand
    .command("ping")
    .option("--server <server_url>", "server URL for the GraphQL backend")
    .option("--token <access_token>", "personal access token for the backend")
    .option(
      "--refresh-token <refresh_token>",
      "refresh token for the GraphQL backend"
    )
    .description("Check whether the GraphQL backend is reachable and authenticated")
    .action(async (options) => {
      const runtime = await resolveCliRuntimeConfig({
        token: options.token,
        refreshToken: options.refreshToken,
        server: options.server,
      });

      const result = await pingGraphQLServer(
        {
          serverUrl: runtime.server ?? options.server,
          token: runtime.token ?? options.token,
          refreshToken: runtime.refreshToken ?? options.refreshToken,
        },
        async (tokens) => {
          await updateCliConfig({
            token: tokens.token,
            refreshToken: tokens.refreshToken,
            server: runtime.server ?? options.server,
          });
        }
      );

      console.log(JSON.stringify(result, null, 2));

      if (!result.ok) {
        process.exitCode = 1;
      }
    });
};
