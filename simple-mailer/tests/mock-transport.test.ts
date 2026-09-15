import { describe, it, expect } from "vitest";
import { MockTransport } from "../src/mock-transport.js";
import type { OutboundMessage } from "../src/types.js";

const message = (to: string): OutboundMessage => ({
  to,
  toName: "Charlie Brown",
  subject: "Speaker briefing for Charlie",
  html: "<p>Dear Charlie,</p>",
  text: "Dear Charlie,",
});

describe("MockTransport", () => {
  it("succeeds by default and records what it was asked to send", async () => {
    const transport = new MockTransport();

    const outcome = await transport.send(message("charlie@example.com"));

    expect(outcome.status).toBe("sent");
    // Narrowed by the discriminant — providerMessageId only exists on this case.
    if (outcome.status === "sent") {
      expect(outcome.providerMessageId).toBe("mock-1");
    }

    expect(transport.delivered).toHaveLength(1);
    expect(transport.delivered[0]!.subject).toBe("Speaker briefing for Charlie");
  });

  it("forces a chosen outcome for a specific address", async () => {
    const transport = new MockTransport({
      outcomeFor: { "bounce@example.com": "permanent_failure" },
    });

    const bad = await transport.send(message("bounce@example.com"));
    const good = await transport.send(message("charlie@example.com"));

    expect(bad.status).toBe("permanent_failure");
    expect(good.status).toBe("sent");
  });

  it("records failed attempts too", async () => {
    const transport = new MockTransport({
      outcomeFor: { "flaky@example.com": "transient_failure" },
    });

    await transport.send(message("flaky@example.com"));
    await transport.send(message("flaky@example.com"));

    // Two attempts, nothing delivered — the shape a retry test needs.
    expect(transport.attemptsFor("flaky@example.com")).toBe(2);
    expect(transport.delivered).toHaveLength(0);
  });

  it("starts rate limiting after the configured number of attempts", async () => {
    const transport = new MockTransport({ rateLimitAfter: 2, cooldownMs: 1000 });

    expect((await transport.send(message("a@example.com"))).status).toBe("sent");
    expect((await transport.send(message("b@example.com"))).status).toBe("sent");

    const third = await transport.send(message("c@example.com"));
    expect(third.status).toBe("rate_limited");
    if (third.status === "rate_limited") {
      expect(third.cooldownMs).toBe(1000);
    }
  });

  it("can be handed around as a bare EmailTransport function", async () => {
    const transport = new MockTransport();

    // Detached from the instance — works because `send` is an arrow property.
    const send = transport.send;
    await send(message("charlie@example.com"));

    expect(transport.delivered).toHaveLength(1);
  });
});
