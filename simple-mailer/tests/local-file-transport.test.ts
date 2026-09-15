import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalFileTransport } from "../src/local-file-transport.js";
import type { OutboundMessage } from "../src/types.js";

const message = (to: string): OutboundMessage => ({
  to,
  toName: "Charlie Brown",
  subject: "Speaker briefing for Charlie",
  html: "<p>Dear Charlie,</p>",
  text: "Dear Charlie,",
});

let outDir: string;

beforeEach(() => {
  outDir = mkdtempSync(join(tmpdir(), "local-file-transport-test-"));
});

afterEach(() => {
  rmSync(outDir, { recursive: true, force: true });
});

describe("LocalFileTransport", () => {
  it("writes each message as an inspectable folder and reports 'sent'", async () => {
    const transport = new LocalFileTransport({ outDir });

    const outcome = await transport.send(message("charlie@example.com"));

    expect(outcome.status).toBe("sent");

    const entries = readdirSync(outDir).filter((e) => e !== "index.ndjson");
    expect(entries).toHaveLength(1);

    const dir = join(outDir, entries[0]!);
    expect(readFileSync(join(dir, "subject.txt"), "utf8")).toBe("Speaker briefing for Charlie");
    expect(readFileSync(join(dir, "body.html"), "utf8")).toBe("<p>Dear Charlie,</p>");
    expect(readFileSync(join(dir, "body.txt"), "utf8")).toBe("Dear Charlie,");

    const envelope = JSON.parse(readFileSync(join(dir, "envelope.json"), "utf8"));
    expect(envelope.to).toBe("charlie@example.com");
    expect(envelope.subject).toBe("Speaker briefing for Charlie");
  });

  it("appends one line per send to index.ndjson", async () => {
    const transport = new LocalFileTransport({ outDir });

    await transport.send(message("a@example.com"));
    await transport.send(message("b@example.com"));

    const lines = readFileSync(join(outDir, "index.ndjson"), "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).to).toBe("a@example.com");
    expect(JSON.parse(lines[1]!).to).toBe("b@example.com");
  });

  it("can be handed around as a bare EmailTransport function", async () => {
    const transport = new LocalFileTransport({ outDir });

    const send = transport.send;
    const outcome = await send(message("charlie@example.com"));

    expect(outcome.status).toBe("sent");
  });
});
