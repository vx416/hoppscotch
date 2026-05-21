import readline from "readline/promises";
import { stdin as input, stdout as output } from "process";

import { formatCliConfigForDisplay, readCliConfig, writeCliConfig } from "./config";
import { error } from "../types/errors";
import { HoppscotchCliConfig } from "../types/config";

export type ConfigInitPrompt = {
  key: keyof HoppscotchCliConfig;
  label: string;
  secret?: boolean;
};

export const CONFIG_INIT_PROMPTS: ConfigInitPrompt[] = [
  { key: "server", label: "Server URL" },
  { key: "token", label: "Access token", secret: true },
  { key: "refreshToken", label: "Refresh token", secret: true },
  { key: "teamId", label: "Team ID" },
  { key: "workspaceId", label: "Workspace ID" },
];

export type ConfigInitQuestion = (prompt: string) => Promise<string>;

export const promptCliConfig = async (
  current: HoppscotchCliConfig,
  ask: ConfigInitQuestion
) => {
  const next: Partial<HoppscotchCliConfig> = {};

  for (const prompt of CONFIG_INIT_PROMPTS) {
    const currentValue = current[prompt.key];
    const displayCurrentValue =
      currentValue === undefined || currentValue === ""
        ? ""
        : prompt.secret
          ? " [set]"
          : ` [${currentValue}]`;

    const answer = (await ask(`${prompt.label}${displayCurrentValue}: `)).trim();

    if (answer !== "") {
      next[prompt.key] = answer;
      continue;
    }

    if (currentValue !== undefined) {
      next[prompt.key] = currentValue;
    }
  }

  return next;
};

const hasInteractiveTerminal = () => input.isTTY && output.isTTY;

export const runCliConfigInit = async (
  configPath?: string,
  ask?: ConfigInitQuestion
) => {
  if (!hasInteractiveTerminal() && !ask) {
    throw error({
      code: "INVALID_ARGUMENT",
      data: "The init command requires an interactive terminal.",
    });
  }

  const current = await readCliConfig(configPath);
  const promptSession = ask
    ? null
    : readline.createInterface({
        input,
        output,
      });

  try {
    const next = await promptCliConfig(
      current,
      ask ?? ((prompt: string) => promptSession!.question(prompt))
    );

    await writeCliConfig(next, configPath);

    return {
      current,
      next,
    };
  } finally {
    promptSession?.close();
  }
};

export const formatCliConfigInitResult = (config: HoppscotchCliConfig) =>
  formatCliConfigForDisplay(config);
