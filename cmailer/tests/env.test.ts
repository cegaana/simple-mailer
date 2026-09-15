import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadDotEnv } from "../src/env.js";

const KEY = "CMAILER_ENV_TEST_VAR";

let dir: string | undefined;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
  delete process.env[KEY];
});

function tempDir(): string {
  dir = mkdtempSync(join(tmpdir(), "cmailer-env-test-"));
  return dir;
}

describe("loadDotEnv", () => {
  it("is a no-op when neither .env nor .env.local exists", () => {
    expect(() => loadDotEnv(tempDir())).not.toThrow();
    expect(process.env[KEY]).toBeUndefined();
  });

  it("loads .env.local when present", () => {
    const cwd = tempDir();
    writeFileSync(join(cwd, ".env.local"), `${KEY}=from-env-local\n`);

    loadDotEnv(cwd);

    expect(process.env[KEY]).toBe("from-env-local");
  });

  it("prefers .env over .env.local when both exist", () => {
    const cwd = tempDir();
    writeFileSync(join(cwd, ".env"), `${KEY}=from-env\n`);
    writeFileSync(join(cwd, ".env.local"), `${KEY}=from-env-local\n`);

    loadDotEnv(cwd);

    expect(process.env[KEY]).toBe("from-env");
  });
});
