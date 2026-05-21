import { Command } from "commander";

import { pingGraphQLServer } from "../utils/graphql";
import { resolveCliRuntimeConfig } from "../utils/config";

export const registerGraphqlCommand = (program: Command) => {
  const graphqlCommand = program
    .command("graphql")
    .description("Interact with a Hoppscotch GraphQL backend");

  graphqlCommand
    .command("ping")
    .option("--server <server_url>", "server URL for the GraphQL backend")
    .option("--token <access_token>", "personal access token for the backend")
    .description("Check whether the GraphQL backend is reachable and authenticated")
    .action(async (options) => {
      const runtime = await resolveCliRuntimeConfig({
        token: options.token,
        server: options.server,
      });

      const result = await pingGraphQLServer({
        serverUrl: runtime.server ?? options.server,
        token: runtime.token ?? options.token,
      });

      console.log(JSON.stringify(result, null, 2));

      if (!result.ok) {
        process.exitCode = 1;
      }
    });
};
