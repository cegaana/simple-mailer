import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MailerEngine, MockTransport, SqliteProvider, openMailerDatabase } from "@cegaana/simple-mailer";
import { sendCommand } from "../src/commands/send.js";
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

function csvFile(contents: string): string {
  dir = mkdtempSync(join(tmpdir(), "cmailer-send-test-"));
  const path = join(dir, "recipients.csv");
  writeFileSync(path, contents, "utf8");
  return path;
}

function bodyFiles(): { html: string; text: string } {
  dir ??= mkdtempSync(join(tmpdir(), "cmailer-send-test-"));
  const html = join(dir, "body.html");
  const text = join(dir, "body.txt");
  writeFileSync(html, "<p>Hi {{ first_name }}</p>", "utf8");
  writeFileSync(text, "Hi {{ first_name }}", "utf8");
  return { html, text };
}

describe("sendCommand", () => {
  it("upserts the template, creates the campaign, enqueues, and dispatches in one call", async () => {
    const { engine, mock } = setup();
    const { html, text } = bodyFiles();
    const csv = csvFile("email,name,first_name\ncharlie@example.com,Charlie,Charlie\n");

    const code = await sendCommand(
      engine,
      baseFlags({ name: "Test", subject: "Hi {{ first_name }}", template: "welcome", html, text, csv }),
      "mock (test)",
    );

    expect(code).toBe(0);
    expect(mock.delivered).toHaveLength(1);
    expect(mock.delivered[0]!.to).toBe("charlie@example.com");

    const templates = await engine.listTemplates();
    expect(templates).toHaveLength(1);
    expect(templates[0]!.slug).toBe("welcome");
  });

  it("re-running with new body content overwrites the same template (upsert), not a duplicate", async () => {
    const { engine } = setup();
    const first = bodyFiles();
    const csv1 = csvFile("email,name,first_name\ncharlie@example.com,Charlie,Charlie\n");

    await sendCommand(
      engine,
      baseFlags({ name: "Round 1", subject: "Hi", template: "welcome", html: first.html, text: first.text, csv: csv1 }),
      "mock (test)",
    );

    dir = undefined; // fresh temp dir for the second body/csv pair
    const second = bodyFiles();
    writeFileSync(second.html, "<p>UPDATED</p>", "utf8");
    const csv2 = csvFile("email,name,first_name\njane@example.com,Jane,Jane\n");

    await sendCommand(
      engine,
      baseFlags({ name: "Round 2", subject: "Hi", template: "welcome", html: second.html, text: second.text, csv: csv2 }),
      "mock (test)",
    );

    const templates = await engine.listTemplates();
    expect(templates).toHaveLength(1); // still one template, not two
    const rendered = await engine.previewTemplate("welcome", { first_name: "Anyone" });
    expect(rendered.html).toContain("UPDATED");
  });

  it("sends against an existing template when --html/--text are omitted", async () => {
    const { engine, mock } = setup();
    await engine.createTemplate({
      slug: "existing",
      name: "Existing",
      subject: "Hi {{ first_name }}",
      bodyHtml: "<p>Hi {{ first_name }}</p>",
      bodyText: "Hi {{ first_name }}",
    });
    const csv = csvFile("email,name,first_name\ncharlie@example.com,Charlie,Charlie\n");

    const code = await sendCommand(
      engine,
      baseFlags({ name: "Test", subject: "Hi {{ first_name }}", template: "existing", csv }),
      "mock (test)",
    );

    expect(code).toBe(0);
    expect(mock.delivered).toHaveLength(1);
  });

  it("throws when only one of --html/--text is given", async () => {
    const { engine } = setup();
    const { html } = bodyFiles();
    const csv = csvFile("email\ncharlie@example.com\n");

    await expect(
      sendCommand(engine, baseFlags({ name: "Test", subject: "Hi", template: "welcome", html, csv }), "mock (test)"),
    ).rejects.toThrow(/--text/);
  });

  it("sends using --config and --preset resolving template, subject, and html/text paths", async () => {
    const { engine, mock } = setup();
    bodyFiles();
    const configPath = join(dir!, "manifest.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        vip: {
          name: "VIP Registration",
          slug: "vip-pass",
          subject: "Welcome VIP {{ first_name }}",
          html: "body.html",
          text: "body.txt",
        },
      }),
      "utf8",
    );
    const csv = csvFile("email,name,first_name\nvip@example.com,VIP User,VIP\n");

    const code = await sendCommand(
      engine,
      baseFlags({ config: configPath, preset: "vip", csv }),
      "mock (test)",
    );

    expect(code).toBe(0);
    expect(mock.delivered).toHaveLength(1);
    expect(mock.delivered[0]!.to).toBe("vip@example.com");

    const templates = await engine.listTemplates();
    expect(templates).toHaveLength(1);
    expect(templates[0]!.slug).toBe("vip-pass");
  });

  it("fails preflight check in --strict mode when CSV misses required placeholder", async () => {
    const { engine } = setup();
    const { html, text } = bodyFiles(); // has {{ first_name }}
    const csvWithoutFirstName = csvFile("email,name\ncharlie@example.com,Charlie\n");

    await expect(
      sendCommand(
        engine,
        baseFlags({
          name: "Test",
          subject: "Hi {{ first_name }}",
          template: "welcome",
          html,
          text,
          csv: csvWithoutFirstName,
          strict: true,
        }),
        "mock (test)",
      ),
    ).rejects.toThrow(/first_name/);
  });
});
