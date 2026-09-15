import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MailerEngine, MockTransport, SqliteProvider, openMailerDatabase } from "@cegaana/simple-mailer";
import { templateCheck } from "../src/commands/template.js";
import type { CliFlags } from "../src/flags.js";

function setup() {
  const db = openMailerDatabase(":memory:");
  const provider = new SqliteProvider(db);
  const mock = new MockTransport();
  const engine = new MailerEngine(provider, { transport: mock.send, delayMs: 0 });
  return { engine, mock };
}

function baseFlags(overrides: Partial<CliFlags>): CliFlags {
  return { db: ":memory:", "dry-run": false, help: false, version: false, strict: false, ...overrides };
}

let dir: string | undefined;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

function createTestFiles(): { html: string; text: string; csv: string; config: string } {
  dir = mkdtempSync(join(tmpdir(), "cmailer-template-check-test-"));
  const html = join(dir, "body.html");
  const text = join(dir, "body.txt");
  const csv = join(dir, "recipients.csv");
  const config = join(dir, "tickets.json");

  writeFileSync(html, "<p>Hello {{ first_name }}, your code is {{ ticket_code | default('PENDING') }}</p>", "utf8");
  writeFileSync(text, "Hello {{ first_name }}, your code is {{ ticket_code | default('PENDING') }}", "utf8");
  writeFileSync(csv, "email,name,first_name\nuser@example.com,User,Alex\n", "utf8");
  writeFileSync(
    config,
    JSON.stringify({
      general: {
        name: "General Ticket",
        slug: "general-ticket",
        subject: "Confirmation for {{ first_name }}",
        html: "body.html",
        text: "body.txt",
      },
    }),
    "utf8",
  );

  return { html, text, csv, config };
}

describe("templateCheck", () => {
  it("passes validation when all required variables are present in CSV", async () => {
    const { engine } = setup();
    const { html, text, csv } = createTestFiles();

    const code = await templateCheck(
      engine,
      baseFlags({ html, text, csv, subject: "Welcome" }),
      ["template", "check"],
    );

    expect(code).toBe(0);
  });

  it("fails validation when a required variable is missing from CSV", async () => {
    const { engine } = setup();
    const { html, text } = createTestFiles();
    const badCsv = join(dir!, "bad.csv");
    writeFileSync(badCsv, "email,name\nuser@example.com,User\n", "utf8");

    const code = await templateCheck(
      engine,
      baseFlags({ html, text, csv: badCsv, subject: "Welcome" }),
      ["template", "check"],
    );

    expect(code).toBe(1);
  });

  it("validates using --config and --preset", async () => {
    const { engine } = setup();
    const { config, csv } = createTestFiles();

    const code = await templateCheck(
      engine,
      baseFlags({ config, preset: "general", csv }),
      ["template", "check"],
    );

    expect(code).toBe(0);
  });
});
