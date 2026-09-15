import { addMs, backoffMs } from "./backoff.js";
import type { MailerDataProvider } from "./provider.js";
import { renderMessage } from "./template.js";
import type { RenderOptions } from "./template.js";
import type {
  CampaignStats,
  DispatchOptions,
  DispatchReport,
  EmailTransport,
  EnqueueResult,
  IsoTimestamp,
  MailerDefaults,
  NewCampaign,
  NewTemplate,
  RecipientInput,
} from "./types.js";

export interface MailerEngineOptions extends MailerDefaults {
  /** Where messages actually go. Inject MockTransport for dry runs and tests. */
  transport: EmailTransport;
  /** Injectable clock. Tests replace it; production leaves it alone. */
  now?: () => IsoTimestamp;
  /** Injectable sleep, so pacing tests need not wait 2.5s per recipient. */
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULTS = {
  delayMs: 2500,
  maxRetries: 2,
  batchLimit: 1000,
  leaseTimeoutSec: 60,
} as const;

/**
 * The public API (PRD §3).
 *
 * Async, unlike the provider beneath it — not for future-proofing, but because
 * this layer genuinely awaits: it calls the transport and it sleeps between
 * sends. Storage stays synchronous because `better-sqlite3` is.
 *
 * This layer owns the clock and the defaults. The provider never calls
 * `Date.now()`, and nothing below here knows what `maxRetries` means.
 */
export class MailerEngine {
  private readonly delayMs: number;
  private readonly maxRetries: number;
  private readonly batchLimit: number;
  private readonly leaseTimeoutSec: number;
  private readonly transport: EmailTransport;
  private readonly now: () => IsoTimestamp;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly provider: MailerDataProvider,
    options: MailerEngineOptions,
  ) {
    this.transport = options.transport;
    this.delayMs = options.delayMs ?? DEFAULTS.delayMs;
    this.maxRetries = options.maxRetries ?? DEFAULTS.maxRetries;
    this.batchLimit = options.batchLimit ?? DEFAULTS.batchLimit;
    this.leaseTimeoutSec = options.leaseTimeoutSec ?? DEFAULTS.leaseTimeoutSec;
    this.now = options.now ?? (() => new Date().toISOString());
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /**
   * The one place the retries/attempts conversion happens (design doc §13).
   * `maxRetries: 2` means two retries *after* the first attempt — three total.
   */
  get maxAttempts(): number {
    return this.maxRetries + 1;
  }

  // --- campaigns -----------------------------------------------------------

  async createCampaign(campaign: NewCampaign): Promise<string> {
    if (!campaign.name.trim()) throw new Error("Campaign name is required");
    if (!campaign.subject.trim()) throw new Error("Campaign subject is required");
    if (!this.provider.getTemplate(campaign.templateId)) {
      throw new Error(`No template found for "${campaign.templateId}"`);
    }
    return this.provider.createCampaign(campaign);
  }

  async enqueueRecipients(
    campaignId: string,
    recipients: RecipientInput[],
  ): Promise<EnqueueResult> {
    const campaign = this.provider.getCampaign(campaignId);
    if (!campaign) throw new Error(`No campaign found with id "${campaignId}"`);

    // A scheduled campaign's jobs are not due until its time — `scheduled_at`
    // and retry backoff are the same mechanism, so both live in
    // `next_attempt_at` and the claim query needs no special case.
    const dueAt = campaign.scheduledAt ?? this.now();
    return this.provider.enqueueRecipients(campaignId, recipients, dueAt);
  }

  async getCampaignStats(campaignId: string): Promise<CampaignStats> {
    const stats = this.provider.getCampaignStats(campaignId);
    if (!stats) throw new Error(`No campaign found with id "${campaignId}"`);
    return stats;
  }

  async listCampaigns() {
    return this.provider.listCampaigns();
  }

  // --- templates -----------------------------------------------------------

  async createTemplate(template: NewTemplate): Promise<string> {
    return this.provider.createTemplate(template);
  }

  /** Create-or-update by slug — see `MailerDataProvider.upsertTemplate`. */
  async upsertTemplate(template: NewTemplate): Promise<string> {
    return this.provider.upsertTemplate(template);
  }

  async listTemplates() {
    return this.provider.listTemplates();
  }

  async getTemplate(idOrSlug: string) {
    return this.provider.getTemplate(idOrSlug);
  }

  /**
   * Renders without sending — the pre-flight check before committing to a
   * real dispatch. Strict by default: a placeholder with no value and no
   * `| default(...)` throws, rather than silently rendering empty, so a
   * missing merge variable is caught here instead of in a sent message.
   */
  async previewTemplate(
    idOrSlug: string,
    data: Record<string, unknown>,
    options: RenderOptions = { strict: true },
  ) {
    const template = this.provider.getTemplate(idOrSlug);
    if (!template) throw new Error(`No template found for "${idOrSlug}"`);
    return renderMessage(template, template.subject, data, options);
  }

  // --- suppression ---------------------------------------------------------

  async addSuppression(email: string, reason: string): Promise<void> {
    this.provider.addSuppression(email, reason);
  }

  async isSuppressed(email: string): Promise<boolean> {
    return this.provider.isSuppressed(email);
  }

  async listSuppressions() {
    return this.provider.listSuppressions();
  }

  async getSuppressionStats() {
    return this.provider.getSuppressionStats();
  }

  // --- dispatch ------------------------------------------------------------

  /**
   * Reclaims leases that outlived a crashed worker, then sends due jobs at the
   * paced rate until the batch is exhausted or a rate limit aborts the run.
   */
  async dispatch(campaignId: string, options: DispatchOptions = {}): Promise<DispatchReport> {
    const startedAt = Date.now();
    const campaign = this.provider.getCampaign(campaignId);
    if (!campaign) throw new Error(`No campaign found with id "${campaignId}"`);

    const template = campaign.templateId
      ? this.provider.getTemplate(campaign.templateId)
      : null;
    if (!template) throw new Error(`Campaign "${campaignId}" has no resolvable template`);

    // §11: a campaign in a terminal state is not dispatchable. Without this,
    // dispatch would flip a cancelled campaign back to 'running' and send.
    if (campaign.status === "cancelled") {
      throw new Error(`Campaign "${campaignId}" is cancelled`);
    }

    const transport = options.transport ?? this.transport;
    const delayMs = options.delayMs ?? this.delayMs;
    const limit = options.limit ?? this.batchLimit;

    this.reclaimExpiredLeases();
    this.provider.updateCampaignStatus(campaignId, "running", this.now());

    const report: DispatchReport = {
      campaignId,
      status: "completed",
      totalProcessed: 0,
      sentCount: 0,
      retriedCount: 0,
      failedCount: 0,
      durationMs: 0,
    };

    const jobs = this.provider.claimDueJobs(campaignId, limit, this.now());
    const totalCount = jobs.length;

    for (const [index, job] of jobs.entries()) {
      // Pacing goes *between* sends, not before the first — otherwise a
      // one-recipient campaign waits 2.5s for nothing.
      if (index > 0 && delayMs > 0) await this.sleep(delayMs);

      const message = renderMessage(template, campaign.subject, job.metadata);
      const outcome = await transport({
        to: job.email,
        ...(job.name === undefined ? {} : { toName: job.name }),
        ...message,
      });

      const now = this.now();
      report.totalProcessed++;

      // Every attempt is logged, not just the successes (§12).
      this.provider.appendLog({
        jobId: job.id,
        campaignId,
        email: job.email,
        status: outcome.status,
        latencyMs: outcome.latencyMs,
        ...(outcome.status === "sent"
          ? { providerMessageId: outcome.providerMessageId }
          : { error: outcome.error }),
      });

      if (outcome.status === "sent") {
        this.provider.markSent(job.id, outcome.providerMessageId, now);
        report.sentCount++;
        options.onProgress?.({
          jobId: job.id,
          email: job.email,
          status: "sent",
          completedCount: report.totalProcessed,
          totalCount,
          percent: Math.round((report.totalProcessed / totalCount) * 100),
        });
        continue;
      }

      const attemptsAfter = job.attempts + 1;
      const exhausted = attemptsAfter >= job.maxAttempts;

      if (outcome.status === "permanent_failure" || exhausted) {
        this.provider.markFailed(job.id, outcome.error, now);
        report.failedCount++;
        options.onProgress?.({
          jobId: job.id,
          email: job.email,
          status: "failed",
          completedCount: report.totalProcessed,
          totalCount,
          percent: Math.round((report.totalProcessed / totalCount) * 100),
          errorMessage: outcome.error,
        });
        continue;
      }

      // Retryable: transient, or a rate limit with attempts left.
      const waitMs =
        outcome.status === "rate_limited" ? outcome.cooldownMs : backoffMs(attemptsAfter);
      this.provider.markRetrying(job.id, outcome.error, addMs(now, waitMs), now);
      report.retriedCount++;
      options.onProgress?.({
        jobId: job.id,
        email: job.email,
        status: "retrying",
        completedCount: report.totalProcessed,
        totalCount,
        percent: Math.round((report.totalProcessed / totalCount) * 100),
        errorMessage: outcome.error,
      });

      // A rate limit is not just this job's problem: continuing would deepen
      // the quota breach. Abort the run and pause the campaign (§11).
      if (outcome.status === "rate_limited") {
        report.status = "aborted";
        report.abortReason = `Provider rate limit encountered: ${outcome.error}`;
        this.provider.updateCampaignStatus(campaignId, "paused", now);
        report.durationMs = Date.now() - startedAt;
        return report;
      }
    }

    // The run finished normally, so the report says 'completed' — that is a
    // statement about this run, not about the campaign.
    //
    // The campaign only becomes 'completed' when every job is terminal (some
    // may be 'failed'). Otherwise it stays 'running': work remains because the
    // batch limit was reached or jobs are in backoff, and neither is a pause.
    // 'paused' is reserved for a rate-limit abort or a human (§11).
    if (this.provider.countUnfinished(campaignId) === 0) {
      this.provider.updateCampaignStatus(campaignId, "completed", this.now());
    }

    report.durationMs = Date.now() - startedAt;
    return report;
  }

  /** Returns jobs abandoned by a crashed worker to the waiting bucket. */
  reclaimExpiredLeases(): number {
    const now = this.now();
    const cutoff = addMs(now, -this.leaseTimeoutSec * 1000);
    return this.provider.reclaimExpiredLeases(cutoff, now);
  }
}
