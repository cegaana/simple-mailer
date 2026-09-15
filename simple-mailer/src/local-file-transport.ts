import { mkdirSync, appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EmailTransport, OutboundMessage, SendOutcome } from "./types.js";

export interface LocalFileTransportOptions {
  /** Directory messages are written to. Created if missing. */
  outDir: string;
  /** Injectable clock, for deterministic tests. */
  now?: () => Date;
}

interface OutboxIndexEntry {
  id: string;
  to: string;
  subject: string;
  sentAt: string;
  dir: string;
}

/**
 * Writes each outgoing message to `outDir` as a human-inspectable folder
 * (subject.txt, body.html, body.txt, envelope.json), plus one line per send
 * appended to `outDir/index.ndjson`.
 *
 * This is a real delivery channel — the default for `cmailer` before Google
 * Workspace credentials exist — not a test double. See `MockTransport` for
 * the in-memory equivalent used by unit tests.
 */
export class LocalFileTransport {
  private counter = 0;

  constructor(private readonly options: LocalFileTransportOptions) {
    mkdirSync(this.options.outDir, { recursive: true });
  }

  /**
   * Declared as an arrow property, not a method, so it can be handed straight
   * to anything expecting an `EmailTransport` without losing `this`.
   */
  readonly send: EmailTransport = async (message) => {
    const start = Date.now();
    this.counter += 1;

    const sentAt = (this.options.now?.() ?? new Date()).toISOString();
    const id = `${sentAt.replace(/[:.]/g, "-")}_${String(this.counter).padStart(4, "0")}`;
    const dir = join(this.options.outDir, id);

    this.write(dir, message, sentAt);

    const outcome: SendOutcome = {
      status: "sent",
      providerMessageId: id,
      latencyMs: Date.now() - start,
    };
    return outcome;
  };

  private write(dir: string, message: OutboundMessage, sentAt: string): void {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "subject.txt"), message.subject, "utf8");
    writeFileSync(join(dir, "body.html"), message.html, "utf8");
    writeFileSync(join(dir, "body.txt"), message.text, "utf8");

    const envelope = {
      to: message.to,
      toName: message.toName,
      subject: message.subject,
      sentAt,
    };
    writeFileSync(join(dir, "envelope.json"), JSON.stringify(envelope, null, 2), "utf8");

    const indexEntry: OutboxIndexEntry = {
      id: dir.split("/").pop() ?? dir,
      to: message.to,
      subject: message.subject,
      sentAt,
      dir,
    };
    appendFileSync(join(this.options.outDir, "index.ndjson"), JSON.stringify(indexEntry) + "\n", "utf8");
  }
}
