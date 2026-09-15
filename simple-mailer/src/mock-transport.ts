import type {
  EmailTransport,
  OutboundMessage,
  SendOutcome,
} from "./types.js";

export interface MockTransportOptions {
  /**
   * Force a non-'sent' outcome for specific addresses. Everything else
   * succeeds. Use this to drive retry and permanent-failure paths.
   */
  outcomeFor?: Record<string, "transient_failure" | "permanent_failure">;

  /**
   * After this many attempts, every further send returns 'rate_limited'.
   * Drives the abort path in §11 without waiting on a real provider quota.
   */
  rateLimitAfter?: number;

  /** Cooldown reported with a rate_limited outcome. Default 5 minutes (§4.2). */
  cooldownMs?: number;

  /** Reported latency, so log rows have a plausible non-zero value. */
  latencyMs?: number;
}

export interface MockAttempt {
  message: OutboundMessage;
  outcome: SendOutcome;
}

/**
 * An in-memory implementation of the delivery boundary (§7, PRD §5).
 *
 * Sends nothing. Records every attempt so tests can assert on rendered
 * content, and can be told to fail on demand so the retry, permanent-failure
 * and rate-limit-abort paths are all reachable with no credentials and no
 * network. `dispatch(..., { dryRun: true })` routes through this.
 */
export class MockTransport {
  /** Every attempt, in order — including the ones that failed. */
  readonly attempts: MockAttempt[] = [];

  private counter = 0;

  constructor(private readonly options: MockTransportOptions = {}) {}

  /** Only the attempts that succeeded. */
  get delivered(): OutboundMessage[] {
    return this.attempts
      .filter((a) => a.outcome.status === "sent")
      .map((a) => a.message);
  }

  /** How many times this address was attempted — retries included. */
  attemptsFor(email: string): number {
    return this.attempts.filter((a) => a.message.to === email).length;
  }

  reset(): void {
    this.attempts.length = 0;
    this.counter = 0;
  }

  /**
   * Declared as an arrow property, not a method, so it can be handed straight
   * to anything expecting an `EmailTransport` without losing `this`.
   */
  readonly send: EmailTransport = async (message) => {
    this.counter += 1;
    const latencyMs = this.options.latencyMs ?? 12;

    const outcome = this.decide(message, latencyMs);

    // Recorded before returning, and regardless of outcome: a failed send was
    // still an attempt, and the retry tests need to count all of them.
    this.attempts.push({ message, outcome });

    return outcome;
  };

  private decide(message: OutboundMessage, latencyMs: number): SendOutcome {
    const { outcomeFor, rateLimitAfter, cooldownMs } = this.options;

    if (rateLimitAfter !== undefined && this.counter > rateLimitAfter) {
      return {
        status: "rate_limited",
        cooldownMs: cooldownMs ?? 5 * 60 * 1000,
        error: "MockTransport: quota exhausted",
        latencyMs,
      };
    }

    const forced = outcomeFor?.[message.to];
    if (forced) {
      return {
        status: forced,
        error: `MockTransport: forced ${forced} for ${message.to}`,
        latencyMs,
      };
    }

    return {
      status: "sent",
      providerMessageId: `mock-${this.counter}`,
      latencyMs,
    };
  }
}
