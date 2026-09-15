/**
 * Retry backoff (§8).
 *
 * A pure function: no database, no clock, no I/O. That is deliberate — it is
 * the one piece of the retry machinery that can be tested exhaustively without
 * any setup at all, so the rest of the queue engine can assume it is correct.
 *
 * Exponential from a base delay, doubling per attempt already made.
 * v1 has no jitter and no cap: both only matter with multiple workers, and
 * draft2 §14 defers them. `BACKOFF_CEILING_MS` exists so the doubling cannot
 * overflow into absurdity if `attempts` is ever unexpectedly large.
 */

export const BASE_BACKOFF_MS = 30_000;
export const BACKOFF_CEILING_MS = 60 * 60 * 1000; // 1 hour

/**
 * @param attempts how many attempts have already been made (>= 1 after a failure)
 * @returns milliseconds to wait before the job becomes due again
 */
export function backoffMs(attempts: number, baseMs: number = BASE_BACKOFF_MS): number {
  const n = Math.max(1, Math.floor(attempts));
  const delay = baseMs * 2 ** (n - 1);
  return Math.min(delay, BACKOFF_CEILING_MS);
}

/** `now` plus a delay, as an ISO-8601 timestamp — the format every column uses. */
export function addMs(now: string, ms: number): string {
  return new Date(new Date(now).getTime() + ms).toISOString();
}
