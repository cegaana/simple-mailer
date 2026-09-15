import { describe, it, expect } from "vitest";
import { addMs, backoffMs, BASE_BACKOFF_MS, BACKOFF_CEILING_MS } from "../src/backoff.js";

describe("backoffMs", () => {
  it("doubles with each attempt already made", () => {
    expect(backoffMs(1)).toBe(BASE_BACKOFF_MS);
    expect(backoffMs(2)).toBe(BASE_BACKOFF_MS * 2);
    expect(backoffMs(3)).toBe(BASE_BACKOFF_MS * 4);
  });

  it("never exceeds the ceiling", () => {
    expect(backoffMs(50)).toBe(BACKOFF_CEILING_MS);
  });

  it("treats zero or negative attempts as the first attempt", () => {
    expect(backoffMs(0)).toBe(BASE_BACKOFF_MS);
    expect(backoffMs(-3)).toBe(BASE_BACKOFF_MS);
  });
});

describe("addMs", () => {
  it("returns ISO-8601, the format every timestamp column uses", () => {
    expect(addMs("2026-09-06T12:00:00.000Z", 30_000)).toBe("2026-09-06T12:00:30.000Z");
  });

  it("goes backwards for a negative offset — how the lease cutoff is computed", () => {
    expect(addMs("2026-09-06T12:00:00.000Z", -60_000)).toBe("2026-09-06T11:59:00.000Z");
  });
});
