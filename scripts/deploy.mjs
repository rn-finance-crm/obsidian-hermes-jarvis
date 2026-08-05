#!/usr/bin/env node

/**
 * Cross-platform replacement for deploy.sh.
 *
 * deploy.sh works fine on macOS/Linux, but Windows cannot exec a .sh file
 * directly and npm scripts run through cmd.exe, so `./deploy.sh` fails there.
 * This script does the same job in pure Node so the dev watch loop works
 * everywhere.
 *
 * Two other differences from deploy.sh, both deliberate:
 *   - it loads .env itself (the repo has no dotenv dependency, so TARGET_DEV
 *     in .env was previously ignored unless exported in the shell)
 *   - the destination folder name is configurable via PLUGIN_DIR, because a
 *     BRAT-installed vault uses the manifest id (hermes-voice-assistant)
 *     rather than the hardcoded "plugin-hermes".
 *
 * Usage: node scripts/deploy.mjs [dev|prod]
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACTS = ["manifest.json", "main.js", "styles.css"];
const DEFAULT_PLUGIN_DIR = "hermes-voice-assistant";

/** Minimal .env reader — only KEY=VALUE lines, no interpolation. */
function loadEnvFile() {
  const envPath = join(repoRoot, ".env");
  if (!existsSync(envPath)) return;

  for (const rawLine of readFileSync(envPath, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");

    // Real environment variables win over .env, matching dotenv's behaviour.
    if (!(key in process.env)) process.env[key] = value;
  }
}

/** Expands a leading ~ so .env stays portable between machines. */
function expandHome(p) {
  return p.startsWith("~") ? join(homedir(), p.slice(1)) : p;
}

function main() {
  loadEnvFile();

  const mode = process.argv[2] ?? "dev";
  if (mode !== "dev" && mode !== "prod") {
    console.error("Usage: node scripts/deploy.mjs [dev|prod]");
    process.exit(1);
  }

  const varName = mode === "prod" ? "TARGET_PROD" : "TARGET_DEV";
  const target = process.env[varName];

  // Not configured is not an error: it just means "don't deploy", so that
  // `pnpm build` still works for anyone without a vault set up.
  if (!target) {
    console.log(`Deploy: ${varName} not set, skipping.`);
    return;
  }

  const missing = ARTIFACTS.filter((f) => !existsSync(join(repoRoot, f)));
  if (missing.length > 0) {
    console.error(`Deploy: missing build files: ${missing.join(" ")}`);
    process.exit(1);
  }

  const pluginDir = join(
    expandHome(target),
    ".obsidian",
    "plugins",
    process.env.PLUGIN_DIR || DEFAULT_PLUGIN_DIR,
  );

  mkdirSync(pluginDir, { recursive: true });

  for (const file of ARTIFACTS) {
    copyFileSync(join(repoRoot, file), join(pluginDir, file));
  }

  // data.json lives in that folder and holds the API keys plus chat history.
  // It is never written here — only the three build artifacts are copied.
  console.log(`Deploy: copied ${ARTIFACTS.join(", ")} to ${pluginDir}`);
}

main();
