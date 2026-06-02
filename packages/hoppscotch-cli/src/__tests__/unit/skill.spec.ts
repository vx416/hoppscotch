import fs from "fs/promises";
import os from "os";
import path from "path";
import { describe, expect, test } from "vitest";

import {
  buildHoppscotchCliSkillMarkdown,
  generateHoppscotchCliSkill,
} from "../../utils/skill";

describe("hoppscotch-cli skill generator", () => {
  test("builds markdown with hoppscotch-cli guidance", () => {
    const markdown = buildHoppscotchCliSkillMarkdown();

    expect(markdown).toContain('name: "hoppscotch-cli"');
    expect(markdown).toContain("manage and test APIs with Hoppscotch");
    expect(markdown).toContain("hopp gen-skill");
    expect(markdown).toContain("request-map");
    expect(markdown).toContain("Iteration data");
    expect(markdown).toContain("Request Create JSON Format");
    expect(markdown).toContain("body.body");
    expect(markdown).toContain("Response Examples For Documentation");
    expect(markdown).toContain("originalRequest");
    expect(markdown).toContain(".claude/hoppscotch-cli/SKILL.md");
  });

  test("writes the skill into .claude/hoppscotch-cli/SKILL.md and .codex/hoppscotch-cli/SKILL.md", async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "hopp-skill-"));

    const result = await generateHoppscotchCliSkill({
      cwd: baseDir,
    });

    expect(result.outputPaths).toStrictEqual([
      path.join(baseDir, ".claude", "hoppscotch-cli", "SKILL.md"),
      path.join(baseDir, ".codex", "hoppscotch-cli", "SKILL.md"),
    ]);

    await expect(fs.readFile(result.outputPaths[0], "utf8")).resolves.toContain(
      'name: "hoppscotch-cli"'
    );
    await expect(fs.readFile(result.outputPaths[1], "utf8")).resolves.toContain(
      "The generator writes the Hoppscotch CLI skill files"
    );
  });

  test("prints the skill markdown without writing files", async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "hopp-skill-print-"));

    const result = await generateHoppscotchCliSkill({
      cwd: baseDir,
      print: true,
    });

    expect(result.content).toContain("Hoppscotch CLI");
    await expect(
      fs.access(path.join(baseDir, ".claude", "hoppscotch-cli", "SKILL.md"))
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(baseDir, ".codex", "hoppscotch-cli", "SKILL.md"))
    ).rejects.toThrow();
  });

  test("allows rerunning when existing skill files already match the generated content", async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "hopp-skill-rerun-"));
    const content = buildHoppscotchCliSkillMarkdown();
    const serializedContent = `${content}\n`;

    await fs.mkdir(path.join(baseDir, ".claude", "hoppscotch-cli"), {
      recursive: true,
    });
    await fs.mkdir(path.join(baseDir, ".codex", "hoppscotch-cli"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(baseDir, ".claude", "hoppscotch-cli", "SKILL.md"),
      serializedContent,
      "utf8"
    );
    await fs.writeFile(
      path.join(baseDir, ".codex", "hoppscotch-cli", "SKILL.md"),
      serializedContent,
      "utf8"
    );

    await expect(
      generateHoppscotchCliSkill({
        cwd: baseDir,
      })
    ).resolves.toMatchObject({
      outputPaths: [
        path.join(baseDir, ".claude", "hoppscotch-cli", "SKILL.md"),
        path.join(baseDir, ".codex", "hoppscotch-cli", "SKILL.md"),
      ],
    });
  });
});
