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
 * The storage seam (design doc §10).
 *
 * Deliberately thin: it exposes only the operations the engine actually
 * performs, in the engine's vocabulary. No method takes or returns SQL — if
 * one ever does, the seam is decoration and every backend must speak SQLite.
 *
 * Litmus test for any method added here: could it be implemented over a plain
 * Map, with no database at all? If not, it is leaking.
 *
 * Synchronous throughout, because `better-sqlite3` is. `MailerEngine` is the
 * async layer — it awaits the transport and sleeps between sends; the storage
 * underneath it never blocks on a network.
 */
export interface MailerDataProvider {

  // --- suppression (§9) ----------------------------------------------------

  isSuppressed(email: string): boolean;
  addSuppression(email: string, reason: string): void;
  listSuppressions(): Suppression[];
  getSuppressionStats(): SuppressionStats;

  // --- campaigns -----------------------------------------------------------

  /** Inserts a campaign in status 'draft' and returns its generated id. */
  createCampaign(campaign: NewCampaign): string;
  getCampaign(campaignId: string): Campaign | null;
  listCampaigns(): Campaign[];
  updateCampaignStatus(campaignId: string, status: CampaignStatus, now: IsoTimestamp): void;
  getCampaignStats(campaignId: string): CampaignStats | null;

  // --- templates (§6, referenced-only in v1) -------------------------------

  createTemplate(template: NewTemplate): string;
  /**
   * Create-or-update by `slug`: inserts a new template, or overwrites every
   * content field of the existing one with the same slug. Returns the
   * template's id either way (the existing row's id on update, a freshly
   * generated one on insert) — never two ids for one slug.
   */
  upsertTemplate(template: NewTemplate): string;
  getTemplate(idOrSlug: string): MailerTemplate | null;
  listTemplates(): MailerTemplate[];

  // --- queue ---------------------------------------------------------------

  /**
   * Snapshot enqueue: copies recipients into the queue as 'pending'.
   *
   * `dueAt` sets `next_attempt_at` explicitly rather than letting the DDL
   * default read the system clock. Two reasons: a campaign with a
   * `scheduled_at` must not be claimable before then, and the engine's clock
   * has to be the *only* clock — otherwise engine time and row time disagree
   * and scheduling silently misbehaves.
   */
  enqueueRecipients(
    campaignId: string,
    recipients: RecipientInput[],
    dueAt: IsoTimestamp,
  ): EnqueueResult;

  /**
   * Atomically take up to `limit` due jobs from 'pending'/'retrying' into
   * 'processing', stamping `locked_at` with `now`, and return them.
   *
   * One method rather than find-then-mark, because atomicity cannot be
   * assembled by a caller: the gap between two calls is exactly where a second
   * worker — or the lease sweeper — claims the same job and sends it twice.
   *
   * `now` is a parameter, not read from the database, so lease and backoff
   * tests can control the clock instead of sleeping.
   */
  claimDueJobs(campaignId: string, limit: number, now: IsoTimestamp): QueuedJob[];

  markSent(jobId: string, providerMessageId: string, now: IsoTimestamp): void;

  /** → 'retrying', attempts + 1, due again at `nextAttemptAt`. */
  markRetrying(jobId: string, error: string, nextAttemptAt: IsoTimestamp, now: IsoTimestamp): void;

  /** → 'failed' (terminal), attempts + 1. */
  markFailed(jobId: string, error: string, now: IsoTimestamp): void;

  /**
   * Crash reclaim (§8). Returns jobs whose `locked_at` is older than `cutoff`
   * from 'processing' back to 'retrying'. Returns how many were reclaimed.
   *
   * Accepts at-least-once delivery: a worker that died *after* the provider
   * accepted the message but *before* the row said 'sent' will send again.
   */
  reclaimExpiredLeases(cutoff: IsoTimestamp, now: IsoTimestamp): number;

  /** Jobs not yet in a terminal state. Zero means the campaign is complete. */
  countUnfinished(campaignId: string): number;

  // --- audit (§12) ---------------------------------------------------------

  appendLog(entry: LogEntry): void;
}
