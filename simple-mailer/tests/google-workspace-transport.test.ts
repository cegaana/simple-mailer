import { describe, it, expect } from "vitest";
import { GoogleWorkspaceTransport } from "../src/google-workspace-transport.js";
import type { OutboundMessage } from "../src/types.js";

const message: OutboundMessage = {
  to: "charlie@example.com",
  toName: "Charlie Brown",
  subject: "Speaker briefing for Charlie",
  html: "<p>Dear Charlie,</p>",
  text: "Dear Charlie,",
};

const CREDS = {
  userEmail: "events@cegaana.org",
  clientId: "client-id",
  clientSecret: "client-secret",
  refreshToken: "refresh-token",
};

/** Same shape nodemailer throws on an SMTP rejection. */
function sendMailError(message: string, responseCode?: number): Error & { responseCode?: number } {
  const error = new Error(message) as Error & { responseCode?: number };
  if (responseCode !== undefined) error.responseCode = responseCode;
  return error;
}

describe("GoogleWorkspaceTransport", () => {
  it("reports 'sent' with the provider's message id", async () => {
    const transport = new GoogleWorkspaceTransport({
      ...CREDS,
      sendMail: async () => ({ messageId: "<abc123@mail.gmail.com>" }),
    });

    const outcome = await transport.send(message);

    expect(outcome.status).toBe("sent");
    if (outcome.status === "sent") {
      expect(outcome.providerMessageId).toBe("<abc123@mail.gmail.com>");
    }
  });

  it("classifies Gmail's per-recipient throttling as rate_limited despite a 4xx code", async () => {
    const transport = new GoogleWorkspaceTransport({
      ...CREDS,
      sendMail: async () => {
        throw sendMailError("450-4.2.1 The user you are trying to contact is receiving mail too quickly", 450);
      },
    });

    const outcome = await transport.send(message);

    // The numeric code alone (450, <500) would otherwise fall through to
    // transient_failure — the message text is what actually signals a
    // rate limit, and must be checked first.
    expect(outcome.status).toBe("rate_limited");
  });

  it("classifies a 'Daily user sending limit exceeded' 550 as rate_limited, not permanent", async () => {
    const transport = new GoogleWorkspaceTransport({
      ...CREDS,
      sendMail: async () => {
        throw sendMailError("550-5.4.5 Daily user sending limit exceeded", 550);
      },
    });

    const outcome = await transport.send(message);

    expect(outcome.status).toBe("rate_limited");
    if (outcome.status === "rate_limited") {
      expect(outcome.cooldownMs).toBeGreaterThan(0);
    }
  });

  it("classifies a plain 5xx rejection as permanent_failure", async () => {
    const transport = new GoogleWorkspaceTransport({
      ...CREDS,
      sendMail: async () => {
        throw sendMailError("550 5.1.1 The email account that you tried to reach does not exist", 550);
      },
    });

    const outcome = await transport.send(message);
    expect(outcome.status).toBe("permanent_failure");
  });

  it("classifies a 4xx rejection as transient_failure", async () => {
    const transport = new GoogleWorkspaceTransport({
      ...CREDS,
      sendMail: async () => {
        throw sendMailError("421 4.7.0 Try again later, closing connection", 421);
      },
    });

    const outcome = await transport.send(message);
    expect(outcome.status).toBe("transient_failure");
  });

  it("classifies an error with no response code (e.g. auth/connection) as transient_failure", async () => {
    const transport = new GoogleWorkspaceTransport({
      ...CREDS,
      sendMail: async () => {
        throw new Error("Invalid login: 535-5.7.8 Username and Password not accepted");
      },
    });

    const outcome = await transport.send(message);
    expect(outcome.status).toBe("transient_failure");
  });

  it("can be handed around as a bare EmailTransport function", async () => {
    const transport = new GoogleWorkspaceTransport({
      ...CREDS,
      sendMail: async () => ({ messageId: "id-1" }),
    });

    const send = transport.send;
    const outcome = await send(message);

    expect(outcome.status).toBe("sent");
  });
});
