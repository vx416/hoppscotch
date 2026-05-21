import { describe, expect, test } from "vitest";

import { runCLI, trimAnsi } from "../../utils";

describe("hopp gen-skill", { timeout: 30000 }, () => {
  test("shows help text for the hoppscotch-cli skill generator", async () => {
    const result = await runCLI("gen-skill --help");

    expect(result.error).toBeNull();
    const stdout = trimAnsi(result.stdout);

    expect(stdout).toContain("Generate the Hoppscotch CLI skill files");
    expect(stdout).toContain("--print");
    expect(stdout).toContain("--force");
    expect(stdout).toContain(".claude/hoppscotch-cli");
    expect(stdout).toContain(".codex/hoppscotch-cli");
  });

  test("prints the hoppscotch-cli skill markdown with --print", async () => {
    const result = await runCLI("gen-skill --print");

    expect(result.error).toBeNull();
    const stdout = trimAnsi(result.stdout);

    expect(stdout).toContain("Hoppscotch CLI");
    expect(stdout).toContain("manage and test APIs with Hoppscotch");
    expect(stdout).toContain("hopp test");
    expect(stdout).toContain("hopp gen-skill");
  });
});
