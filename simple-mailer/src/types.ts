/**
 * Shared types for the mailer engine.
 *
 * The DDL stores every status as a bare TEXT column with no CHECK constraint,
 * so these unions are the only thing standing between a typo and a row that
 * no query will ever claim.
 */

// ---------------------------------------------------------------------------
// Status vocabularies
// ---------------------------------------------------------------------------

/** Per-job state. Mirrors `_mailer_queue.status`. See design doc §8. */
export type JobStatus =
  | 'pending' | 'processing' | 'retrying'
  | 'sent' | 'failed' | 'cancelled';

/** Campaign lifecycle. Mirrors `_mailer_campaigns.status`. See design doc §11. */
export type CampaignStatus =
  | 'draft' | 'scheduled' | 'running'
  | 'paused' | 'completed' | 'cancelled';

/**
 * Outcome of a single `dispatch()` run — deliberately NOT a CampaignStatus.
 * 'aborted' describes the run; the campaign it aborted is left 'paused'.
 */
export type DispatchOutcome = 'completed' | 'paused' | 'aborted';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface MailerAuthOptions {
  userEmail: string;         // e.g. "events@cegaana.org"
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  accessToken?: string;
}

export interface MailerDefaults {
  /** Sleep between consecutive sends. Default 2500 (~24/min). */
  delayMs?: number;
  /**
   * Retries *after* the first attempt. Default 2.
   * The queue column counts attempts, not retries:
   *   `_mailer_queue.max_attempts = maxRetries + 1`
   * Convert once, at the engine boundary. Never inline this at a call site.
   */
  maxRetries?: number;
  /** Jobs claimed per dispatch run. Default 1000. */
  batchLimit?: number;
  /** Lease lock timeout before a job is reclaimed from 'processing'. Default 60. */
  leaseTimeoutSec?: number;
}

// ---------------------------------------------------------------------------
// Enqueue
// ---------------------------------------------------------------------------

export interface RecipientInput {
  /** Optional loose CRM reference, for tracing only. */
  id?: string;
  email: string;
  name?: string;
  /**
   * Per-person merge variables, frozen into `metadata_json` at enqueue.
   * `unknown`, not `any` — this arrives from CSV rows and CRM queries, so the
   * template engine must narrow each value rather than assume it is a string.
   */
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export interface DispatchOptions {
  limit?: number;
  delayMs?: number;
  /**
   * Override the engine's transport for this run — how `--dry-run` routes
   * through MockTransport without touching the engine's configuration.
   */
  transport?: EmailTransport;
  onProgress?: (progress: JobProgress) => void;
}

export interface JobProgress {
  jobId: string;
  email: string;
  /** The three states one attempt can leave a job in — derived, so it cannot drift. */
  status: Extract<JobStatus, 'sent' | 'retrying' | 'failed'>;
  completedCount: number;
  totalCount: number;
  percent: number;
  errorMessage?: string;
}

export interface DispatchReport {
  campaignId: string;
  status: DispatchOutcome;
  totalProcessed: number;
  sentCount: number;
  retriedCount: number;
  failedCount: number;
  durationMs: number;
  /** Set when status is 'aborted' — e.g. provider rate limit. */
  abortReason?: string;
  dryRun?: boolean;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

/**
 * Per-campaign counts. The six status counts sum to `totalQueued` — the PRD's
 * version omitted 'processing' and 'cancelled', so its numbers could not add up.
 * `successRate` stays a formatted string because it is a display value; anything
 * doing arithmetic should use the counts.
 */
export interface CampaignStats {
  campaignId: string;
  campaignName: string;
  status: CampaignStatus;
  isDryRun?: boolean | null;
  mode?: 'dry-run' | 'live' | 'not_run';
  totalQueued: number;
  pendingCount: number;
  processingCount: number;
  retryingCount: number;
  sentCount: number;
  failedCount: number;
  cancelledCount: number;
  successRate: string;
  /**
   * Excluded before ever reaching the queue (§3) — cumulative across every
   * `enqueueRecipients` call, so these do NOT count toward `totalQueued`.
   */
  suppressedCount: number;
  duplicateCount: number;
}

/**
 * Campaign-level boundary payload (design doc §4) — content only.
 * The caller never supplies `id`, `status` or timestamps; those are engine-owned,
 * and a source that could set them would break the isolation the engine promises.
 */
export interface NewCampaign {
  name: string;
  subject: string;
  /** Referenced-only in v1 (§6). Inline template columns stay unused. */
  templateId: string;
  /** ISO 8601. "Do not send before this time." */
  scheduledAt?: string;
}


export interface EnqueueResult {
  queuedCount : number,
  duplicateCount : number,
  suppressedCount : number
}
// ---------------------------------------------------------------------------
// Delivery boundary (design doc §7)
// ---------------------------------------------------------------------------

/**
 * The result of attempting to deliver ONE message.
 *
 * Every send goes through a single `sendEmail()` boundary that returns one of
 * these four. Provider-specific knowledge — Gmail's 429, 550, the string
 * "UserRateLimitExceeded" — lives *inside* that function and never escapes it.
 * The dispatcher branches on these four cases and on nothing else, which is
 * what makes the later channel abstraction a wrap rather than a rewrite: a
 * WhatsApp channel maps its own errors into the same four.
 *
 * These are returned, not thrown, because each one is an expected outcome the
 * dispatcher has a specific response to. Genuine bugs still throw.
 *
 * Discriminate on `status`:
 *
 *   switch (outcome.status) {
 *     case 'sent':               // outcome.providerMessageId is available here
 *     case 'rate_limited':       // outcome.cooldownMs is available here
 *     case 'transient_failure':  // retry after backoff, if attempts remain
 *     case 'permanent_failure':  // straight to 'failed', no retry
 *   }
 */
export type SendOutcome =
  | {
      status: 'sent';
      /** Provider's id for the message, recorded on the queue row and in logs. */
      providerMessageId: string;
      latencyMs: number;
    }
  | {
      /** Retryable: the message may succeed on a later attempt. */
      status: 'transient_failure';
      error: string;
      latencyMs: number;
    }
  | {
      /**
       * Provider quota hit. Distinct from a transient failure because the
       * dispatcher must also abort the run and pause the campaign (§11) —
       * continuing would deepen the quota problem, not work around it.
       */
      status: 'rate_limited';
      /** How long to wait before this job becomes eligible again. */
      cooldownMs: number;
      error: string;
      latencyMs: number;
    }
  | {
      /** Not retryable: invalid address, hard bounce, rejected content. */
      status: 'permanent_failure';
      error: string;
      latencyMs: number;
    };

/** The four discriminants, for exhaustiveness checks and log rows. */
export type SendStatus = SendOutcome['status'];

/** One message, as handed to the delivery boundary. Already rendered. */
export interface OutboundMessage {
  to: string;
  toName?: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * The delivery boundary itself (§7). One message in, one outcome out.
 *
 * Async because a real provider is; the mock resolves immediately. Everything
 * the dispatcher knows about sending is this one signature — which is why the
 * later channel abstraction is a wrap and not a rewrite.
 */
export type EmailTransport = (message: OutboundMessage) => Promise<SendOutcome>;


// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

/**
 * A claimed job, as the provider hands it to the dispatcher.
 *
 * Deliberately not the whole `_mailer_queue` row: only what a dispatcher needs
 * to render a message and decide what to do with the outcome. Field names are
 * camelCase and `metadata` is already parsed — the storage seam converts, so
 * snake_case and JSON strings never escape the provider.
 */
export interface QueuedJob {
  id: string;
  campaignId: string;
  email: string;
  name?: string;
  /** The frozen snapshot taken at enqueue (§3). Never re-read from source. */
  metadata: Record<string, unknown>;
  /** Attempts already made. Compare against maxAttempts, not maxRetries. */
  attempts: number;
  maxAttempts: number;
}

/**
 * All engine timestamps are ISO 8601 UTC with milliseconds, e.g.
 * "2026-09-06T06:43:44.431Z" — matching `new Date().toISOString()` and the
 * `strftime` defaults in the DDL.
 *
 * This is not cosmetic. SQLite has no date type: these columns are TEXT and
 * `next_attempt_at <= now` is a *string* comparison. Mixing formats silently
 * breaks scheduling — SQLite's own `datetime('now')` format puts a space where
 * ISO puts a "T", and a space sorts lower, so every such row looks permanently
 * overdue. One format, everywhere.
 */
export type IsoTimestamp = string;

// ---------------------------------------------------------------------------
// Campaigns, templates, logs
// ---------------------------------------------------------------------------

export interface Campaign {
  id: string;
  name: string;
  subject: string;
  templateId?: string;
  status: CampaignStatus;
  scheduledAt?: string;
  /** Cumulative across every `enqueueRecipients` call for this campaign. */
  suppressedCount: number;
  duplicateCount: number;
  createdAt: IsoTimestamp;
}

export interface NewTemplate {
  slug: string;
  name: string;
  description?: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  sampleData?: Record<string, unknown>;
}

export interface MailerTemplate extends NewTemplate {
  id: string;
}

/** One rendered message, before it is handed to the transport. */
export interface RenderedMessage {
  subject: string;
  html: string;
  text: string;
}

/** One row for `_mailer_logs` — appended per attempt, not per success. */
export interface LogEntry {
  jobId: string;
  campaignId: string;
  email: string;
  status: SendStatus;
  latencyMs: number;
  error?: string;
  providerMessageId?: string;
}

/** Suppression registry entry (§9). */
export interface Suppression {
  email: string;
  reason: string;
  createdAt: IsoTimestamp;
}

/** Global suppression counts — every address on the list, grouped by reason. */
export interface SuppressionStats {
  total: number;
  byReason: Record<string, number>;
}
