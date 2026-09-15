# Simple Mailer — Status & Usage

**Last verified:** 99 tests passing (75 library + 24 CLI), `tsc --noEmit`
clean, `eslint` clean, full CLI pipeline exercised end to end (including a
real SMTP round trip against Gmail with intentionally-fake OAuth2 credentials,
to verify `GoogleWorkspaceTransport`'s error classification without needing
real ones).

---

## 1. What is done

All of draft2 §14's v1 scope, including real email delivery. The library
(`simple-mailer/`, `@cegaana/simple-mailer`) and the CLI (`cmailer/`,
`@cegaana/cmailer`) are separate npm workspaces.

| Area | State | Where |
| :--- | :--- | :--- |
| Schema bootstrap (idempotent, WAL, foreign keys) | done | `simple-mailer/src/schema.ts` |
| Storage seam — 20 methods, all SQL confined to one file | done | `simple-mailer/src/provider.ts`, `sqlite-provider.ts` |
| Template upsert (create-or-update by slug, one statement) | done | `provider.upsertTemplate` |
| Snapshot enqueue — dedupe, suppression filter, one transaction | done | `sqlite-provider.ts` |
| Atomic claim — single `UPDATE … RETURNING` | done | `sqlite-provider.ts` |
| Six-state job machine + exponential backoff | done | `backoff.ts`, `engine.ts` |
| Lease-based crash reclaim | done | `engine.reclaimExpiredLeases()` |
| Delivery boundary — four generic outcomes | done | `types.ts` (`SendOutcome`) |
| Mock transport with fault injection | done | `mock-transport.ts` |
| Local-file transport — real, credential-free delivery | done | `local-file-transport.ts` |
| Google Workspace Gmail transport — real OAuth2 SMTP delivery | done | `google-workspace-transport.ts` |
| Paced dispatcher, rate-limit abort, audit logs | done | `engine.ts` |
| Template engine — interpolation, defaults, HTML escaping | done | `template.ts` |
| Campaign lifecycle (§11) | done | `engine.ts` |
| Public API (`MailerEngine`) | done | `engine.ts` |
| CLI (modular: one command-group module per file) | done | `cmailer/src/cli.ts`, `cmailer/src/commands/` |
| `cmailer send` — create + enqueue + dispatch + stats, one call | done | `cmailer/src/commands/send.ts` |

### Not done

No v1-scope item remains. See `build-roadmap.md`'s "Explicitly out of v1" and
"Gaps found during the build" for what's deliberately deferred, and "Also
outstanding" below for the two smaller, tracked gaps.

### Also outstanding

- Migrations (see "Known gaps" in `build-roadmap.md`)
- Job cancellation (`pending`/`retrying` → `cancelled`) — in the state machine,
  not yet in the API

---

## 2. Running it

### Setup

```bash
npm install
npm run typecheck     # tsc --noEmit
npm test              # vitest run
npm run build         # emits dist/
```

### The CLI

In development, `npm run dev -- <args>` (run inside `cmailer/`, or
`npm run dev --workspace cmailer -- <args>` from the root) runs `cmailer/src/cli.ts`
through `tsx`. After `npm run build`, `node cmailer/dist/cli.js <args>` works,
as does the `cmailer` bin once the package is linked or installed.

A complete session:

```bash
# 1. A template. Bodies come from files so real HTML is not shell-quoted.
npm run cmailer -- template create \
  --slug speaker-invite \
  --name "Speaker invite" \
  --subject "Invitation for {{ first_name }}" \
  --html ./body.html \
  --text ./body.txt

# 2. Anyone who must never be emailed
npm run cmailer -- suppression add bounce@example.com --reason hard_bounce

# 3. A campaign — prints its id
npm run cmailer -- campaign create \
  --name "Alumni Meet 2026" \
  --subject "Speaker briefing for {{ first_name }}" \
  --template speaker-invite

# 4. Recipients from CSV. An `email` column is required; `name` is used if
#    present; every other column becomes a merge variable.
npm run cmailer -- campaign enqueue <campaign-id> --csv ./recipients.csv
# → queued 2, duplicates 0, suppressed 1

# 5. Check the rendering before sending anything
npm run cmailer -- template preview speaker-invite \
  --data '{"first_name":"Charlie","event_name":"CEGAANA Fall Event"}'

# 6. Send — writes real files under ./data/outbox/ (LocalFileTransport, no
#    credentials needed); nothing is sent over the network yet
npm run cmailer -- dispatch <campaign-id>
# [ 50%] sent     charlie@example.com
# [100%] sent     jane@example.com

# 7. Where it landed
npm run cmailer -- campaign stats <campaign-id>   # detailed JSON stats
npm run cmailer -- campaign stats                 # tabular overview of all campaigns (with MODE)
npm run cmailer -- campaign list --stats          # same overview table
```

`--db <path>` picks the database (default `./data/mailer.db`); `--transport
<local-file|google-workspace|mock>` picks the delivery channel (default `local-file`);
`--out-dir <path>` picks where `local-file` writes (default `./data/outbox`);
`--delay <ms>` overrides the 2,500 ms pacing; `--limit <n>` caps how many jobs
one run claims; `--dry-run` forces the mock transport regardless of
`--transport`, so nothing is written or sent.

Example `recipients.csv`:

```csv
email,name,first_name,event_name
charlie@example.com,Charlie Brown,Charlie,CEGAANA Fall Event
jane@example.com,Jane Doe,Jane,CEGAANA Fall Event
```

### As a library

```ts
import {
  MailerEngine, SqliteProvider, MockTransport, initSchema,
} from "@cegaana/simple-mailer";
import Database from "better-sqlite3";

const db = new Database("./data/mailer.db");
initSchema(db);

const engine = new MailerEngine(new SqliteProvider(db), {
  transport: new MockTransport().send,   // swap for a real transport
  delayMs: 2500,
  maxRetries: 2,
});

const campaignId = await engine.createCampaign({
  name: "Alumni Meet 2026",
  subject: "Speaker briefing for {{ first_name }}",
  templateId: "speaker-invite",
});

await engine.enqueueRecipients(campaignId, [
  { email: "charlie@example.com", name: "Charlie", metadata: { first_name: "Charlie" } },
]);

const report = await engine.dispatch(campaignId, {
  onProgress: (p) => console.log(`[${p.percent}%] ${p.status} ${p.email}`),
});
```

---

## 3. Testing it

```bash
npm test              # once
npm run test:watch    # re-runs on save
```

75 library tests across nine files, plus 24 CLI tests across five files. The
library suite runs against an in-memory SQLite database and `MockTransport` —
no credentials, no network, no sleeping — except `google-workspace-transport.test.ts`,
which injects a fake `sendMail` function for the same reason (see "Two
techniques" below).

`simple-mailer/tests/`:

| File | Covers |
| :--- | :--- |
| `schema.test.ts` | six tables created; idempotent; foreign keys enforced |
| `provider.test.ts` | suppression lookup, campaign insert, the six enqueue cases, persisted suppressed/duplicate counts, suppression stats, template upsert (create, update-in-place, isolation from other slugs) |
| `claim.test.ts` | atomic claim: due/not-due, limit, no double hand-out, campaign isolation |
| `mock-transport.test.ts` | default success, forced failures, rate limiting, detached `send` |
| `local-file-transport.test.ts` | writes an inspectable folder per message, appends to `index.ndjson`, detached `send` |
| `google-workspace-transport.test.ts` | success, rate-limit text detection ahead of the numeric code, 5xx → permanent, 4xx/no-code → transient, detached `send` |
| `backoff.test.ts` | doubling, ceiling, ISO arithmetic |
| `template.test.ts` | interpolation, defaults, dotted paths, HTML escaping |
| `engine.test.ts` | dispatch happy path, retries, exhaustion, rate-limit abort, lease recovery, stats, suppression, strict `previewTemplate` |

`cmailer/tests/`:

| File | Covers |
| :--- | :--- |
| `csv.test.ts` | CSV → `RecipientInput[]`: name/metadata mapping, case-insensitive columns, missing-column and empty-file errors |
| `transport.test.ts` | `--transport` defaulting to local-file, `mock` selection, unknown-value error, `google-workspace` via flags/env vars/flag-over-env precedence, missing-credential error |
| `env.test.ts` | `.env`/`.env.local` loading and precedence |
| `send.test.ts` | upsert-then-send, repeat send overwrites the same template (not a duplicate), sending an existing template unchanged, `--html` without `--text` throws |

### Two techniques that make this suite fast

**The clock is injected.** `MailerEngine` takes `now: () => string`, so a test
can advance an hour between dispatches instead of waiting. Without it, the
lease-recovery test would take 61 seconds and the retry test 30.

```ts
let t = new Date("2026-09-06T12:00:00.000Z").getTime();
const engine = new MailerEngine(provider, {
  transport: mock.send,
  now: () => new Date(t).toISOString(),
  sleep: async () => {},        // pacing is exercised, never waited on
});
t += 61_000;                    // the lease has now expired
```

**Failures are configured, not simulated.** `MockTransport` takes
`outcomeFor` and `rateLimitAfter`, so every branch of the dispatcher is
reachable without a provider that misbehaves on cue.

---

## 4. Verifying a change

```bash
npm run typecheck && npm run lint && npm test
```

All three must be clean. The typecheck matters as much as the tests here: most of
this design is enforced by types — the status unions, the `SendOutcome`
discriminated union, and the provider interface that keeps SQL in one file.
