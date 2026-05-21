import fs from "fs/promises";
import os from "os";
import path from "path";
import { describe, expect, test, vi } from "vitest";

import {
  formatCliConfigForDisplay,
  getCliConfigPath,
  readCliConfig,
  resolveCliRuntimeConfig,
  unsetCliConfigKey,
  updateCliConfig,
  writeCliConfig,
} from "../../utils/config";

describe("config utils", () => {
  test("uses XDG config dir when present", () => {
    vi.stubEnv("XDG_CONFIG_HOME", "/tmp/test-xdg");
    expect(getCliConfigPath()).toBe(
      path.join("/tmp/test-xdg", "hoppscotch", "cli.json")
    );
  });

  test("falls back to home config dir when XDG config dir is absent", () => {
    vi.stubEnv("XDG_CONFIG_HOME", "");
    vi.stubEnv("APPDATA", "");
    const expected = path.join(os.homedir(), ".config", "hoppscotch", "cli.json");
    expect(getCliConfigPath()).toBe(expected);
  });

  test("reads missing config file as empty config", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hopp-cli-config-"));
    const configPath = path.join(dir, "cli.json");

    await expect(readCliConfig(configPath)).resolves.toEqual({});
  });

  test("writes and reads config values", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hopp-cli-config-"));
    const configPath = path.join(dir, "cli.json");

    await writeCliConfig(
      {
        server: "https://api.example.com/graphql",
        token: "pat-1234567890",
      },
      configPath
    );

    await expect(readCliConfig(configPath)).resolves.toEqual({
      server: "https://api.example.com/graphql",
      token: "pat-1234567890",
    });
  });

  test("merges runtime config over saved values", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hopp-cli-config-"));
    const configPath = path.join(dir, "cli.json");

    await writeCliConfig(
      {
        server: "https://saved.example.com/graphql",
        token: "pat-saved",
      },
      configPath
    );

    await expect(
      resolveCliRuntimeConfig(
        {
          token: "pat-override",
        },
        configPath
      )
    ).resolves.toEqual({
      server: "https://saved.example.com/graphql",
      token: "pat-override",
    });
  });

  test("can unset a single config key", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hopp-cli-config-"));
    const configPath = path.join(dir, "cli.json");

    await writeCliConfig(
      {
        server: "https://saved.example.com/graphql",
        token: "pat-saved",
      },
      configPath
    );

    await expect(unsetCliConfigKey("token", configPath)).resolves.toEqual({
      server: "https://saved.example.com/graphql",
      token: undefined,
    });
  });

  test("masks token when formatting for display", () => {
    expect(
      formatCliConfigForDisplay({
        server: "https://saved.example.com/graphql",
        token: "pat-1234567890",
      })
    ).toEqual({
      server: "https://saved.example.com/graphql",
      token: "pat-…7890",
    });
  });

  test("updates config values without dropping existing fields", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hopp-cli-config-"));
    const configPath = path.join(dir, "cli.json");

    await writeCliConfig(
      {
        server: "https://saved.example.com/graphql",
      },
      configPath
    );

    await expect(
      updateCliConfig(
        {
          token: "pat-override",
        },
        configPath
      )
    ).resolves.toEqual({
      server: "https://saved.example.com/graphql",
      token: "pat-override",
    });
  });
});
