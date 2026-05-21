import fs from "fs/promises";
import os from "os";
import path from "path";
import { describe, expect, test, vi } from "vitest";

import {
  promptCliConfig,
  runCliConfigInit,
} from "../../utils/config-init";
import { readCliConfig, writeCliConfig } from "../../utils/config";

describe("config init utils", () => {
  test("prompts for config values and keeps existing values on blank answers", async () => {
    const current = {
      server: "https://saved.example.com/graphql",
      token: "saved-token",
      refreshToken: "saved-refresh",
      teamId: "team-1",
      workspaceId: undefined,
    };

    const ask = vi.fn(async (prompt: string) => {
      if (prompt.startsWith("Server URL")) return "";
      if (prompt.startsWith("Access token")) return "new-token";
      if (prompt.startsWith("Refresh token")) return "";
      if (prompt.startsWith("Team ID")) return "team-2";
      if (prompt.startsWith("Workspace ID")) return "";
      return "";
    });

    await expect(promptCliConfig(current, ask)).resolves.toEqual({
      server: "https://saved.example.com/graphql",
      token: "new-token",
      refreshToken: "saved-refresh",
      teamId: "team-2",
    });
  });

  test("writes init answers to the config file", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hopp-cli-config-init-"));
    const configPath = path.join(dir, "cli.json");

    await writeCliConfig(
      {
        server: "https://saved.example.com/graphql",
      },
      configPath
    );

    const ask = vi.fn(async (prompt: string) => {
      if (prompt.startsWith("Server URL")) return "https://api.example.com/graphql";
      if (prompt.startsWith("Access token")) return "token-123";
      if (prompt.startsWith("Refresh token")) return "refresh-123";
      if (prompt.startsWith("Team ID")) return "team-2";
      if (prompt.startsWith("Workspace ID")) return "workspace-1";
      return "";
    });

    await expect(runCliConfigInit(configPath, ask)).resolves.toMatchObject({
      next: {
        server: "https://api.example.com/graphql",
        token: "token-123",
        refreshToken: "refresh-123",
        teamId: "team-2",
        workspaceId: "workspace-1",
      },
    });

    await expect(readCliConfig(configPath)).resolves.toEqual({
      server: "https://api.example.com/graphql",
      token: "token-123",
      refreshToken: "refresh-123",
      teamId: "team-2",
      workspaceId: "workspace-1",
    });
  });
});
