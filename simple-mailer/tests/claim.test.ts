import Database from "better-sqlite3";
import { describe, it, expect } from "vitest";
import { initSchema } from "../src/schema.js";
import { SqliteProvider } from "../src/sqlite-provider.js";
import type { RecipientInput } from "../src/types.js";

const T0 = "2026-09-06T12:00:00.000Z";
const LATER = "2026-09-06T13:00:00.000Z";

function setup() {
  const db = new Database(":memory:");
  initSchema(db);
  const provider = new SqliteProvider(db);
  const campaignId = provider.createCampaign({
    name: "Alumni Meet 2026",
    subject: "Speaker briefing",
    templateId: "tpl-speaker-invite",
  });
  return { db, provider, campaignId };
}

const people = (n: number): RecipientInput[] =>
  Array.from({ length: n }, (_, i) => ({
    email: `person${i + 1}@example.com`,
    name: `Person ${i + 1}`,
    metadata: { first_name: `Person${i + 1}` },
  }));

const statusOf = (db: Database.Database, email: string) =>
  (db.prepare("SELECT status, locked_at FROM _mailer_queue WHERE email = ?").get(email) as
    { status: string; locked_at: string | null });

describe("claimDueJobs", () => {
  it("claims a due job, returns it, and marks the row processing", () => {
    const { db, provider, campaignId } = setup();
    provider.enqueueRecipients(campaignId, people(1), "2020-01-01T00:00:00.000Z");

    const claimed = provider.claimDueJobs(campaignId, 10, LATER);

    expect(claimed).toHaveLength(1);
    expect(claimed[0]!.email).toBe("person1@example.com");
    expect(claimed[0]!.metadata).toEqual({ first_name: "Person1" });
    expect(claimed[0]!.attempts).toBe(0);
    expect(claimed[0]!.maxAttempts).toBe(3);

    const row = statusOf(db, "person1@example.com");
    expect(row.status).toBe("processing");
    expect(row.locked_at).toBe(LATER);
  });

  it("ignores a job whose next_attempt_at is in the future", () => {
    const { db, provider, campaignId } = setup();
    provider.enqueueRecipients(campaignId, people(1), "2020-01-01T00:00:00.000Z");

    // Pretend a failed send pushed it into backoff.
    db.prepare("UPDATE _mailer_queue SET status = 'retrying', next_attempt_at = ?")
      .run("2026-09-06T12:30:00.000Z");

    expect(provider.claimDueJobs(campaignId, 10, T0)).toHaveLength(0);
    // ...and it becomes claimable once its time arrives.
    expect(provider.claimDueJobs(campaignId, 10, LATER)).toHaveLength(1);
  });

  it("ignores a job already being processed", () => {
    const { db, provider, campaignId } = setup();
    provider.enqueueRecipients(campaignId, people(1), "2020-01-01T00:00:00.000Z");
    db.prepare("UPDATE _mailer_queue SET status = 'processing'").run();

    expect(provider.claimDueJobs(campaignId, 10, LATER)).toHaveLength(0);
  });

  it("respects the limit", () => {
    const { provider, campaignId } = setup();
    provider.enqueueRecipients(campaignId, people(5), "2020-01-01T00:00:00.000Z");

    expect(provider.claimDueJobs(campaignId, 2, LATER)).toHaveLength(2);
  });

  it("does not hand the same job out twice", () => {
    const { provider, campaignId } = setup();
    provider.enqueueRecipients(campaignId, people(3), "2020-01-01T00:00:00.000Z");

    const first = provider.claimDueJobs(campaignId, 10, LATER);
    const second = provider.claimDueJobs(campaignId, 10, LATER);

    expect(first).toHaveLength(3);
    expect(second).toHaveLength(0);
  });

  it("does not claim jobs belonging to another campaign", () => {
    const { provider, campaignId } = setup();
    const other = provider.createCampaign({
      name: "Other",
      subject: "s",
      templateId: "t",
    });
    provider.enqueueRecipients(campaignId, people(2), "2020-01-01T00:00:00.000Z");
    provider.enqueueRecipients(other, people(2), "2020-01-01T00:00:00.000Z");

    expect(provider.claimDueJobs(other, 10, LATER)).toHaveLength(2);
  });
});
