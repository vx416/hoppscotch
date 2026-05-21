import fs from "fs/promises";
import os from "os";
import path from "path";

import { HoppscotchCliConfig, HoppscotchCliConfigKey } from "../types/config";

const CONFIG_DIR_NAME = "hoppscotch";
const CONFIG_FILE_NAME = "cli.json";

const getConfigBaseDir = () => {
  if (process.env.XDG_CONFIG_HOME) return process.env.XDG_CONFIG_HOME;
  if (process.platform === "win32" && process.env.APPDATA) return process.env.APPDATA;
  return path.join(os.homedir(), ".config");
};

export const getCliConfigPath = () =>
  path.join(getConfigBaseDir(), CONFIG_DIR_NAME, CONFIG_FILE_NAME);

export const maskSecret = (value: string | undefined) => {
  if (!value) return value;
  if (value.length <= 8) return "********";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
};

export const normalizeCliConfig = (
  config: Partial<HoppscotchCliConfig> | null | undefined
): HoppscotchCliConfig => ({
  server: config?.server,
  token: config?.token,
  refreshToken: config?.refreshToken,
  teamId: config?.teamId,
  workspaceId: config?.workspaceId,
  collectionId: config?.collectionId,
  environmentId: config?.environmentId,
});

const mergeDefinedConfigValues = (
  base: HoppscotchCliConfig,
  overrides: Partial<HoppscotchCliConfig>
) => {
  const next: HoppscotchCliConfig = { ...base };

  for (const [key, value] of Object.entries(overrides) as [
    HoppscotchCliConfigKey,
    HoppscotchCliConfig[HoppscotchCliConfigKey],
  ][]) {
    if (value !== undefined) {
      next[key] = value;
    }
  }

  return next;
};

export const readCliConfig = async (
  configPath: string = getCliConfigPath()
): Promise<HoppscotchCliConfig> => {
  try {
    const raw = await fs.readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<HoppscotchCliConfig>;
    return normalizeCliConfig(parsed);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return normalizeCliConfig({});
    }

    throw error;
  }
};

export const writeCliConfig = async (
  config: Partial<HoppscotchCliConfig>,
  configPath: string = getCliConfigPath()
) => {
  const normalized = normalizeCliConfig(config);
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
};

export const updateCliConfig = async (
  update: Partial<HoppscotchCliConfig>,
  configPath: string = getCliConfigPath()
) => {
  const current = await readCliConfig(configPath);
  const next = mergeDefinedConfigValues(current, update);

  await writeCliConfig(next, configPath);
  return next;
};

export const unsetCliConfigKey = async (
  key: HoppscotchCliConfigKey,
  configPath: string = getCliConfigPath()
) => {
  const current = await readCliConfig(configPath);
  const next = normalizeCliConfig({
    ...current,
    [key]: undefined,
  });

  await writeCliConfig(next, configPath);
  return next;
};

export const resolveCliRuntimeConfig = async (
  overrides: Partial<HoppscotchCliConfig>,
  configPath: string = getCliConfigPath()
) => {
  const saved = await readCliConfig(configPath);
  return mergeDefinedConfigValues(saved, overrides);
};

export const formatCliConfigForDisplay = (config: HoppscotchCliConfig) => ({
  ...config,
  token: maskSecret(config.token),
  refreshToken: maskSecret(config.refreshToken),
});
