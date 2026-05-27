import fs from "fs/promises";
import path from "path";

import { error } from "../types/errors";

export type HoppscotchCliSkillGenerationOptions = {
  cwd?: string;
  print?: boolean;
  force?: boolean;
};

export type HoppscotchCliSkillGenerationResult = {
  content: string;
  outputPaths: string[];
};

const SKILL_FILE_NAME = "SKILL.md";
const SKILL_TARGET_DIRS = [".claude", ".codex"] as const;
const SKILL_PACKAGE_DIR = "hoppscotch-cli";

const quoteYaml = (value: string) => JSON.stringify(value);

const buildWorkflowExample = () => `\`\`\`bash
hopp init
hopp config show
hopp collection list --team team_123
hopp request create "login" collection_123 --request ./request.json --team team_123
hopp request show "collection/path/login" "collection/path"
hopp request run "collection/path/login" "collection/path" --env ./env.json
hopp test ./collection.json --request login --request-map ./request-map.json
hopp gen-skill --print
\`\`\``;

export const buildHoppscotchCliSkillMarkdown = () => {
  const title = "Hoppscotch CLI";
  const description =
    "Use the Hoppscotch CLI to create, manage, and test APIs with Hoppscotch. If a task involves API creation, API management, or API testing, use this skill first.";

  return `---
name: ${quoteYaml("hoppscotch-cli")}
description: ${quoteYaml(description)}
---

# ${title}

## Purpose

Use \`hopp\` to work with Hoppscotch from the command line. This skill is for agents that need to create, manage, or test APIs in Hoppscotch.

Use it to manage and test APIs with Hoppscotch.

If the task is about creating an API, managing an API, or testing an API, use this skill.

The generator writes the Hoppscotch CLI skill files into two agent-specific locations under the current working directory: \`.claude/hoppscotch-cli/SKILL.md\` and \`.codex/hoppscotch-cli/SKILL.md\`.

## When To Use

- Run or debug Hoppscotch collections and requests.
- Manage local CLI config values.
- Create, list, update, or delete workspace collections and environments.
- Generate request-driven test runs with per-request body overrides.
- Generate or refresh this skill set with \`hopp gen-skill\`.

## Quick Commands

- \`hopp --help\` - show top-level help.
- \`hopp init\` - interactively set local config keys.
- \`hopp config show\` - print the stored config.
- \`hopp config get <key>\` - read one config value.
- \`hopp config set <key> <value>\` - persist one config value.
- \`hopp config unset <key>\` - remove a stored config value.
- \`hopp test <collection>\` - execute a collection export or workspace collection.
- \`hopp request show <request> <collection>\` - print the complete saved request JSON without executing it.
- \`hopp request run <request> <collection>\` - run one saved request.
- \`hopp request create <title> <collection> --request <json_or_path>\` - create a workspace request from JSON.
- \`hopp collection list\` - list workspace collections.
- \`hopp collection create|update|delete|use\` - manage collections.
- \`hopp env list|create|apply|update|delete|clear\` - manage environments.
- \`hopp team list\` - list teams available to the current user.
- \`hopp gen-skill\` - generate this skill into \`.claude/hoppscotch-cli/SKILL.md\` and \`.codex/hoppscotch-cli/SKILL.md\`.
- \`hopp gen-skill --print\` - print the Hoppscotch CLI skill markdown without writing files.

## Core Usage Notes

- The CLI reads saved config from the local Hoppscotch CLI config file.
- If you pass a flag, it overrides the stored config for that run.
- Workspace operations usually need a \`server\`, \`token\`, and often a \`teamId\`.
- \`hopp test\` runs saved request data. If a request body is missing, the CLI uses the saved request body shape from the request JSON, not browser UI state.
- \`hopp request show\` is the safest way to inspect the exact saved request JSON, including Hoppscotch GraphQL request exports.
- \`--request-map\` lets you override individual request bodies by exact saved request name during a test run.
- Iteration data from \`--iteration-data\` merges CSV rows into the environment on each iteration.
- \`--legacy-sandbox\` disables the experimental scripting sandbox when a test script needs it.

## Request Map Format

Use a JSON array in a file or inline on the command line:

\`\`\`json
[
  {
    "request_name": "login",
    "request_body": {
      "username": "alice",
      "password": "secret"
    }
  },
  {
    "request_name": "search-user",
    "request_body": {
      "query": "hoppscotch"
    }
  }
]
\`\`\`

- \`request_name\` must match the saved request name exactly.
- \`request_body\` can be a JSON object, array, or string.
- When \`request_body\` is structured JSON, the CLI serializes it before sending the request.

## Request Body Guidance

- For saved requests, put the canonical body in the request JSON.
- Use \`--request-map\` when you need different bodies for different requests during a single test run.
- Use \`request create --request <json_or_path>\` to persist new request bodies into the workspace backend.
- Do not place large \`uint64\`, Snowflake, game UUID, or similar sample IDs in pre-request scripts as body overrides.
- Keep canonical sample bodies visible in the saved request. If CLI tests need to avoid JavaScript number precision loss, use a raw string \`request_body\` in \`--request-map\` or a local fixture instead.

## Workflow

1. Inspect the current config with \`hopp config show\`.
2. Initialize missing config values with \`hopp init\` or \`hopp config init\`.
3. Verify workspace access with \`hopp team list\` or \`hopp collection list --team <team_id>\`.
4. Create or update the needed collections, environments, or requests.
5. Run a request or collection locally with \`hopp request run\` or \`hopp test\`.
6. If test runs need different request bodies, supply \`--request-map\`.
7. If you are updating this skill, regenerate it with \`hopp gen-skill\`.

## File Outputs

The generator writes these files in the current working directory:

- \`.claude/hoppscotch-cli/SKILL.md\`
- \`.codex/hoppscotch-cli/SKILL.md\`

Use \`--print\` to inspect the markdown without writing any files.

## Example

${buildWorkflowExample()}

## Output Contract

- Keep the three copies in sync unless a runtime-specific difference is required.
- Keep command examples aligned with the actual CLI surface.
- Prefer exact request names and explicit collection paths when giving examples.
`;
};

const buildOutputPaths = (cwd: string) => [
  ...SKILL_TARGET_DIRS.map((dir) =>
    path.join(cwd, dir, SKILL_PACKAGE_DIR, SKILL_FILE_NAME)
  ),
];

const isMissingFileError = (err: unknown): err is NodeJS.ErrnoException =>
  !!err && typeof err === "object" && "code" in err && (err as { code?: unknown }).code === "ENOENT";

export const generateHoppscotchCliSkill = async ({
  cwd = process.cwd(),
  print = false,
  force = false,
}: HoppscotchCliSkillGenerationOptions = {}): Promise<HoppscotchCliSkillGenerationResult> => {
  const content = buildHoppscotchCliSkillMarkdown();
  const serializedContent = `${content}\n`;
  const outputPaths = buildOutputPaths(cwd);

  if (print) {
    return {
      content,
      outputPaths,
    };
  }

  for (const outputPath of outputPaths) {
    try {
      const existingContent = await fs.readFile(outputPath, "utf8");

      if (existingContent === serializedContent) {
        continue;
      }

      if (!force) {
        throw error({
          code: "INVALID_ARGUMENT",
          data: `Refusing to overwrite existing file with different content: ${outputPath}. Pass --force to replace it.`,
        });
      }
    } catch (err) {
      if (!isMissingFileError(err)) {
        throw err;
      }
    }
  }

  for (const outputPath of outputPaths) {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, serializedContent, "utf8");
  }

  return {
    content,
    outputPaths,
  };
};
