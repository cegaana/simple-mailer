# @cegaana/simple-mailer

A self-contained, embeddable email queue and dispatch engine — SQLite-backed,
with rate pacing, exponential backoff, crash recovery, and a pluggable
delivery `Transport` (local-file, Google Workspace Gmail OAuth2, or an
in-memory mock for tests).

This is the library half of [simple-mailer](https://github.com/cegaana/simple-mailer);
the CLI is [`@cegaana/cmailer`](https://www.npmjs.com/package/@cegaana/cmailer).
Built and maintained by [CEGAANA](https://cegaana.org).

## Install

```bash
npm install @cegaana/simple-mailer better-sqlite3
```

## Quick start

```ts
import Database from "better-sqlite3";
import { MailerEngine, SqliteProvider, MockTransport, initSchema } from "@cegaana/simple-mailer";

const db = new Database("./data/app.db");
initSchema(db);

const mailer = new MailerEngine(new SqliteProvider(db), {
  transport: new MockTransport().send, // swap for LocalFileTransport or GoogleWorkspaceTransport to send for real
  delayMs: 2500,
  maxRetries: 2,
});

const campaignId = await mailer.createCampaign({
  name: "Alumni Meet 2026",
  subject: "Speaker briefing for {{ first_name }}",
  templateId: "speaker-invite", // create with provider.upsertTemplate first
});

await mailer.enqueueRecipients(campaignId, [
  { email: "you@example.com", name: "You", metadata: { first_name: "You" } },
]);

const report = await mailer.dispatch(campaignId, {
  onProgress: (p) => console.log(`[${p.percent}%] ${p.status} ${p.email}`),
});
```

## Documentation

Full docs — architecture, PRDs, CLI walkthroughs, Google Workspace setup —
live in the repository root:
[github.com/cegaana/simple-mailer](https://github.com/cegaana/simple-mailer#readme).

## License

Apache License 2.0 — see [LICENSE](https://github.com/cegaana/simple-mailer/blob/main/LICENSE) and [NOTICE](https://github.com/cegaana/simple-mailer/blob/main/NOTICE).
