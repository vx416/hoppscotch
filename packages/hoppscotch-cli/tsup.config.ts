import { defineConfig } from "tsup";
import { execFileSync } from "node:child_process";

const getCommitHash = () => {
  const envHash =
    process.env.HOPP_COMMIT_HASH ??
    process.env.HOPPSCOTCH_CLI_COMMIT_HASH ??
    process.env.GIT_COMMIT ??
    process.env.COMMIT_SHA ??
    process.env.VERCEL_GIT_COMMIT_SHA;

  if (envHash?.trim()) return envHash.trim();

  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
};

export default defineConfig({
  entry: ["./src/index.ts"],
  outDir: "./dist/",
  format: ["esm"],
  platform: "node",
  sourcemap: true,
  bundle: true,
  target: "esnext",
  define: {
    __HOPP_COMMIT_HASH__: JSON.stringify(getCommitHash()),
  },
  skipNodeModulesBundle: false,
  esbuildOptions(options) {
    options.bundle = true;
  },
  clean: true,
});
