import { Command } from "commander";

import { handleError } from "../handlers/error";
import { isHoppCLIError } from "../utils/checks";
import { generateHoppscotchCliSkill } from "../utils/skill";

export const registerSkillCommand = (program: Command) => {
  program
    .command("gen-skill")
    .option(
      "--print",
      "print the hoppscotch-cli skill markdown to stdout instead of writing files"
    )
    .option(
      "--force",
      "overwrite existing hoppscotch-cli skill files in the current working directory"
    )
    .description(
      "Generate the Hoppscotch CLI skill files under the current working directory's .claude/hoppscotch-cli and .codex/hoppscotch-cli"
    )
    .addHelpText(
      "after",
      "\nWrites SKILL.md to .claude/hoppscotch-cli and .codex/hoppscotch-cli under the current working directory. Use --print to inspect the generated markdown without writing files."
    )
    .action(async () => {
      try {
        const argv = process.argv.slice(2);
        const print = argv.includes("--print");
        const force = argv.includes("--force");

        const result = await generateHoppscotchCliSkill({
          print,
          force,
        });

        if (print) {
          console.log(result.content);
          return;
        }

        console.log(
          `Generated hoppscotch-cli skill files:\n${result.outputPaths
            .map((outputPath) => `- ${outputPath}`)
            .join("\n")}`
        );
      } catch (err) {
        if (isHoppCLIError(err)) {
          if (process.env.HOPP_CLI_DEBUG === "1") {
            console.error(err);
          }
          handleError(err);
          process.exitCode = 1;
          return;
        }

        if (process.env.HOPP_CLI_DEBUG === "1" && err instanceof Error) {
          console.error(err.stack ?? err.message);
        }

        throw err;
      }
    });
};
