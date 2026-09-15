import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { MailerDataProvider } from "./provider.js";
import type {
  Campaign,
  CampaignStats,
  CampaignStatus,
  EnqueueResult,
  IsoTimestamp,
  LogEntry,
  MailerTemplate,
  NewCampaign,
  NewTemplate,
  QueuedJob,
  RecipientInput,
  Suppression,
  SuppressionStats,
} from "./types.js";

/**
 * The only file in the engine permitted to know that SQLite exists.
 * If `better-sqlite3` is imported anywhere else, the seam has leaked.
 */
export class SqliteProvider implements MailerDataProvider {
  constructor(private db: Database.Database) {}

  // --- suppression ---------------------------------------------------------

  isSuppressed(email: string): boolean {
    const row = this.db
      .prepare(`SELECT EXISTS (SELECT 1 FROM _mailer_suppression WHERE email = ?) AS found`)
      .get(email) as { found: number } | undefined;
    return Boolean(row?.found);
  }

  addSuppression(email: string, reason: string): void {
    this.db
      .prepare(`INSERT OR REPLACE INTO _mailer_suppression (email, reason) VALUES (?, ?)`)
      .run(email, reason);
  }

  listSuppressions(): Suppression[] {
    const rows = this.db
      .prepare(`SELECT email, reason, created_at FROM _mailer_suppression ORDER BY created_at DESC`)
      .all() as Array<{ email: string; reason: string; created_at: string }>;
    return rows.map((r) => ({ email: r.email, reason: r.reason, createdAt: r.created_at }));
  }

  getSuppressionStats(): SuppressionStats {
    const rows = this.db
      .prepare(`SELECT reason, COUNT(*) AS n FROM _mailer_suppression GROUP BY reason`)
      .all() as Array<{ reason: string; n: number }>;

    const byReason = Object.fromEntries(rows.map((r) => [r.reason, r.n]));
    const total = rows.reduce((sum, r) => sum + r.n, 0);
    return { total, byReason };
  }

  // --- campaigns -----------------------------------------------------------

  createCampaign(campaign: NewCampaign): string {
    // `id` is generated here because SQLite has no UUID function. `status` and
    // `created_at` are omitted deliberately — the DDL defaults own them.
    const id = randomUUID();
    this.db
      .prepare(`
        INSERT INTO _mailer_campaigns (id, name, subject, template_id, scheduled_at)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(id, campaign.name, campaign.subject, campaign.templateId, campaign.scheduledAt ?? null);
    // No success flag: a failed insert throws, so reaching this line means it worked.
    return id;
  }

  getCampaign(campaignId: string): Campaign | null {
    const row = this.db
      .prepare(`SELECT * FROM _mailer_campaigns WHERE id = ?`)
      .get(campaignId) as CampaignRow | undefined;
    return row ? toCampaign(row) : null;
  }

  listCampaigns(): Campaign[] {
    const rows = this.db
      .prepare(`SELECT * FROM _mailer_campaigns ORDER BY created_at DESC`)
      .all() as CampaignRow[];
    return rows.map(toCampaign);
  }

  updateCampaignStatus(campaignId: string, status: CampaignStatus, now: IsoTimestamp): void {
    this.db
      .prepare(`UPDATE _mailer_campaigns SET status = ?, updated_at = ? WHERE id = ?`)
      .run(status, now, campaignId);
  }

  getCampaignStats(campaignId: string): CampaignStats | null {
    const campaign = this.getCampaign(campaignId);
    if (!campaign) return null;

    const rows = this.db
      .prepare(`SELECT status, COUNT(*) AS n FROM _mailer_queue WHERE campaign_id = ? GROUP BY status`)
      .all(campaignId) as Array<{ status: string; n: number }>;

    const by = (s: string) => rows.find((r) => r.status === s)?.n ?? 0;
    const totalQueued = rows.reduce((sum, r) => sum + r.n, 0);
    const sentCount = by("sent");

    const mockCheck = this.db
      .prepare(`
        SELECT
          CASE
            WHEN EXISTS (
              SELECT 1 FROM _mailer_logs
              WHERE campaign_id = ? AND (provider_message_id LIKE 'mock-%' OR error LIKE 'MockTransport%')
            ) OR EXISTS (
              SELECT 1 FROM _mailer_queue
              WHERE campaign_id = ? AND (provider_message_id LIKE 'mock-%' OR error_message LIKE 'MockTransport%')
            ) THEN 1
            WHEN EXISTS (
              SELECT 1 FROM _mailer_logs WHERE campaign_id = ?
            ) OR EXISTS (
              SELECT 1 FROM _mailer_queue WHERE campaign_id = ? AND (status = 'sent' OR attempts > 0)
            ) THEN 0
            ELSE NULL
          END AS is_mock
      `)
      .get(campaignId, campaignId, campaignId, campaignId) as { is_mock: number | null } | undefined;

    const isDryRun = mockCheck?.is_mock === 1 ? true : mockCheck?.is_mock === 0 ? false : null;
    const mode = isDryRun === true ? "dry-run" : isDryRun === false ? "live" : "not_run";

    return {
      campaignId,
      campaignName: campaign.name,
      status: campaign.status,
      isDryRun,
      mode,
      totalQueued,
      sentCount,
      retryingCount: by("retrying"),
      failedCount: by("failed"),
      pendingCount: by("pending"),
      processingCount: by("processing"),
      cancelledCount: by("cancelled"),
      successRate: totalQueued === 0 ? "0.0%" : `${((sentCount / totalQueued) * 100).toFixed(1)}%`,
      suppressedCount: campaign.suppressedCount,
      duplicateCount: campaign.duplicateCount,
    };
  }

  // --- templates -----------------------------------------------------------

  createTemplate(template: NewTemplate): string {
    const id = randomUUID();
    this.db
      .prepare(`
        INSERT INTO _mailer_templates
          (id, slug, name, description, subject, body_html, body_text, sample_data_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        template.slug,
        template.name,
        template.description ?? null,
        template.subject,
        template.bodyHtml,
        template.bodyText,
        template.sampleData ? JSON.stringify(template.sampleData) : null,
      );
    return id;
  }

  /**
   * One statement, not "SELECT then INSERT-or-UPDATE": the same atomicity
   * argument as `claimDueJobs` applies — a caller-assembled version has a gap
   * a concurrent upsert of the same slug could land in. `id` is only used on
   * insert; `ON CONFLICT` never touches it, so `RETURNING id` gives back the
   * existing row's id on an update.
   */
  upsertTemplate(template: NewTemplate): string {
    const row = this.db
      .prepare(`
        INSERT INTO _mailer_templates
          (id, slug, name, description, subject, body_html, body_text, sample_data_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (slug) DO UPDATE SET
          name = excluded.name,
          description = excluded.description,
          subject = excluded.subject,
          body_html = excluded.body_html,
          body_text = excluded.body_text,
          sample_data_json = excluded.sample_data_json,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        RETURNING id
      `)
      .get(
        randomUUID(),
        template.slug,
        template.name,
        template.description ?? null,
        template.subject,
        template.bodyHtml,
        template.bodyText,
        template.sampleData ? JSON.stringify(template.sampleData) : null,
      ) as { id: string };
    return row.id;
  }

  getTemplate(idOrSlug: string): MailerTemplate | null {
    const row = this.db
      .prepare(`SELECT * FROM _mailer_templates WHERE id = ? OR slug = ?`)
      .get(idOrSlug, idOrSlug) as TemplateRow | undefined;
    return row ? toTemplate(row) : null;
  }

  listTemplates(): MailerTemplate[] {
    const rows = this.db
      .prepare(`SELECT * FROM _mailer_templates ORDER BY slug`)
      .all() as TemplateRow[];
    return rows.map(toTemplate);
  }

  // --- queue ---------------------------------------------------------------

  /**
   * Snapshot enqueue (§3). Copies each recipient into `_mailer_queue`; after
   * this returns, the queue rows owe nothing to wherever the data came from.
   */
  enqueueRecipients(
    campaignId: string,
    recipients: RecipientInput[],
    dueAt: IsoTimestamp,
  ): EnqueueResult {
    const result: EnqueueResult = { queuedCount: 0, duplicateCount: 0, suppressedCount: 0 };

    // Prepared once, outside the loop.
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO _mailer_queue
        (id, campaign_id, recipient_id, email, name, metadata_json, next_attempt_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    // Suppressed and duplicate rows never reach _mailer_queue, so this batch's
    // counts are the only record of them — bump the campaign's running totals
    // in the same transaction as the inserts, so campaign stats can report
    // them later instead of losing them the moment this call returns.
    const bumpCounters = this.db.prepare(`
      UPDATE _mailer_campaigns
         SET suppressed_count = suppressed_count + ?,
             duplicate_count = duplicate_count + ?
       WHERE id = ?
    `);

    // One transaction for the whole batch. A half-enqueued campaign is a state
    // you have to diagnose; all-or-nothing is one you can simply repeat.
    //
    // OR IGNORE is what makes that survivable: a duplicate is an expected
    // outcome, not a failure, so it must not roll back the other 1,999 rows.
    // Real failures still throw and roll everything back — notably
    // SQLITE_CONSTRAINT_FOREIGNKEY on an unknown campaignId, which ON CONFLICT
    // handling does not cover.
    const insertAll = this.db.transaction((batch: RecipientInput[]) => {
      for (const recipient of batch) {
        if (this.isSuppressed(recipient.email)) {
          result.suppressedCount++;
          continue;
        }

        const run = insert.run(
          randomUUID(),
          campaignId,
          recipient.id ?? null,
          recipient.email,
          recipient.name ?? null,
          // `?? {}` is load-bearing: JSON.stringify(undefined) returns the value
          // `undefined`, which binds as NULL, and JSON.parse(null) yields null —
          // a TypeError waiting in the template engine.
          JSON.stringify(recipient.metadata ?? {}),
          // Explicit, never the DDL default: the engine owns the clock.
          dueAt,
        );

        // changes === 0 means UNIQUE(campaign_id, email) skipped the row.
        if (run.changes === 1) result.queuedCount++;
        else result.duplicateCount++;
      }

      bumpCounters.run(result.suppressedCount, result.duplicateCount, campaignId);
    });

    insertAll(recipients);
    return result;
  }

  /**
   * The atomic claim. A single UPDATE ... RETURNING statement: SQLite executes
   * it as one indivisible operation, so there is no window between choosing a
   * job and owning it.
   *
   * The LIMIT lives in a subquery rather than on the UPDATE itself. `UPDATE ...
   * LIMIT` needs a non-default SQLite compile flag; the subquery form works on
   * every build.
   */
  claimDueJobs(campaignId: string, limit: number, now: IsoTimestamp): QueuedJob[] {
    const rows = this.db
      .prepare(`
        UPDATE _mailer_queue
           SET status = 'processing',
               locked_at = ?,
               updated_at = ?
         WHERE id IN (
           SELECT id
             FROM _mailer_queue
            WHERE campaign_id = ?
              AND status IN ('pending', 'retrying')
              AND next_attempt_at <= ?
            ORDER BY next_attempt_at, created_at
            LIMIT ?
         )
        RETURNING id, campaign_id, email, name, metadata_json, attempts, max_attempts
      `)
      .all(now, now, campaignId, now, limit) as QueueRow[];

    return rows.map(toQueuedJob);
  }

  markSent(jobId: string, providerMessageId: string, now: IsoTimestamp): void {
    this.db
      .prepare(`
        UPDATE _mailer_queue
           SET status = 'sent',
               attempts = attempts + 1,
               sent_at = ?,
               locked_at = NULL,
               error_message = NULL,
               provider_message_id = ?,
               updated_at = ?
         WHERE id = ?
      `)
      .run(now, providerMessageId, now, jobId);
  }

  markRetrying(jobId: string, error: string, nextAttemptAt: IsoTimestamp, now: IsoTimestamp): void {
    this.db
      .prepare(`
        UPDATE _mailer_queue
           SET status = 'retrying',
               attempts = attempts + 1,
               next_attempt_at = ?,
               locked_at = NULL,
               error_message = ?,
               updated_at = ?
         WHERE id = ?
      `)
      .run(nextAttemptAt, error, now, jobId);
  }

  markFailed(jobId: string, error: string, now: IsoTimestamp): void {
    this.db
      .prepare(`
        UPDATE _mailer_queue
           SET status = 'failed',
               attempts = attempts + 1,
               locked_at = NULL,
               error_message = ?,
               updated_at = ?
         WHERE id = ?
      `)
      .run(error, now, jobId);
  }

  /**
   * The lease sweeper. `locked_at` is a timestamp, not a flag: `status` is what
   * excludes a job from the claim, and `locked_at` is what tells us whether the
   * worker holding it is still alive.
   */
  reclaimExpiredLeases(cutoff: IsoTimestamp, now: IsoTimestamp): number {
    const run = this.db
      .prepare(`
        UPDATE _mailer_queue
           SET status = 'retrying',
               locked_at = NULL,
               next_attempt_at = ?,
               updated_at = ?
         WHERE status = 'processing'
           AND locked_at IS NOT NULL
           AND locked_at < ?
      `)
      .run(now, now, cutoff);
    return run.changes;
  }

  countUnfinished(campaignId: string): number {
    const row = this.db
      .prepare(`
        SELECT COUNT(*) AS n FROM _mailer_queue
         WHERE campaign_id = ? AND status IN ('pending', 'retrying', 'processing')
      `)
      .get(campaignId) as { n: number };
    return row.n;
  }

  // --- audit ---------------------------------------------------------------

  appendLog(entry: LogEntry): void {
    this.db
      .prepare(`
        INSERT INTO _mailer_logs
          (id, job_id, campaign_id, email, status, latency_ms, error, provider_message_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        randomUUID(),
        entry.jobId,
        entry.campaignId,
        entry.email,
        entry.status,
        entry.latencyMs,
        entry.error ?? null,
        entry.providerMessageId ?? null,
      );
  }
}

// ---------------------------------------------------------------------------
// Row shapes and mapping. snake_case column names and JSON strings stop here
// and never reach the engine.
// ---------------------------------------------------------------------------

interface QueueRow {
  id: string;
  campaign_id: string;
  email: string;
  name: string | null;
  metadata_json: string | null;
  attempts: number;
  max_attempts: number;
}

interface CampaignRow {
  id: string;
  name: string;
  subject: string;
  template_id: string | null;
  status: string;
  scheduled_at: string | null;
  suppressed_count: number;
  duplicate_count: number;
  created_at: string;
}

interface TemplateRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  subject: string;
  body_html: string;
  body_text: string;
  sample_data_json: string | null;
}

function toQueuedJob(row: QueueRow): QueuedJob {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    email: row.email,
    ...(row.name === null ? {} : { name: row.name }),
    metadata: row.metadata_json ? JSON.parse(row.metadata_json) : {},
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
  };
}

function toCampaign(row: CampaignRow): Campaign {
  return {
    id: row.id,
    name: row.name,
    subject: row.subject,
    ...(row.template_id === null ? {} : { templateId: row.template_id }),
    status: row.status as CampaignStatus,
    ...(row.scheduled_at === null ? {} : { scheduledAt: row.scheduled_at }),
    suppressedCount: row.suppressed_count,
    duplicateCount: row.duplicate_count,
    createdAt: row.created_at,
  };
}

function toTemplate(row: TemplateRow): MailerTemplate {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    ...(row.description === null ? {} : { description: row.description }),
    subject: row.subject,
    bodyHtml: row.body_html,
    bodyText: row.body_text,
    ...(row.sample_data_json === null
      ? {}
      : { sampleData: JSON.parse(row.sample_data_json) as Record<string, unknown> }),
  };
}
