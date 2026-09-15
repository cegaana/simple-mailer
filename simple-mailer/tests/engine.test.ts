import Database from "better-sqlite3";
import { describe, it, expect } from "vitest";
import { initSchema } from "../src/schema.js";
import { SqliteProvider } from "../src/sqlite-provider.js";
import { MailerEngine } from "../src/engine.js";
import type { MailerEngineOptions } from "../src/engine.js";
import { MockTransport } from "../src/mock-transport.js";
import type { RecipientInput } from "../src/types.js";
import type { MockTransportOptions } from "../src/mock-transport.js";

const START = "2026-09-06T12:00:00.000Z";

/**
 * A controllable clock. Every engine timestamp comes from here, so tests can
 * jump an hour forward instead of sleeping — the reason `now` is injected
 * rather than read from SQLite.
 */
function clock(start = START) {
  let t = new Date(start).getTime();
  return {
    now: () => new Date(t).toISOString(),
    advance: (ms: number) => { t += ms; },
  };
}

async function setup(mockOptions: MockTransportOptions = {}, engineOptions: Partial<MailerEngineOptions> = {}) {
  const db = new Database(":memory:");
  initSchema(db);
  const provider = new SqliteProvider(db);
  const transport = new MockTransport(mockOptions);
  const time = clock();

  const engine = new MailerEngine(provider, {
    transport: transport.send,
    now: time.now,
    sleep: async () => {},          // pacing is exercised, not waited on
    delayMs: 0,
    ...engineOptions,
  });

  await engine.createTemplate({
    slug: "speaker-invite",
    name: "Speaker invite",
    subject: "Invitation for {{ first_name }}",
    bodyHtml: "<p>Dear {{ first_name | default('Friend') }},</p>",
    bodyText: "Dear {{ first_name | default('Friend') }},",
  });

  const campaignId = await engine.createCampaign({
    name: "Alumni Meet 2026",
    subject: "Speaker briefing for {{ first_name }}",
    templateId: "speaker-invite",
  });

  return { db, provider, transport, engine, campaignId, time };
}

const people = (n: number): RecipientInput[] =>
  Array.from({ length: n }, (_, i) => ({
    email: `person${i + 1}@example.com`,
    name: `Person ${i + 1}`,
    metadata: { first_name: `Person${i + 1}` },
  }));

const jobStatus = (db: Database.Database, email: string) =>
  db.prepare("SELECT status, attempts FROM _mailer_queue WHERE email = ?").get(email) as
    { status: string; attempts: number };

const campaignStatus = (db: Database.Database, id: string) =>
  (db.prepare("SELECT status FROM _mailer_campaigns WHERE id = ?").get(id) as { status: string }).status;

describe("validation", () => {
  it("refuses a campaign whose template does not exist", async () => {
    const { engine } = await setup();
    await expect(
      engine.createCampaign({ name: "n", subject: "s", templateId: "nope" }),
    ).rejects.toThrow(/No template/);
  });

  it("refuses to enqueue against an unknown campaign", async () => {
    const { engine } = await setup();
    await expect(engine.enqueueRecipients("nope", people(1))).rejects.toThrow(/No campaign/);
  });
});

describe("previewTemplate", () => {
  it("throws on a missing variable with no default (strict by default)", async () => {
    const { engine } = await setup();
    // The template's subject is "Invitation for {{ first_name }}" — no default.
    await expect(engine.previewTemplate("speaker-invite", {})).rejects.toThrow(
      /Missing template variable "first_name"/,
    );
  });

  it("renders once the missing variable is supplied", async () => {
    const { engine } = await setup();
    const rendered = await engine.previewTemplate("speaker-invite", { first_name: "Charlie" });
    expect(rendered.subject).toBe("Invitation for Charlie");
  });

  it("can opt back into lenient (empty-string) rendering", async () => {
    const { engine } = await setup();
    const rendered = await engine.previewTemplate("speaker-invite", {}, { strict: false });
    expect(rendered.subject).toBe("Invitation for ");
  });
});

describe("dispatch — happy path", () => {
  it("sends every recipient and completes the campaign", async () => {
    const { db, engine, transport, campaignId } = await setup();
    await engine.enqueueRecipients(campaignId, people(3));

    const report = await engine.dispatch(campaignId);

    expect(report.status).toBe("completed");
    expect(report.sentCount).toBe(3);
    expect(report.totalProcessed).toBe(3);
    expect(transport.delivered).toHaveLength(3);
    expect(campaignStatus(db, campaignId)).toBe("completed");
    expect(jobStatus(db, "person1@example.com")).toEqual({ status: "sent", attempts: 1 });
  });

  it("renders per-recipient merge data into the subject and body", async () => {
    const { engine, transport, campaignId } = await setup();
    await engine.enqueueRecipients(campaignId, people(1));

    await engine.dispatch(campaignId);

    expect(transport.delivered[0]!.subject).toBe("Speaker briefing for Person1");
    expect(transport.delivered[0]!.html).toBe("<p>Dear Person1,</p>");
  });

  it("writes one audit log row per attempt", async () => {
    const { db, engine, campaignId } = await setup();
    await engine.enqueueRecipients(campaignId, people(2));

    await engine.dispatch(campaignId);

    const logs = db.prepare("SELECT status, provider_message_id FROM _mailer_logs").all() as
      Array<{ status: string; provider_message_id: string | null }>;
    expect(logs).toHaveLength(2);
    expect(logs.every((l) => l.status === "sent" && l.provider_message_id !== null)).toBe(true);
  });

  it("reports progress for each recipient", async () => {
    const { engine, campaignId } = await setup();
    await engine.enqueueRecipients(campaignId, people(2));

    const seen: number[] = [];
    await engine.dispatch(campaignId, { onProgress: (p) => seen.push(p.percent) });

    expect(seen).toEqual([50, 100]);
  });
});

describe("dispatch — failures", () => {
  it("sends a permanent failure straight to failed, without retrying", async () => {
    const { db, engine, campaignId } = await setup({
      outcomeFor: { "person1@example.com": "permanent_failure" },
    });
    await engine.enqueueRecipients(campaignId, people(2));

    const report = await engine.dispatch(campaignId);

    expect(report.failedCount).toBe(1);
    expect(report.sentCount).toBe(1);
    expect(jobStatus(db, "person1@example.com")).toEqual({ status: "failed", attempts: 1 });
  });

  it("puts a transient failure into retrying with backoff, then retries later", async () => {
    const { db, engine, campaignId, time, transport } = await setup({
      outcomeFor: { "person1@example.com": "transient_failure" },
    });
    await engine.enqueueRecipients(campaignId, people(1));

    const first = await engine.dispatch(campaignId);
    expect(first.retriedCount).toBe(1);
    expect(jobStatus(db, "person1@example.com")).toEqual({ status: "retrying", attempts: 1 });
    // Still 'running': work remains, but a job in backoff is not a pause.
    // 'paused' is reserved for a rate-limit abort or a human (§11).
    expect(campaignStatus(db, campaignId)).toBe("running");

    // Not yet due: backoff is 30s.
    expect((await engine.dispatch(campaignId)).totalProcessed).toBe(0);

    // Once the backoff elapses it becomes claimable again.
    time.advance(31_000);
    expect((await engine.dispatch(campaignId)).totalProcessed).toBe(1);
    expect(transport.attemptsFor("person1@example.com")).toBe(2);
  });

  it("gives up after maxRetries + 1 attempts", async () => {
    const { db, engine, campaignId, time, transport } = await setup(
      { outcomeFor: { "person1@example.com": "transient_failure" } },
      { maxRetries: 2 },
    );
    await engine.enqueueRecipients(campaignId, people(1));

    for (let i = 0; i < 3; i++) {
      await engine.dispatch(campaignId);
      time.advance(60 * 60 * 1000);
    }

    // maxRetries 2 means three attempts total — the +1 conversion, in practice.
    expect(transport.attemptsFor("person1@example.com")).toBe(3);
    expect(jobStatus(db, "person1@example.com")).toEqual({ status: "failed", attempts: 3 });
    expect(campaignStatus(db, campaignId)).toBe("completed");
  });
});

describe("dispatch — rate limit abort (§11)", () => {
  it("stops the run, pauses the campaign, and leaves the rest untouched", async () => {
    const { db, engine, transport, campaignId } = await setup({ rateLimitAfter: 2 });
    await engine.enqueueRecipients(campaignId, people(5));

    const report = await engine.dispatch(campaignId);

    expect(report.status).toBe("aborted");
    expect(report.abortReason).toMatch(/rate limit/i);
    expect(report.sentCount).toBe(2);
    expect(campaignStatus(db, campaignId)).toBe("paused");

    // Third recipient is retrying; nothing after it was attempted.
    expect(transport.attempts).toHaveLength(3);
    expect(jobStatus(db, "person3@example.com").status).toBe("retrying");
  });
});

describe("lease recovery (§8)", () => {
  it("returns a job abandoned in processing once its lease expires", async () => {
    const { db, engine, provider, campaignId, time } = await setup();
    await engine.enqueueRecipients(campaignId, people(1));

    // Simulate a worker that claimed the job and then died.
    provider.claimDueJobs(campaignId, 10, time.now());
    expect(jobStatus(db, "person1@example.com").status).toBe("processing");

    // Before the lease expires, nothing is reclaimed.
    expect(engine.reclaimExpiredLeases()).toBe(0);

    time.advance(61_000);
    expect(engine.reclaimExpiredLeases()).toBe(1);
    expect(jobStatus(db, "person1@example.com").status).toBe("retrying");

    // And dispatch picks it back up — at-least-once, as documented.
    expect((await engine.dispatch(campaignId)).sentCount).toBe(1);
  });
});

describe("stats", () => {
  it("returns counts that sum to totalQueued", async () => {
    const { engine, campaignId } = await setup({
      outcomeFor: { "person1@example.com": "permanent_failure" },
    });
    await engine.enqueueRecipients(campaignId, people(3));
    await engine.dispatch(campaignId);

    const stats = await engine.getCampaignStats(campaignId);

    expect(stats.totalQueued).toBe(3);
    expect(stats.sentCount).toBe(2);
    expect(stats.failedCount).toBe(1);
    expect(stats.successRate).toBe("66.7%");

    const sum =
      stats.pendingCount + stats.processingCount + stats.retryingCount +
      stats.sentCount + stats.failedCount + stats.cancelledCount;
    expect(sum).toBe(stats.totalQueued);
  });
});

describe("suppression (§9)", () => {
  it("keeps a suppressed address out of the queue entirely", async () => {
    const { engine, transport, campaignId } = await setup();
    await engine.addSuppression("person2@example.com", "unsubscribe");

    const result = await engine.enqueueRecipients(campaignId, people(3));
    expect(result).toEqual({ queuedCount: 2, duplicateCount: 0, suppressedCount: 1 });

    await engine.dispatch(campaignId);
    expect(transport.delivered.map((m) => m.to)).not.toContain("person2@example.com");
  });
});

describe("scheduling (§4)", () => {
  it("does not send a campaign before its scheduled_at", async () => {
    const { engine, transport, time } = await setup();
    const scheduled = await engine.createCampaign({
      name: "Next week",
      subject: "s",
      templateId: "speaker-invite",
      scheduledAt: "2026-09-13T09:00:00.000Z",
    });
    await engine.enqueueRecipients(scheduled, people(1));

    expect((await engine.dispatch(scheduled)).totalProcessed).toBe(0);
    expect(transport.delivered).toHaveLength(0);

    // ...and sends once the time arrives. scheduled_at and retry backoff are
    // the same mechanism: both are just next_attempt_at.
    time.advance(8 * 24 * 60 * 60 * 1000);
    expect((await engine.dispatch(scheduled)).sentCount).toBe(1);
  });

  it("takes next_attempt_at from the engine clock, not the system clock", async () => {
    // Guards a flake that actually happened: enqueue used to let the DDL
    // default fill next_attempt_at from the wall clock, so the suite passed in
    // the morning and failed in the evening.
    const { db, engine, campaignId } = await setup();
    await engine.enqueueRecipients(campaignId, people(1));

    const row = db.prepare("SELECT next_attempt_at FROM _mailer_queue").get() as
      { next_attempt_at: string };
    expect(row.next_attempt_at).toBe(START);
  });
});

describe("lifecycle guards (§11)", () => {
  it("refuses to dispatch a cancelled campaign", async () => {
    const { provider, engine, campaignId, transport, time } = await setup();
    await engine.enqueueRecipients(campaignId, people(1));
    provider.updateCampaignStatus(campaignId, "cancelled", time.now());

    await expect(engine.dispatch(campaignId)).rejects.toThrow(/cancelled/);
    expect(transport.delivered).toHaveLength(0);
  });

  it("leaves a campaign 'running' when the batch limit cuts the run short", async () => {
    const { db, engine, campaignId } = await setup();
    await engine.enqueueRecipients(campaignId, people(3));

    const report = await engine.dispatch(campaignId, { limit: 1 });

    expect(report.status).toBe("completed");   // the run finished normally
    expect(report.sentCount).toBe(1);
    expect(campaignStatus(db, campaignId)).toBe("running");  // the campaign has not
  });
});
