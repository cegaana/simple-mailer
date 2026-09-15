import nodemailer from "nodemailer";
import type { EmailTransport, MailerAuthOptions, OutboundMessage, SendOutcome } from "./types.js";

interface SentMessage {
  messageId: string;
}

export interface GoogleWorkspaceTransportOptions extends MailerAuthOptions {
  /**
   * Injectable for tests — bypasses nodemailer and the network entirely.
   * Defaults to a real Gmail OAuth2 SMTP transporter built from the
   * credentials above.
   */
  sendMail?: (message: OutboundMessage) => Promise<SentMessage>;
}

/** The subset of a nodemailer send error this transport actually branches on. */
interface SendMailError {
  message?: string;
  responseCode?: number;
}

const RATE_LIMIT_PATTERN =
  /rate.?limit|too many (login|messages|recipients)|too quickly|sending limit|quota exceeded/i;
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 5 * 60 * 1000;

/**
 * Sends through a real Google Workspace Gmail account via OAuth2 SMTP
 * (nodemailer's built-in Gmail OAuth2 support — no separate Gmail API
 * dependency). `userEmail` is both the OAuth2 principal and the `From`
 * address; Workspace domain policy is what actually allows or blocks it, not
 * anything this transport does.
 *
 * Every send goes through the same `EmailTransport` boundary as
 * `MockTransport` and `LocalFileTransport` (§7) — the engine and dispatcher
 * never know which one they are talking to.
 *
 * See `docs/setup-google-workspace.md` for how to obtain `clientId`,
 * `clientSecret`, and `refreshToken`.
 */
export class GoogleWorkspaceTransport {
  private readonly sendMailFn: (message: OutboundMessage) => Promise<SentMessage>;

  constructor(private readonly options: GoogleWorkspaceTransportOptions) {
    this.sendMailFn = options.sendMail ?? createNodemailerSender(options);
  }

  /**
   * Declared as an arrow property, not a method, so it can be handed straight
   * to anything expecting an `EmailTransport` without losing `this`.
   */
  readonly send: EmailTransport = async (message) => {
    const start = Date.now();
    try {
      const { messageId } = await this.sendMailFn(message);
      return { status: "sent", providerMessageId: messageId, latencyMs: Date.now() - start };
    } catch (error) {
      return classify(error, Date.now() - start);
    }
  };
}

function createNodemailerSender(
  options: GoogleWorkspaceTransportOptions,
): (message: OutboundMessage) => Promise<SentMessage> {
  const { userEmail, clientId, clientSecret, refreshToken, accessToken } = options;
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { type: "OAuth2", user: userEmail, clientId, clientSecret, refreshToken, accessToken },
  });

  return async (message: OutboundMessage) => {
    const info = await transporter.sendMail({
      from: userEmail,
      to: message.toName ? { name: message.toName, address: message.to } : message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
    return { messageId: info.messageId };
  };
}

/**
 * Maps a thrown send error onto the four `SendOutcome` cases (§7). Gmail's
 * own throttling is not a distinct SMTP status code — a daily-limit or
 * too-many-logins rejection arrives as ordinary 4xx/5xx text, so the pattern
 * match on the message runs before the numeric-code fallback, not after it.
 */
function classify(error: unknown, latencyMs: number): SendOutcome {
  const err = error as SendMailError;
  const message = err?.message ?? String(error);

  if (RATE_LIMIT_PATTERN.test(message)) {
    return { status: "rate_limited", cooldownMs: DEFAULT_RATE_LIMIT_COOLDOWN_MS, error: message, latencyMs };
  }

  // 5xx: the server permanently rejected this message (unknown user, blocked
  // content, policy violation) — retrying the same message will not help.
  if (err?.responseCode !== undefined && err.responseCode >= 500) {
    return { status: "permanent_failure", error: message, latencyMs };
  }

  // Everything else — 4xx SMTP rejects, auth/connection hiccups with no
  // response code at all — is treated as retryable.
  return { status: "transient_failure", error: message, latencyMs };
}
