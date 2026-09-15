import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Loads environment variables for the CLI from `cwd` (default the current
 * working directory) — preferring `.env` (conventionally a symlink to
 * `.env.local`, see docs/setup-google-workspace.md) and falling back to
 * `.env.local` directly so the symlink step is optional. A no-op if neither
 * file exists; real environment variables and CLI flags both still work
 * either way, since transport.ts only reads process.env as a fallback.
 */
export function loadDotEnv(cwd: string = process.cwd()): void {
  for (const filename of [".env", ".env.local"]) {
    const path = join(cwd, filename);
    if (existsSync(path)) {
      process.loadEnvFile(path);
      return;
    }
  }
}
