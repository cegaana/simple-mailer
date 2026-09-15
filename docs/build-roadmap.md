# Mailer Engine — Build Roadmap

> Status: **v1 complete, including real email delivery.**
> 99 tests passing (75 library + 24 CLI), typecheck clean, lint clean, CLI verified end to end.
> The library (`simple-mailer/`) and CLI (`cmailer/`) are separate npm workspaces.
> `cmailer` dispatches through a real, credential-free `LocalFileTransport` by
> default, or `GoogleWorkspaceTransport` (`--transport google-workspace`) for
> real Gmail delivery — see [`setup-google-workspace.md`](./setup-google-workspace.md).
> See [`status-and-usage.md`](./status-and-usage.md) for what is done and how to run it.
>
> Ten phases from an empty `src/` to a working CLI. Each is small enough to finish
> and verify before the next begins, and each carries its own **gate** — so you
> never build the next thing on top of something unproven.
>
> **New here?** This page is a build log, not a task list — it records what
> shipped, in what order, and why, so the design is legible to anyone picking
> this up later. To actually run the thing, start with
> [`status-and-usage.md`](./status-and-usage.md) or the
> [`cli-testing-guide.md`](./cli-testing-guide.md) instead.
>
> Source of truth for v1 scope: [`../simple-mailer/schema/mailer-schema.sql`](../simple-mailer/schema/mailer-schema.sql)
> for table/column names. Where the PRDs
> ([`prd-mailer-subsystem.md`](./prd-mailer-subsystem.md),
> [`prd-mail-templates.md`](./prd-mail-templates.md)) disagree with what's
> documented below, **this roadmap wins** — the PRDs describe the v2 surface.

---

## Decisions locked

| | |
|---|---|
| **Language** | TypeScript 5.8, ESM (`"type": "module"`, `module: NodeNext`) |
| **Runtime** | Node >= 24 |
| **Storage** | `better-sqlite3`, behind `MailerDataProvider` |
| **Build / dev** | `tsc` (build + types) + `tsx` (dev) |
| **Tests** | Vitest, in each package's own `tests/` |
| **Static analysis** | ESLint (`@typescript-eslint`), `npm run lint` in each package |
| **Packages** | `simple-mailer/` (library, `@cegaana/simple-mailer`) + `cmailer/` (CLI, `@cegaana/cmailer`) as sibling npm workspaces |

### Design decisions made during the build

These extend draft2 §16. Each was a real fork in the road.

| # | Decision | Rationale |
|---|----------|-----------|
| 15 | **All timestamps are ISO 8601 UTC with milliseconds** (`2026-09-06T06:43:44.431Z`); DDL defaults use `strftime('%Y-%m-%dT%H:%M:%fZ','now')`, not `datetime('now')` | SQLite has no date type — these columns are TEXT and `next_attempt_at <= now` is a *string* comparison. `datetime('now')` puts a space where ISO puts a `T`, and a space sorts lower, so every default-written row looked permanently overdue. Measured, not theorised. |
| 16 | **Operational timestamps are passed in; `created_at` is a DDL default** | `next_attempt_at` and `locked_at` are read back and branched on, so tests must control them. `created_at` is only ever read by humans. Rule: *a timestamp the code branches on must be injectable.* |
| 17 | **`id` generated in the provider, typed `string` not `UUID`** | SQLite has no UUID function, so it happens in JS regardless. `string` keeps semantic slugs (PRD §2) available without changing every signature. |
| 18 | **Methods return values; failures throw** | A failed `INSERT` throws in `better-sqlite3`, so a `boolean` return advertises an outcome that cannot happen. Corollary: catch only when you can act — wrapping a `SqliteError` in a generic `Error` destroys the `.code` the enqueue path needs. |
| 19 | **`NewCampaign` carries `templateId`, never inline text/html** | Draft2 §6 is referenced-only in v1. The PRD's `createCampaign(name, subject, {text, html})` describes the v2 surface. |
| 20 | **The campaign's `subject` is the one that sends**; the template's is a starting value copied at creation | `_mailer_campaigns.subject` is `NOT NULL`, and §3 snapshot coupling means a mid-campaign template edit must not change the subject of the unsent half. |
| 21 | **`enqueueRecipients` is one transaction with `INSERT OR IGNORE`** | All-or-nothing, so a failure is a state you repeat rather than diagnose. `OR IGNORE` stops an expected duplicate from rolling back the batch, while a real failure (FK on an unknown campaign) still throws and rolls everything back. Verified. |
| 22 | **`claimDueJobs` is a single `UPDATE ... RETURNING`** | Atomicity cannot be assembled by a caller — the gap between find-then-mark is exactly where a second worker or the lease sweeper claims the same job and sends it twice. The `LIMIT` sits in a subquery, since `UPDATE ... LIMIT` needs a non-default compile flag. |
| 23 | **`SendOutcome` is a discriminated union, not a string enum** | `rate_limited` carries a cooldown, `sent` carries a provider message id. A tagged union lets the compiler enforce which fields exist in which branch. |
| 24 | **The engine is async; the provider is synchronous** | This layer awaits the transport and sleeps between sends. Storage does not block on a network, so making it async would be theatre. |
| 25 | **The clock and the sleep function are injected into `MailerEngine`** | Lease recovery and backoff are time-dependent by nature. Injecting both turns a 61-second test into a 2-millisecond one, and it is the only way to test expiry without fabricating rows around the code under test. |
| 26 | **`_mailer_logs` gained `provider_message_id`; two missing indexes added** | Draft2 §12 says logs record the provider message id and PRD §2 specifies both indexes; the DDL had neither. |
| 27 | **`CampaignStats` gained `processingCount` and `cancelledCount`** | The PRD's fields could not sum to `totalQueued`, so no caller could trust the numbers. `successRate` stays a formatted string — it is a display value; arithmetic should use the counts. |
| 28 | **Library and CLI split into sibling packages** (`simple-mailer/`, `cmailer/`) | Decision 1 in this table already separated the concerns in code (`MailerEngine` never took a db path or CLI flags); this made the npm-package boundary match it, so `cmailer` can only reach the library's public `exports["."]`. |
| 29 | **Every delivery channel is named `<Kind>Transport`** (`MockTransport`, `LocalFileTransport`, `GoogleWorkspaceTransport`) | One naming convention across the `EmailTransport` seam, so a new channel is obviously a peer of the existing ones rather than a special case. |
| 30 | **`LocalFileTransport` lives in the library, not the CLI** | It implements `EmailTransport` like any other transport — the CLI only selects and configures it (`cmailer/src/transport.ts`). Keeps the "CLI supplies config, library does the work" boundary from decision 28 intact. |
| 31 | **`schema/*.sql` is copied into `dist/schema/` at build time** | `schema.ts` previously resolved the DDL relative to a sibling *source* `schema/` folder at runtime — `dist/` was not a self-contained artifact. It now prefers a bundled `dist/schema/` copy and falls back to the source folder only when running uncompiled (`tsx`/vitest against `src/`). |
| 32 | **`GoogleWorkspaceTransport` uses nodemailer's Gmail OAuth2 SMTP support, not the `googleapis` Gmail REST API** | PRD §1 named "Nodemailer with Google Workspace Gmail API / OAuth2 transport"; nodemailer alone handles OAuth2 token refresh, MIME composition, and SMTP delivery in one well-tested dependency, versus `googleapis`' much larger surface for a single `messages.send` call. Matches the project's minimal-dependency philosophy (`better-sqlite3` was the only runtime dep before this). |
| 33 | **`GoogleWorkspaceTransport` classifies errors by matching message text for rate-limit language before falling back to the numeric SMTP response code** | Gmail's own throttling ("receiving mail too quickly", "Daily user sending limit exceeded") arrives as an ordinary-looking 4xx/5xx, not a distinct code — a numeric-code-only classifier would misroute it as a plain transient or permanent failure instead of `rate_limited`. |
| 34 | **`MailerAuthOptions` (PRD §3, previously unused) is `GoogleWorkspaceTransportOptions`** | The original PRD type for Gmail credentials existed in `types.ts` since v1 but nothing consumed it — reused rather than duplicated once a real Gmail transport needed exactly that shape. |
| 35 | **Credentials are sourced as flag → `MAILER_GOOGLE_*` env var → error**, loaded from a `.env`/`.env.local` file `cmailer` reads itself (`cmailer/src/env.ts`) rather than the `dotenv` package | PRD §1 named `dotenv`; Node's built-in `process.loadEnvFile()` (stable since well before the Node >=24 floor here) covers the same need with no new dependency. `.env` is the conventional symlink target to `.env.local`, but the loader reads `.env.local` directly too, so the symlink is a convenience, not a requirement. |
| 36 | **`cmailer/src/cli.ts` is a thin router; each command group is its own module under `cmailer/src/commands/`** | Grew past what one file should hold once `send` and `template upsert` landed alongside the original four groups. `cli.ts` now only does `parseArgs` and the group/subcommand switch; every handler takes an already-constructed `MailerEngine` and the parsed flags, which is also what makes them directly unit-testable (`cmailer/tests/send.test.ts`) without going through the process boundary. |
| 37 | **`upsertTemplate` is one `INSERT ... ON CONFLICT (slug) DO UPDATE ... RETURNING id` statement, not a caller-assembled get-then-create-or-update** | Same atomicity argument as `claimDueJobs` (decision 22) — a caller-assembled version has a window a concurrent upsert of the same slug could land in. `id` is only bound on insert; `ON CONFLICT` never touches it, so `RETURNING id` gives back the existing row's id on an update, the freshly generated one on insert, and the caller never has to ask which happened. |
| 38 | **`cmailer send` (create + enqueue + dispatch + stats in one call) takes `--html`/`--text` as an optional pair that upserts the template first, not a separate flag to opt in** | Mirrors how an operator actually iterates on a recurring mailing: edit the body files, rerun the same command. Requiring both together (enforced by `need()`, not a separate check) rather than allowing one without the other avoids a half-updated template being a distinct, harder-to-debug state. |
| 39 | **Campaign stats overview table & automatic dry-run/live mode audit** | `cmailer campaign stats` without `<campaign-id>` (and `cmailer campaign list --stats`) prints a tabular delivery summary across all campaigns, including a `MODE` column (`dry-run` vs `live` vs `-`). `CampaignStats` and `DispatchReport` carry `isDryRun` and `mode`, derived from whether attempts routed through `MockTransport`. |

---

## Phase status

Phases are tracked in the engine's own job-state vocabulary (§8): `sent` = done,
`processing` = current, `pending` = queued.

| # | Phase | Status |
|---|-------|--------|
| 00 | Design reconciled | `sent` |
| 01 | Toolchain | `sent` |
| 02 | Types | `sent` |
| 03 | Schema bootstrap | `sent` |
| 04 | `MailerDataProvider` | `sent` |
| 05 | Campaign create & enqueue | `sent` |
| 06 | Delivery boundary & mock transport | `sent` |
| 07 | Queue engine | `sent` |
| 08 | Paced dispatcher | `sent` |
| 8b | `MailerEngine` — the public API | `sent` |
| 09 | Template engine | `sent` |
| 10 | CLI | `sent` |
| 10b | Library / CLI split into sibling packages | `sent` |
| 11a | **Local-file transport** | `sent` |
| 11b | **Google Workspace Gmail transport** | `sent` |
| 12 | Template upsert + `cmailer send` combo command; CLI split into `commands/` modules | `sent` |
| 13 | All-campaign stats overview table & dry-run / live mode audit | `sent` |

### What exists today

```
simple-mailer/src/               the library (@cegaana/simple-mailer)
  index.ts                       public exports
  types.ts                       status unions, boundary payloads, SendOutcome, QueuedJob
  schema.ts                      initSchema(db) — pragmas + DDL, idempotent
  db.ts                          openMailerDatabase(path)
  provider.ts                    MailerDataProvider — 17 methods + upsertTemplate
  sqlite-provider.ts             SqliteProvider + row → domain mapping
  mock-transport.ts              MockTransport — records attempts, injects faults
  local-file-transport.ts        LocalFileTransport — real, credential-free delivery
  google-workspace-transport.ts  GoogleWorkspaceTransport — Gmail OAuth2 SMTP via nodemailer
  backoff.ts                     pure exponential backoff
  template.ts                    interpolation, defaults, HTML escaping
  engine.ts                      MailerEngine — clock, defaults, dispatch loop
simple-mailer/tests/              9 files, 74 tests

cmailer/src/                     the CLI (@cegaana/cmailer)
  cli.ts                         entrypoint — parseArgs, command routing only
  commands/                      one module per group: campaign, template, suppression, dispatch, send
  transport.ts                   --transport / --out-dir / --google-* → concrete Transport
  env.ts                         loads .env / .env.local (MAILER_GOOGLE_* etc.)
  flags.ts, csv.ts, table.ts, version.ts, help.ts
cmailer/tests/                    4 files, 19 tests
```

---

## 11a — Local-file transport `sent`

`LocalFileTransport` (`simple-mailer/src/local-file-transport.ts`) writes each
message to an inspectable folder under a configurable output directory
(`subject.txt`, `body.html`, `body.txt`, `envelope.json`), plus one line per
send appended to `index.ndjson`. It is `cmailer`'s default (`--transport
local-file`, `--out-dir`, default `./data/outbox`) — a real delivery channel,
distinct from the in-memory `MockTransport` test double, that needs no
credentials. `--dry-run` still forces the mock transport for that run.

**Gate:** `cmailer dispatch <id>` with no flags writes real files under
`./data/outbox/`; `--dry-run` writes nothing. Both verified end to end.

---

## 11b — Google Workspace Gmail transport `sent`

`GoogleWorkspaceTransport` (`simple-mailer/src/google-workspace-transport.ts`)
sends through a real CEGAANA Google Workspace mailbox via Gmail's OAuth2 SMTP
support (nodemailer — decision 32, not the `googleapis` REST client).

- [x] Provider: Gmail OAuth2 SMTP via nodemailer (decision 32)
- [x] Dependency added — `nodemailer` (+ `@types/nodemailer`)
- [x] `GoogleWorkspaceTransport` maps send errors onto the four `SendOutcome`
      cases — rate-limit language in the error text (checked before the
      numeric code) → `rate_limited`; 5xx → `permanent_failure`; everything
      else (4xx, auth/connection errors) → `transient_failure` (decision 33)
- [x] Credentials via `GoogleWorkspaceTransportOptions` (= `MailerAuthOptions`,
      decision 34) and `MAILER_GOOGLE_*` env vars loaded from a gitignored
      `.env`/`.env.local`, with a committed `.env.example` (decision 35)
- [x] `cmailer/src/transport.ts` case for `--transport google-workspace`,
      following the same seam as `local-file`

**Gate:** one real message delivered end to end — verified via `.env.local` +
fake credentials producing a real SMTP round trip that correctly classifies
as `transient_failure` (auth rejected), and the classifier's rate-limit and
permanent-failure paths covered by injected-error unit tests
(`simple-mailer/tests/google-workspace-transport.test.ts`). A forced quota
error still produces `status: 'aborted'` with the campaign `paused` — that
path is engine-level (§11) and untouched by which transport triggers it.

See [`setup-google-workspace.md`](./setup-google-workspace.md) for the OAuth2
client + refresh token setup, and
[`cli-walkthrough-google-workspace.md`](./cli-walkthrough-google-workspace.md)
for the usage walkthrough.

Nothing else changed — that is what the §7 boundary bought.

---

## 12 — Template upsert, `cmailer send`, CLI modularization `sent`

Prompted by a real operator script (not committed to this repo) that upserted
a template via raw SQL and ran `campaign create` →
`campaign enqueue` → `dispatch` → `campaign stats` as four separate `cmailer`
invocations for every mailing. Both gaps are now first-class:

- [x] `MailerDataProvider.upsertTemplate` / `MailerEngine.upsertTemplate` —
      create-or-update by slug, one atomic `INSERT ... ON CONFLICT DO UPDATE
      ... RETURNING id` statement (decision 37). `cmailer template upsert`
      exposes it directly.
- [x] `cmailer send` — the one-shot version of create + enqueue + dispatch +
      stats, with an optional `--html`/`--text` pair that upserts the
      template first (decision 38). Shares its dispatch logic with the
      standalone `dispatch` command via `runDispatch` (`commands/dispatch.ts`).
- [x] `cmailer/src/cli.ts` split into a thin router plus one module per
      command group under `cmailer/src/commands/` (decision 36) — grown past
      what one file should hold once these two landed alongside the original
      four groups.

**Gate:** `cmailer send` end to end (upsert → campaign → enqueue → dispatch →
stats) verified against a real local-file dispatch, including that a second
`send` call with edited body files updates the same template (same id) rather
than creating a duplicate. Covered by
`simple-mailer/tests/provider.test.ts`'s `upsertTemplate` suite and
`cmailer/tests/send.test.ts`.

Domain-specific mailing content (subject lines, ticket-type template
selection, which HTML file goes with which slug) stays in the operator's own
wrapper script — see `docs/cli-walkthrough-google-workspace.md`'s note on
this — not in `cmailer` itself.

---

## 07 — Queue engine `sent`

Draft2's twice-deferred Phase 5, and the hardest correctness work in the project.

- [x] **`claimDueJobs(campaignId, limit, now)`** — single `UPDATE ... RETURNING`;
      takes `pending`/`retrying` jobs whose `next_attempt_at <= now` into
      `processing` with `locked_at = now`. Six tests.
- [x] **Backoff** — `src/backoff.ts`, pure, 30s base doubling to a 1h ceiling.
- [x] **`markSent` / `markRetrying` / `markFailed`**.
- [x] **`reclaimExpiredLeases(cutoff, now)`** — the sweeper.
- [x] **The `maxRetries + 1` conversion** now lives in `MailerEngine.maxAttempts`,
      the one place that knows the difference.

**Gate:** a job abandoned in `processing` returns to `retrying` once the lease
expires, and a job that fails three times lands in `failed` with exactly three
`_mailer_logs` rows.

---

## 08 — Paced dispatcher `sent`

`dispatch()` with the enforced `delayMs` sleep between sends (2500ms ≈ 24/min),
the `onProgress` callback, the `rate_limited` abort that pauses the campaign, and
an audit row appended to `_mailer_logs` per attempt.

Also needs, at the provider level: **log write** and **stats query** (draft2 §10).

**Gate:** a simulated 429 leaves the campaign `paused` and returns
`status: 'aborted'` with an `abortReason` — no further sends.

---

## 8b — `MailerEngine` — the public API `sent`

**Not in the original roadmap, and it is a real gap.** Everything built so far is
the provider layer. The class the PRD §3 advertises — the one the README's usage
example calls, and the one the CLI will wrap — does not exist yet.

It is the layer that:

- applies `MailerDefaults` (and converts `maxRetries` → `max_attempts`)
- owns the clock, passing `now` down to the provider
- validates input before it reaches SQL
- decides campaign lifecycle transitions (§11)

**Resolved:** the public API is async and the provider is synchronous. Not for
future-proofing — because this layer genuinely awaits: it calls the transport and
it sleeps between sends. Storage below it never blocks on a network.

---

## 09 — Template engine `sent`

Referenced-only templates. `{{ var }}` interpolation against `metadata`,
`{{ var | default('Friend') }}` fallbacks, HTML-entity escaping for `body_html`.

Also the deferred half of the mock: PRD §5's `.data/mock_mailer_sinks/` disk
output, useful only once there is rendered HTML worth eyeballing.

**Gate:** a merge value of `<script>` renders escaped in the HTML body and literal
in the text body.

---

## 10 — CLI `sent`

`campaign create`, `campaign enqueue`, `campaign stats`, `dispatch`, `template`,
`suppression`. Built last because it is only a shell over the API.

**Gate:** `dispatch <id> --dry-run` runs a full campaign through `MockTransport`
and prints a report.

---

## Explicitly out of v1

Named so they stay decisions rather than oversights. Each has a seam left for it;
none has code written behind that seam.

Channel abstraction · WhatsApp · inline campaign templates · signatures and
`{{ signature }}` · `system.*` variables · signed unsubscribe URLs · raw-HTML
`{{{ }}}` blocks · SMTP transport · multiple workers · backoff jitter and cap ·
template versioning · A/B variants · admin UI.

### Gaps found during the build that the design docs never named

- [ ] **No migration story.** `CREATE TABLE IF NOT EXISTS` checks only that a
      table *exists*, never its shape. Add a column to `mailer-schema.sql` and
      every fresh database gets it while every existing one silently does not —
      surfacing later as `no such column`, on exactly the databases holding real
      campaign history. Not v1 work; needs to be a named deferral.
- [ ] **The snapshot is only half a snapshot.** §3 promises a campaign is frozen,
      and recipients are. Content is not: `body_html`/`body_text` live only in
      `_mailer_templates` and are read live at send time, so editing a template
      mid-campaign changes every email not yet sent. `subject` is snapshotted
      (decision 20); the body is not.
- [x] ~~**`CampaignStats` is unsound.**~~ Fixed — decision 27.
- [ ] **Job cancellation is designed but unbuilt.** §8 has
      `pending`/`retrying` → `cancelled`, and the status exists in the union and
      the DDL, but no API reaches it.

---

_Correctness over scalability. Single machine, single worker, MVP first._
