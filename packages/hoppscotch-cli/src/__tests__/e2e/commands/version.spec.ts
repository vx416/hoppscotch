import { describe, expect, test } from "vitest";

import { runCLI } from "../../utils";

describe("hopp version", { timeout: 30000 }, () => {
  test("prints the CLI version and commit hash as JSON", async () => {
    const result = await runCLI("version");

    expect(result.error).toBeNull();

    const output = JSON.parse(result.stdout);

    expect(output.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(output.commitHash).toMatch(/^[0-9a-f]{40}$|^unknown$/);
  });
});
