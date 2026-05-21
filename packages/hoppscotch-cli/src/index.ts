import chalk from "chalk";
import { Command } from "commander";
import * as E from "fp-ts/Either";

import { version } from "../package.json";
import { registerConfigCommand } from "./commands/config";
import { registerCollectionCommand } from "./commands/collection";
import { registerEnvCommand } from "./commands/env";
import { registerGraphqlCommand } from "./commands/graphql";
import { registerSkillCommand } from "./commands/skill";
import { registerRequestCommand } from "./commands/request";
import { test } from "./commands/test";
import { handleError } from "./handlers/error";
import {
  formatCliConfigInitResult,
  runCliConfigInit,
} from "./utils/config-init";

const accent = chalk.greenBright;

/**
 * * Program Default Configuration
 */
const CLI_BEFORE_ALL_TXT = `hopp: The ${accent(
  "Hoppscotch"
)} CLI - Version ${version} (${accent(
  "https://hoppscotch.io"
)}) ${chalk.black.bold.bgYellowBright(" ALPHA ")} \n`;

const CLI_AFTER_ALL_TXT = `\nFor more help, head on to ${accent(
  "https://docs.hoppscotch.io/documentation/clients/cli/overview"
)}`;

const program = new Command();

registerConfigCommand(program);
registerCollectionCommand(program);
registerEnvCommand(program);
registerGraphqlCommand(program);
registerSkillCommand(program);
registerRequestCommand(program);

program
  .name("hopp")
  .version(version, "-v, --ver", "see the current version of hopp-cli")
  .usage("[options or commands] arguments")
  .addHelpText("beforeAll", CLI_BEFORE_ALL_TXT)
  .addHelpText("after", CLI_AFTER_ALL_TXT)
  .configureHelp({
    optionTerm: (option) => accent(option.flags),
    subcommandTerm: (cmd) => accent(cmd.name(), cmd.usage()),
    argumentTerm: (arg) => accent(arg.name()),
  })
  .addHelpCommand(false)
  .showHelpAfterError(true);

program.exitOverride().configureOutput({
  writeErr: (str) => program.help(),
  outputError: (str, write) =>
    handleError({ code: "INVALID_ARGUMENT", data: E.toError(str) }),
});

/**
 * * CLI Commands
 */
program
  .command("init")
  .description(
    "Interactively initialize local CLI config keys (server, token, refreshToken, teamId, workspaceId)"
  )
  .action(async () => {
    const { next } = await runCliConfigInit();
    console.log(JSON.stringify(formatCliConfigInitResult(next), null, 2));
  });

program
  .command("test")
  .argument(
    "<file_path_or_id>",
    "path to a hoppscotch collection.json file or collection ID from a workspace for CI testing"
  )
  .option(
    "-e, --env <file_path_or_id>",
    "path to an environment variables json file or environment ID from a workspace"
  )
  .option(
    "-r, --request <request_target>",
    "run only the specified request within the collection; can be repeated",
    (value, previous: string[] = []) => [...previous, value],
    []
  )
  .option(
    "--request-map <file_path_or_json>",
    "JSON array or JSON file mapping request_name to request_body; request names in the map are executed even without --request, and the map merges with any explicit --request targets"
  )
  .option(
    "--json",
    "print machine-readable JSON output with each executed request response"
  )
  .option(
    "-d, --delay <delay_in_ms>",
    "delay in milliseconds(ms) between consecutive requests within a collection"
  )
  .option(
    "--token <access_token>",
    "personal access token to access collections/environments from a workspace"
  )
  .option("--server <server_url>", "server URL for SH instance")
  .option(
    "--reporter-junit [path]",
    "generate JUnit report optionally specifying the path"
  )
  .option(
    "--iteration-count <no_of_iterations>",
    "number of iterations to run the test",
    parseInt
  )
  .option(
    "--iteration-data <file_path>",
    "path to a CSV file for data-driven testing"
  )
  .option("--legacy-sandbox", "Opt out from the experimental scripting sandbox")
  .allowExcessArguments(false)
  .allowUnknownOption(false)
  .description("running hoppscotch collection.json file")
  .addHelpText(
    "after",
    `\nFor help, head on to ${accent(
      "https://docs.hoppscotch.io/documentation/clients/cli/overview#commands"
    )}`
  )
  .action(async (pathOrId, options) => {
    const overrides: Record<string, unknown> = {};

    // Choose `hopp-junit-report.xml` as the default value if `reporter-junit` flag is supplied without a value
    if (options.reporterJunit === true) {
      overrides.reporterJunit = "hopp-junit-report.xml";
    }

    const effectiveOptions = { ...options, ...overrides };

    await test(pathOrId, effectiveOptions)();
  });

export const cli = async (args: string[]) => {
  try {
    await program.parseAsync(args);
  } catch (e) {
    if (e instanceof Error) {
      console.error(e.message);
    } else {
      console.error(String(e));
    }

    process.exitCode = 1;
  }
};
