import { GoogleWorkspaceTransport, LocalFileTransport, MockTransport } from "@cegaana/simple-mailer";
import type { EmailTransport } from "@cegaana/simple-mailer";

export interface TransportSelection {
  transport: EmailTransport;
  /** Human-readable description of what was selected, for CLI/status output. */
  description: string;
}

export interface TransportFlags {
  transport?: string;
  "out-dir"?: string;
  "google-user"?: string;
  "google-client-id"?: string;
  "google-client-secret"?: string;
  "google-refresh-token"?: string;
}

/**
 * Maps `--transport <local-file|mock|google-workspace>` to a concrete
 * Transport. `local-file` is the default: it drives the mail experience with
 * no credentials before Google Workspace is configured.
 *
 * `--transport`/`--out-dir` fall back to `MAILER_TRANSPORT`/`MAILER_OUT_DIR`
 * when not passed as flags; the four `google-workspace` credentials fall
 * back to `MAILER_GOOGLE_*` env vars the same way — see
 * `docs/setup-google-workspace.md`. Flags win when both are given. `cli.ts`
 * loads a `.env` file (if present) before this runs, so either source can
 * come from there.
 */
export function selectTransport(values: TransportFlags): TransportSelection {
  const kind = values.transport ?? process.env.MAILER_TRANSPORT ?? "local-file";

  switch (kind) {
    case "local-file": {
      const outDir = values["out-dir"] ?? process.env.MAILER_OUT_DIR ?? "./data/outbox";
      const localFile = new LocalFileTransport({ outDir });
      return { transport: localFile.send, description: `local-file (${outDir})` };
    }

    case "mock": {
      const mock = new MockTransport();
      return { transport: mock.send, description: "mock (in-memory, nothing persisted)" };
    }

    case "google-workspace": {
      const raw = {
        userEmail: values["google-user"] ?? process.env.MAILER_GOOGLE_USER_EMAIL,
        clientId: values["google-client-id"] ?? process.env.MAILER_GOOGLE_CLIENT_ID,
        clientSecret: values["google-client-secret"] ?? process.env.MAILER_GOOGLE_CLIENT_SECRET,
        refreshToken: values["google-refresh-token"] ?? process.env.MAILER_GOOGLE_REFRESH_TOKEN,
      };

      const missing = Object.entries(raw)
        .filter(([, value]) => !value)
        .map(([key]) => key);
      if (missing.length > 0) {
        throw new Error(
          `--transport google-workspace is missing: ${missing.join(", ")}. ` +
            `Set --google-user/--google-client-id/--google-client-secret/--google-refresh-token, ` +
            `or the matching MAILER_GOOGLE_* environment variables — see docs/setup-google-workspace.md.`,
        );
      }

      // Every value is confirmed non-empty above; TS can't narrow through
      // Object.entries, so tell it explicitly rather than casting the whole
      // object (which would silently accept a future field going missing).
      const creds = raw as { [K in keyof typeof raw]: string };

      const google = new GoogleWorkspaceTransport(creds);
      return { transport: google.send, description: `google-workspace (${creds.userEmail})` };
    }

    default:
      throw new Error(`Unknown --transport "${kind}". Expected "local-file", "mock", or "google-workspace".`);
  }
}
