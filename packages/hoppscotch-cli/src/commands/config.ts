import { Command } from "commander";

import {
  formatCliConfigForDisplay,
  readCliConfig,
  unsetCliConfigKey,
  updateCliConfig,
} from "../utils/config";
import { HoppscotchCliConfigKey } from "../types/config";

const validConfigKeys = new Set<HoppscotchCliConfigKey>([
  "server",
  "token",
  "workspaceId",
  "collectionId",
  "environmentId",
]);

const parseKey = (key: string) => {
  if (!validConfigKeys.has(key as HoppscotchCliConfigKey)) {
    throw new Error(
      `Unsupported config key: ${key}. Supported keys: ${Array.from(validConfigKeys).join(", ")}`
    );
  }

  return key as HoppscotchCliConfigKey;
};

export const registerConfigCommand = (program: Command) => {
  const configCommand = program
    .command("config")
    .description("Manage local Hoppscotch CLI configuration");

  configCommand
    .command("show")
    .description("Print the current CLI config")
    .action(async () => {
      const config = await readCliConfig();
      console.log(JSON.stringify(formatCliConfigForDisplay(config), null, 2));
    });

  configCommand
    .command("get")
    .argument("<key>", "config key to read")
    .description("Read a config value")
    .action(async (key: string) => {
      const parsedKey = parseKey(key);
      const config = await readCliConfig();
      const value = config[parsedKey];

      if (parsedKey === "token" && typeof value === "string") {
        console.log(value);
        return;
      }

      if (value === undefined) {
        console.error(`No value set for config key: ${parsedKey}`);
        process.exitCode = 1;
        return;
      }

      console.log(value);
    });

  configCommand
    .command("set")
    .argument("<key>", "config key to update")
    .argument("<value>", "config value")
    .description("Persist a config value")
    .action(async (key: string, value: string) => {
      const parsedKey = parseKey(key);
      await updateCliConfig({ [parsedKey]: value });
      console.log(`Saved ${parsedKey} to local config`);
    });

  configCommand
    .command("unset")
    .argument("<key>", "config key to remove")
    .description("Remove a config value")
    .action(async (key: string) => {
      const parsedKey = parseKey(key);
      await unsetCliConfigKey(parsedKey);
      console.log(`Removed ${parsedKey} from local config`);
    });
};
