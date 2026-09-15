import Database from "better-sqlite3";
import { describe, it, expect } from "vitest";
import { initSchema } from "../src/schema.js";
import { SqliteProvider } from "../src/sqlite-provider.js";
import type { RecipientInput } from "../src/types.js";

/** Fresh in-memory database + provider + one campaign, per test. */
function setup() {
  const db = new Database(":memory:");
  initSchema(db);
  const provider = new SqliteProvider(db);
  const campaignId = provider.createCampaign({
    name: "Alumni Meet 2026",
    subject: "Speaker briefing for {{ first_name }}",
    templateId: "tpl-speaker-invite",
  });
  return { db, provider, campaignId };
}

const CHARLIE: RecipientInput = {
  email: "charlie@example.com",
  name: "Charlie Brown",
  metadata: { first_name: "Charlie", event_name: "CEGAANA Fall Event" },
};

/** Deliberately carries no metadata and no id — the optional-fields case. */
const JANE: RecipientInput = { email: "jane@example.com" };

const queueCount = (db: Database.Database) =>
  (db.prepare("SELECT COUNT(*) AS c FROM _mailer_queue").get() as { c: number }).c;

describe("isSuppressed", () => {
  it("is false for an unknown address and true once suppressed", () => {
    const { db, provider } = setup();

    expect(provider.isSuppressed("nobody@example.com")).toBe(false);

    db.prepare("INSERT INTO _mailer_suppression (email, reason) VALUES (?, ?)")
      .run("spam@example.com", "manual");

    expect(provider.isSuppressed("spam@example.com")).toBe(true);
  });
});

describe("createCampaign", () => {
  it("inserts a campaign that starts as draft", () => {
    const { db, campaignId } = setup();

    expect(campaignId).toBeTruthy();

    const row = db.prepare("SELECT * FROM _mailer_campaigns WHERE id = ?").get(campaignId);
    expect(row).toMatchObject({
      name: "Alumni Meet 2026",
      subject: "Speaker briefing for {{ first_name }}",
      template_id: "tpl-speaker-invite",
      status: "draft",
    });
  });
});

describe("enqueueRecipients", () => {
  it("queues fresh recipients as pending", () => {
    const { db, provider, campaignId } = setup();

    const result = provider.enqueueRecipients(campaignId, [CHARLIE, JANE], "2020-01-01T00:00:00.000Z");

    expect(result).toEqual({ queuedCount: 2, duplicateCount: 0, suppressedCount: 0 });

    const rows = db
      .prepare("SELECT status, attempts, max_attempts FROM _mailer_queue")
      .all() as Array<{ status: string; attempts: number; max_attempts: number }>;

    expect(rows).toHaveLength(2);
    // Engine-owned state comes from the DDL defaults, not from the caller.
    expect(rows.every((r) => r.status === "pending" && r.attempts === 0 && r.max_attempts === 3))
      .toBe(true);
  });

  it("counts duplicates across two calls and adds no rows", () => {
    const { db, provider, campaignId } = setup();

    provider.enqueueRecipients(campaignId, [CHARLIE, JANE], "2020-01-01T00:00:00.000Z");
    const second = provider.enqueueRecipients(campaignId, [CHARLIE, JANE], "2020-01-01T00:00:00.000Z");

    expect(second).toEqual({ queuedCount: 0, duplicateCount: 2, suppressedCount: 0 });
    expect(queueCount(db)).toBe(2);
  });

  it("counts an address repeated inside one batch", () => {
    const { db, provider, campaignId } = setup();

    // The CSV-with-a-repeated-row case.
    const result = provider.enqueueRecipients(campaignId, [CHARLIE, CHARLIE], "2020-01-01T00:00:00.000Z");

    expect(result).toEqual({ queuedCount: 1, duplicateCount: 1, suppressedCount: 0 });
    expect(queueCount(db)).toBe(1);
  });

  it("skips suppressed addresses without queueing them", () => {
    const { db, provider, campaignId } = setup();

    db.prepare("INSERT INTO _mailer_suppression (email, reason) VALUES (?, ?)")
      .run(CHARLIE.email, "unsubscribe");

    const result = provider.enqueueRecipients(campaignId, [CHARLIE, JANE], "2020-01-01T00:00:00.000Z");

    expect(result).toEqual({ queuedCount: 1, duplicateCount: 0, suppressedCount: 1 });

    const emails = db.prepare("SELECT email FROM _mailer_queue").all();
    expect(emails).toEqual([{ email: JANE.email }]);
  });

  it("snapshots metadata, defaulting to an empty object", () => {
    const { db, provider, campaignId } = setup();

    provider.enqueueRecipients(campaignId, [CHARLIE, JANE], "2020-01-01T00:00:00.000Z");

    const rows = db
      .prepare("SELECT email, metadata_json FROM _mailer_queue ORDER BY email")
      .all() as Array<{ email: string; metadata_json: string }>;

    expect(JSON.parse(rows[0]!.metadata_json)).toEqual({
      first_name: "Charlie",
      event_name: "CEGAANA Fall Event",
    });

    // Not null: JSON.parse(null) is null, which crashes the template engine.
    expect(rows[1]!.metadata_json).toBe("{}");
    expect(JSON.parse(rows[1]!.metadata_json)).toEqual({});
  });

  it("throws and enqueues nothing when the campaign does not exist", () => {
    const { db, provider } = setup();

    // OR IGNORE covers UNIQUE / NOT NULL / CHECK / PRIMARY KEY — not foreign keys.
    expect(() => provider.enqueueRecipients("no-such-campaign", [CHARLIE, JANE], "2020-01-01T00:00:00.000Z"))
      .toThrow(/FOREIGN KEY/);

    // And the transaction rolled the whole batch back.
    expect(queueCount(db)).toBe(0);
  });

  it("persists suppressed/duplicate counts on the campaign, accumulated across calls", () => {
    const { provider, campaignId } = setup();

    provider.addSuppression(CHARLIE.email, "unsubscribe");

    // First call: Charlie suppressed, Jane queued.
    provider.enqueueRecipients(campaignId, [CHARLIE, JANE], "2020-01-01T00:00:00.000Z");
    expect(provider.getCampaign(campaignId)).toMatchObject({ suppressedCount: 1, duplicateCount: 0 });

    // Second call: Jane is now a duplicate, Charlie still suppressed — both
    // counts must add to the first call's, not replace them.
    provider.enqueueRecipients(campaignId, [CHARLIE, JANE], "2020-01-01T00:00:00.000Z");
    expect(provider.getCampaign(campaignId)).toMatchObject({ suppressedCount: 2, duplicateCount: 1 });

    // getCampaignStats reports the same running totals.
    expect(provider.getCampaignStats(campaignId)).toMatchObject({ suppressedCount: 2, duplicateCount: 1 });
  });
});

describe("upsertTemplate", () => {
  it("creates a new template when the slug doesn't exist", () => {
    const { provider } = setup();

    const id = provider.upsertTemplate({
      slug: "welcome",
      name: "Welcome",
      subject: "Hi {{ first_name }}",
      bodyHtml: "<p>v1</p>",
      bodyText: "v1",
    });

    expect(id).toBeTruthy();
    expect(provider.getTemplate("welcome")).toMatchObject({ id, name: "Welcome", bodyHtml: "<p>v1</p>" });
  });

  it("overwrites the existing template's content on a repeat slug, keeping the same id", () => {
    const { provider } = setup();

    const firstId = provider.upsertTemplate({
      slug: "welcome",
      name: "Welcome v1",
      subject: "Hi",
      bodyHtml: "<p>v1</p>",
      bodyText: "v1",
    });

    const secondId = provider.upsertTemplate({
      slug: "welcome",
      name: "Welcome v2",
      subject: "Hi again",
      bodyHtml: "<p>v2</p>",
      bodyText: "v2",
    });

    expect(secondId).toBe(firstId);
    expect(provider.getTemplate("welcome")).toMatchObject({
      id: firstId,
      name: "Welcome v2",
      subject: "Hi again",
      bodyHtml: "<p>v2</p>",
      bodyText: "v2",
    });
  });

  it("does not disturb other templates", () => {
    const { provider } = setup();

    provider.upsertTemplate({ slug: "a", name: "A", subject: "A", bodyHtml: "a", bodyText: "a" });
    provider.upsertTemplate({ slug: "b", name: "B", subject: "B", bodyHtml: "b", bodyText: "b" });
    provider.upsertTemplate({ slug: "a", name: "A2", subject: "A2", bodyHtml: "a2", bodyText: "a2" });

    expect(provider.getTemplate("a")).toMatchObject({ name: "A2" });
    expect(provider.getTemplate("b")).toMatchObject({ name: "B" });
  });
});

describe("getSuppressionStats", () => {
  it("returns zero counts on an empty list", () => {
    const { provider } = setup();
    expect(provider.getSuppressionStats()).toEqual({ total: 0, byReason: {} });
  });

  it("groups by reason and sums to the total", () => {
    const { provider } = setup();

    provider.addSuppression("a@example.com", "unsubscribe");
    provider.addSuppression("b@example.com", "unsubscribe");
    provider.addSuppression("c@example.com", "hard_bounce");

    expect(provider.getSuppressionStats()).toEqual({
      total: 3,
      byReason: { unsubscribe: 2, hard_bounce: 1 },
    });
  });
});
