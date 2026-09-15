import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { selectTransport } from "../src/transport.js";

let outDir: string | undefined;

afterEach(() => {
  if (outDir) rmSync(outDir, { recursive: true, force: true });
  outDir = undefined;
});

describe("selectTransport", () => {
  it("defaults to local-file, creating the output directory", () => {
    outDir = join(mkdtempSync(join(tmpdir(), "cmailer-transport-test-")), "outbox");

    const { description } = selectTransport({ "out-dir": outDir });

    expect(description).toContain("local-file");
    expect(existsSync(outDir)).toBe(true);
  });

  it("selects mock when --transport mock is passed", () => {
    const { description } = selectTransport({ transport: "mock" });
    expect(description).toContain("mock");
  });

  it("throws on an unknown --transport value", () => {
    expect(() => selectTransport({ transport: "carrier-pigeon" })).toThrow(/Unknown --transport/);
  });
});

describe("selectTransport — google-workspace", () => {
  const ENV_KEYS = [
    "MAILER_GOOGLE_USER_EMAIL",
    "MAILER_GOOGLE_CLIENT_ID",
    "MAILER_GOOGLE_CLIENT_SECRET",
    "MAILER_GOOGLE_REFRESH_TOKEN",
  ] as const;

  afterEach(() => {
    for (const key of ENV_KEYS) delete process.env[key];
  });

  it("throws naming every missing credential when none are supplied", () => {
    expect(() => selectTransport({ transport: "google-workspace" })).toThrow(
      /userEmail.*clientId.*clientSecret.*refreshToken/s,
    );
  });

  it("selects google-workspace once all four flags are supplied", () => {
    const { description } = selectTransport({
      transport: "google-workspace",
      "google-user": "events@cegaana.org",
      "google-client-id": "client-id",
      "google-client-secret": "client-secret",
      "google-refresh-token": "refresh-token",
    });

    expect(description).toBe("google-workspace (events@cegaana.org)");
  });

  it("falls back to MAILER_GOOGLE_* environment variables when flags are omitted", () => {
    process.env.MAILER_GOOGLE_USER_EMAIL = "events@cegaana.org";
    process.env.MAILER_GOOGLE_CLIENT_ID = "client-id";
    process.env.MAILER_GOOGLE_CLIENT_SECRET = "client-secret";
    process.env.MAILER_GOOGLE_REFRESH_TOKEN = "refresh-token";

    const { description } = selectTransport({ transport: "google-workspace" });

    expect(description).toBe("google-workspace (events@cegaana.org)");
  });

  it("prefers an explicit flag over the matching environment variable", () => {
    process.env.MAILER_GOOGLE_USER_EMAIL = "env-account@cegaana.org";
    process.env.MAILER_GOOGLE_CLIENT_ID = "client-id";
    process.env.MAILER_GOOGLE_CLIENT_SECRET = "client-secret";
    process.env.MAILER_GOOGLE_REFRESH_TOKEN = "refresh-token";

    const { description } = selectTransport({
      transport: "google-workspace",
      "google-user": "flag-account@cegaana.org",
    });

    expect(description).toBe("google-workspace (flag-account@cegaana.org)");
  });
});
