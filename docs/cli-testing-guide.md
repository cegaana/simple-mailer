# Simple Mailer — CLI Feature Test Guide

A start-to-finish script for exercising **every** feature Simple Mailer exposes
on the command line, in the order you would actually use them: build a template,
preview it, suppress an address, create a campaign, load a recipient list,
dispatch it, and read back the results.

Every command below is copy-pasteable **as written** and is meant to be run from
the **project root** (the folder that contains `docs/`, `README.md`, and
`simple-mailer/`).

> **Nothing is actually emailed.** `cmailer` sends through `LocalFileTransport`
> by default: every message is written to a local folder (`./data/outbox/` by
> this guide's `--db`-style convention), not sent over the network. You can use
> real addresses safely — no message leaves your machine. Pass `--dry-run` if
> you want a run that writes nothing at all (routes through an in-memory mock
> instead).

---

## 1. Prerequisites

- **Node.js 24 or newer** — check with `node -v`.
- Optional, for the "look underneath" section: the `sqlite3` command-line tool.

---

## 2. One-time setup

From the project root, install and build. Installing at the root builds the
package automatically (npm workspaces runs the package's `prepare` script), so
the `cmailer` command is ready afterward:

```bash
npm install
```

That single command installs dependencies and compiles both `simple-mailer/src`
(the library) and `cmailer/src` (the CLI) into their respective `dist/`
folders. To rebuild later after changing the source, run `npm run build`.

### Make `cmailer` runnable from the root folder

Pick whichever of these you prefer — all three run the exact same CLI from the
root folder:

| How to run it | Command form | Needs `npm install` first? |
| :--- | :--- | :--- |
| **npx** (reads like the real command) | `npx cmailer <args>` | Yes |
| **npm script** | `npm run cmailer -- <args>` | No (just a build) |
| **node, directly** | `node cmailer/dist/cli.js <args>` | No (just a build) |

**This guide uses a shell alias** so the commands read exactly like the shipped
tool. Set it once in your terminal session, from the project root:

```bash
alias cmailer="node $PWD/cmailer/dist/cli.js"
```

Now `cmailer ...` works for the rest of this guide. (If you would rather
have a permanent, global `cmailer` command, run `npm link` inside the
`cmailer/` folder — but that installs it on your machine, which you may not
want.)

Confirm it works:

```bash
cmailer --version
```

```
2.0.0
```

---

## 3. Explore the help

The CLI has a top-level overview and a **dedicated help page for every command**.

```bash
cmailer --help
```

```
cmailer — CEGAANA mail CLI, built on simple-mailer

Usage
  cmailer <command> [subcommand] [options]

Commands
  campaign      Create campaigns, enqueue recipients from CSV, and view stats
  dispatch      Send a campaign's queued messages
  send          Create a campaign, enqueue a CSV, dispatch it, and print stats — one command
  template      Create, update, preview, and list email templates
  suppression   Manage the do-not-send list
  help          Show help for a command (e.g. "cmailer help campaign")

Global options
  --db <path>          Database file (default ./data/mailer.db)
  --transport <kind>   Delivery transport: "local-file" (default), "mock", or
                        "google-workspace" — see docs/setup-google-workspace.md
  --out-dir <path>     Output directory for --transport local-file (default ./data/outbox)
  -h, --help           Show help
  -v, --version        Show the installed version

A ".env" file in the current directory is loaded automatically, if present —
see docs/setup-google-workspace.md for the MAILER_GOOGLE_* variables it can set.

Run "cmailer <command> --help" for detailed help on a command.
```

Drill into any command — these two are equivalent:

```bash
cmailer campaign --help
cmailer help campaign
```

Try `cmailer dispatch --help`, `cmailer template --help`, and
`cmailer suppression --help` too; each lists its subcommands and options.

---

## 4. Set up demo fixtures

Every email carries both an HTML and a plain-text body, so you need two body
files. You also need a recipient list (CSV) and a small "duplicate" list. Keep
them — and the demo database — out of the repo, in a temp folder:

```sh
mkdir -p /tmp/cmailer-demo

cat > /tmp/cmailer-demo/body.html <<'HTML'
<p>Dear {{ first_name | default('Friend') }},</p>
<p>You're confirmed for {{ event_name }}, class of {{ grad_year }}.</p>
HTML

cat > /tmp/cmailer-demo/body.txt <<'TXT'
Dear {{ first_name | default('Friend') }},

You're confirmed for {{ event_name }}, class of {{ grad_year }}.
TXT

cat > /tmp/cmailer-demo/recipients.csv <<'CSV'
email,name,first_name,event_name,grad_year
charlie@example.com,Charlie Brown,Charlie,CEGAANA Fall Event,1988
jane@example.com,Jane Doe,Jane,CEGAANA Fall Event,1991
optout@example.com,Opt Out,Opt,CEGAANA Fall Event,1999
CSV

cat > /tmp/cmailer-demo/dupes.csv <<'CSV'
email,name,first_name,event_name,grad_year
charlie@example.com,Charlie Brown,Charlie,CEGAANA Fall Event,1988
CSV
```

Two things worth understanding about the CSV:

- The **`email` column is required.** A `name` column is used if present.
- **Every other column becomes a merge variable** — so `first_name`,
  `event_name`, and `grad_year` are what fill the `{{ ... }}` slots in the
  template.

### Keep this demo isolated with `--db`

Every command below writes to `/tmp/cmailer-demo/mailer.db` via the global
`--db` flag, so this run never touches the default `./data/mailer.db`. To save
typing, put the flag in a variable:

```bash
DB="/tmp/cmailer-demo/mailer.db"
```

The database file is created automatically on first use.

---

## 5. Templates

A **template** is the message: a subject and an HTML + text body with
`{{ placeholder }}` slots. Create one:

```bash
cmailer template create \
  --db $DB \
  --slug speaker-invite \
  --name "Speaker invite" \
  --subject "Invitation for {{ first_name | default('there') }}" \
  --html /tmp/cmailer-demo/body.html \
  --text /tmp/cmailer-demo/body.txt
```

It prints a generated template id (a UUID). Templates are stored once and reused
across campaigns.

List what exists:

```bash
cmailer template list --db $DB
```

```
SLUG                         NAME
speaker-invite               Speaker invite
```

### Preview before sending anything

`preview` renders a template with sample data and prints it — no database rows,
no sending. This is how you check a message before committing to a few thousand
of them.

```bash
cmailer template preview speaker-invite --db $DB \
  --data '{"first_name":"Charlie","event_name":"CEGAANA Fall Event","grad_year":1988}'
```

```
Subject: Invitation for Charlie

--- text ---
Dear Charlie,

You're confirmed for CEGAANA Fall Event, class of 1988.

--- html ---
<p>Dear Charlie,</p>
<p>You're confirmed for CEGAANA Fall Event, class of 1988.</p>
```

Note `grad_year` is a JSON **number**, not a string — merge data from a
spreadsheet is not all strings, and the renderer handles it.

Now render it with **nothing** to fill the slots:

```bash
cmailer template preview speaker-invite --db $DB --data '{}'
```

```
Missing template variable "event_name" and no default was given
```

`preview` renders **strictly**: any `{{ variable }}` with no value **and** no
`| default(...)` throws, rather than silently sending a blank where
`{{ event_name }}` should have been. Only `first_name` has a default here
(`{{ first_name | default('Friend') }}` in the body, `{{ first_name |
default('there') }}` in the subject) — supply just enough to clear the
undefaulted variables and the default still kicks in for the rest:

```bash
cmailer template preview speaker-invite --db $DB \
  --data '{"event_name":"CEGAANA Fall Event","grad_year":1988}'
```

```
Subject: Invitation for there

--- text ---
Dear Friend,

You're confirmed for CEGAANA Fall Event, class of 1988.
```

---

## 6. Suppression (opt-outs)

The suppression list is **global**: an address on it is never emailed by any
campaign. Add one now, before building the list, so you can see it take effect.

```bash
cmailer suppression add optout@example.com --reason unsubscribe --db $DB
```

```
suppressed optout@example.com
```

```bash
cmailer suppression list --db $DB
```

```
EMAIL                                REASON           CREATED AT
optout@example.com                   unsubscribe      2026-09-09T03:05:50.994Z
```

```bash
cmailer suppression stats --db $DB
```

```json
{
  "total": 1,
  "byReason": {
    "unsubscribe": 1
  }
}
```

---

## 7. Campaigns

A **campaign** is one send: a name, its own subject line, and the template to
use. Create one and capture the id it prints — the rest of the guide needs it:

```bash
CID=$(cmailer campaign create --db $DB \
  --name "Alumni Meet 2026" \
  --subject "Briefing for {{ first_name | default('there') }}" \
  --template speaker-invite)

echo "$CID"
```

> If `echo "$CID"` shows more than a bare id, run the `campaign create` command
> on its own, copy the id, and set it by hand: `CID=paste-the-id-here`.

A campaign has its **own** subject, snapshotted at creation — separate from the
template's subject, and it is the one actually sent.

List campaigns (a new one starts in `draft`):

```bash
cmailer campaign list --db $DB
```

```
ID                                   STATUS     MODE     NAME
<campaign-id>                        draft      -        Alumni Meet 2026
```

---

## 8. Build the list (enqueue)

Enqueue loads recipients from the CSV. **Nothing is sent** — it just builds the
queue, one row per recipient, and applies suppression as it goes.

```bash
cmailer campaign enqueue "$CID" --db $DB --csv /tmp/cmailer-demo/recipients.csv
```

```
queued 2, duplicates 0, suppressed 1
```

Three rows in, two queued: `optout@example.com` was filtered out because you
suppressed it in step 6. **Suppression is applied when the list is built.**

Enqueue an overlapping list to see de-duplication. The queue enforces one row
per address per campaign, so re-adding someone is counted, not duplicated:

```bash
cmailer campaign enqueue "$CID" --db $DB --csv /tmp/cmailer-demo/dupes.csv
```

```
queued 0, duplicates 1, suppressed 0
```

This matters in practice: people re-run an import after fixing one row, and
nobody should receive two copies.

Check the state before sending:

```bash
cmailer campaign stats "$CID" --db $DB
```

```json
{
  "campaignId": "<campaign-id>",
  "campaignName": "Alumni Meet 2026",
  "status": "draft",
  "isDryRun": null,
  "mode": "not_run",
  "totalQueued": 2,
  "sentCount": 0,
  "retryingCount": 0,
  "failedCount": 0,
  "pendingCount": 2,
  "processingCount": 0,
  "cancelledCount": 0,
  "successRate": "0.0%",
  "suppressedCount": 1,
  "duplicateCount": 1
}
```

You can also list delivery statistics across all campaigns at once:

```bash
cmailer campaign stats --db $DB
# or: cmailer campaign list --stats --db $DB
```

```
ID                                   STATUS     MODE     QUEUED  SENT   FAILED RETRY  RATE     NAME
<campaign-id>                        draft      -        2       0      0      0      0.0%     Alumni Meet 2026
```

Two recipients queued, both `pending`, nothing sent. `suppressedCount` and
`duplicateCount` are running totals across every `campaign enqueue` call for
this campaign — not part of `totalQueued`, since neither ever reached the
queue: 1 suppressed (`optout@example.com`, step 6) from the first enqueue,
1 duplicate (`charlie@example.com` again) from the second.

---

## 9. Dispatch (send)

Dispatch works through the queue, sending one message at a time with a pause
between each. Use `--limit` to cap how many this run handles, so you can watch a
campaign resume where it left off. `--delay 0` removes the pause for the demo.
By default (`--transport local-file`), each message lands as a real file under
`--out-dir` (default `./data/outbox`) — set it alongside `--db` so this demo
stays out of the repo:

```bash
OUT="/tmp/cmailer-demo/outbox"
```

```bash
cmailer dispatch "$CID" --db $DB --out-dir $OUT --delay 0 --limit 1
```

```
Sending via local-file (/tmp/cmailer-demo/outbox)
[100%] sent     charlie@example.com
{
  "campaignId": "<campaign-id>",
  "status": "completed",
  "totalProcessed": 1,
  "sentCount": 1,
  "retriedCount": 0,
  "failedCount": 0,
  "durationMs": 1
}
```

One sent. `"status": "completed"` describes **this run**, not the whole campaign
— there is still a recipient waiting. Run it again with no limit to finish:

```bash
cmailer dispatch "$CID" --db $DB --out-dir $OUT --delay 0
```

```
Sending via local-file (/tmp/cmailer-demo/outbox)
[100%] sent     jane@example.com
{ "status": "completed", "totalProcessed": 1, "sentCount": 1, ... }
```

Dispatch picks up exactly where it stopped. Run it a third time and there is
nothing left to do:

```bash
cmailer dispatch "$CID" --db $DB --out-dir $OUT --delay 0
```

```
Sending via local-file (/tmp/cmailer-demo/outbox)
{ "status": "completed", "totalProcessed": 0, "sentCount": 0, ... }
```

Final stats — now the campaign itself is `completed` at `100.0%`:

```bash
cmailer campaign stats "$CID" --db $DB
```

```json
{
  "status": "completed",
  "totalQueued": 2,
  "sentCount": 2,
  "pendingCount": 0,
  "successRate": "100.0%"
}
```

### See what was actually written

`LocalFileTransport` writes one folder per message, plus an `index.ndjson`:

```bash
find $OUT -type f | sort
cat $OUT/*/subject.txt
```

Each message folder has `subject.txt`, `body.html`, `body.txt`, and
`envelope.json` (the `to`/`toName`/`subject`/`sentAt`). Open `body.html` in a
browser to see exactly what a recipient would have received.

### About pacing

`--delay 0` above is for your patience. The **default is 2,500 ms** between
messages — roughly 24 per minute, deliberately below Google Workspace's
throttling limits. Skipping the pause in production is how a sending domain gets
flagged. Set your own with `--delay <ms>`.

---

## 10. Manifest-driven sends & template check

A manifest file holds one or more presets. Each preset names a template
slug, a subject, and body files. `--config` points at the manifest.
`--preset` picks one preset from it. Use a manifest to send several similar
mailings (different ticket types, for example) without retyping the same
flags each time.

Create a manifest that points at the fixtures from step 4:

```bash
cat > /tmp/cmailer-demo/tickets.json <<'JSON'
{
  "speaker": {
    "name": "Speaker invite",
    "slug": "speaker-invite",
    "subject": "Invitation for {{ first_name | default('there') }}",
    "html": "body.html",
    "text": "body.txt"
  }
}
JSON
```

### Check a template before you send it

`template check` lists every placeholder in a template and marks which ones
have a default. Add `--csv` to also check that the CSV has a column for
every required placeholder.

```bash
cmailer template check --db $DB \
  --config /tmp/cmailer-demo/tickets.json --preset speaker \
  --csv /tmp/cmailer-demo/recipients.csv
```

```
Template: /tmp/cmailer-demo/body.html, /tmp/cmailer-demo/body.txt
Subject:  Invitation for {{ first_name | default('there') }}
Placeholders found (3):
  - event_name (required)
  - first_name (optional, default: "there")
  - grad_year (required)

CSV: /tmp/cmailer-demo/recipients.csv (5 columns: email, name, first_name, event_name, grad_year)

✓ Validation passed: All required template variables are present in CSV.
```

The CSV has a column for every required placeholder, so the check passes and
`cmailer template check` exits `0`.

### Send from a preset

`cmailer send --config <file> --preset <key>` reads the slug, subject, and
body files from the preset, then runs the same upsert → create → enqueue →
dispatch → stats flow as plain `cmailer send`:

```bash
cmailer send --db $DB \
  --config /tmp/cmailer-demo/tickets.json --preset speaker \
  --csv /tmp/cmailer-demo/recipients.csv --delay 0 --dry-run
```

```
1. Template upserted: <template-id>

2. Campaign created: <campaign-id>

3. Queued 2, duplicates 0, suppressed 1
Sending via mock (--dry-run)
[ 50%] sent     charlie@example.com
[100%] sent     jane@example.com

4. Report:
{
  "campaignId": "<campaign-id>",
  "status": "completed",
  "totalProcessed": 2,
  "sentCount": 2,
  "retriedCount": 0,
  "failedCount": 0,
  "durationMs": ...,
  "dryRun": true
}

5. Stats:
{ "campaignId": "<campaign-id>", "campaignName": "Speaker invite", "status": "completed", ... "successRate": "100.0%", ... }
```

`--dry-run` sends through the mock transport, so this run creates a real
campaign but sends nothing. Drop `--dry-run` to send for real, exactly like
plain `cmailer send`.

### Strict mode stops a bad CSV early

Point `send` at a CSV that is missing a required column:

```bash
cat > /tmp/cmailer-demo/bad-recipients.csv <<'EOF'
email,name,first_name,event_name
charlie@example.com,Charlie Brown,Charlie,CEGAANA Fall Event
EOF

cmailer send --db $DB \
  --config /tmp/cmailer-demo/tickets.json --preset speaker \
  --csv /tmp/cmailer-demo/bad-recipients.csv --strict --dry-run
```

```
Preflight check failed: Template requires variable(s) not found in CSV (/tmp/cmailer-demo/bad-recipients.csv): grad_year
Available CSV columns: email, name, first_name, event_name
```

`bad-recipients.csv` has no `grad_year` column, and the template needs one.
`--strict` stops `send` before it creates a campaign, and the command exits
`1`. Without `--strict`, `send` prints the same warning to the console and
continues — useful when the missing variable is expected, not a mistake.

---

## 11. Error handling

Bad input produces one plain sentence and a non-zero exit code — no stack
traces.

```bash
cmailer campaign create --db $DB --name X --subject Y --template does-not-exist
```

```
No template found for "does-not-exist"
```

```bash
cmailer dispatch not-a-real-campaign --db $DB
```

```
No campaign found with id "not-a-real-campaign"
```

Both exit `1`, so they fail loudly in a script (`echo $?` prints `1`).

---

## 12. Look underneath (optional)

Everything lives in one SQLite file, in tables prefixed `_mailer_` so the engine
can be embedded in an existing app's database without colliding with anything:

```bash
sqlite3 /tmp/cmailer-demo/mailer.db \
  "SELECT email, status, attempts FROM _mailer_queue;"

sqlite3 /tmp/cmailer-demo/mailer.db \
  "SELECT email, status, latency_ms, provider_message_id FROM _mailer_logs;"
```

The **queue** holds current state — one row per recipient. The **log** holds
history — one row per *attempt*, including failures.

---

## 13. Clean up

```bash
rm -rf /tmp/cmailer-demo
```

---

## Command reference

| Command | What it does |
| :--- | :--- |
| `cmailer --help` | Overview of all commands |
| `cmailer <cmd> --help` | Focused help for one command |
| `cmailer --version` | Installed version |
| `template create --slug --name --subject --html <file> --text <file>` | Create a new template |
| `template upsert --slug --name --subject --html <file> --text <file>` | Create or update a template by slug |
| `template preview <slug> [--data '<json>']` | Render a template without sending |
| `template check [--html <file> --text <file>] [--slug <slug>] [--config <file> --preset <key>] [--csv <file>]` | List a template's placeholders; with `--csv`, check every required one has a column |
| `template list` | List templates |
| `campaign create --name --subject --template <slug> [--scheduled-at <iso>]` | Create a campaign |
| `campaign enqueue <id> --csv <file>` | Load recipients into a campaign |
| `campaign stats [<id>]` | Delivery statistics (JSON for `<id>`, or tabular overview for all campaigns) |
| `campaign list [--stats]` | List campaigns with status and MODE (pass `--stats` for full delivery metrics table) |
| `dispatch <id> [--delay <ms>] [--limit <n>] [--transport <kind>] [--out-dir <path>] [--dry-run]` | Send queued messages |
| `send --name --subject --template <slug> [--html <file> --text <file>] --csv <file>` | Create + enqueue + dispatch + stats in one shot |
| `send [--config <file> --preset <key>] --csv <file> [--strict]` | Same, with template/subject/body resolved from a manifest preset |
| `suppression add <email> --reason <r>` | Add to the do-not-send list |
| `suppression list` | List suppressed addresses |
| `suppression stats` | Suppression counts, total and by reason (JSON) |
| `--db <path>` | (global) database file, default `./data/mailer.db` |
| `--transport <local-file\|google-workspace\|mock>` | (global) delivery transport, default `local-file` |
| `--out-dir <path>` | (global) output directory for `--transport local-file`, default `./data/outbox` |
| `--dry-run` | Route dispatch through `MockTransport` without sending or writing to disk |
| `--config <file>` | Read template slug, subject, and body file paths from a JSON manifest |
| `--preset <key>` (alias `--ticket-type`) | Pick one preset from `--config`'s manifest |
| `--template-dir <path>` | Base directory for a preset's `html`/`text` file paths, if not next to the manifest |
| `--strict` | On `send`, abort instead of warn when the CSV is missing a required placeholder |

---

## Notes & delivery transports

- **Delivery channels:** `dispatch` supports `LocalFileTransport` (default, writes
  inspected emails to `./data/outbox/`), `GoogleWorkspaceTransport` (real Gmail OAuth2
  SMTP delivery — see [`setup-google-workspace.md`](./setup-google-workspace.md)),
  and in-memory `MockTransport` via `--dry-run`.
- **Mode tracking:** All campaign listings (`cmailer campaign list`,
  `cmailer campaign stats`) clearly display whether each run was executed in `dry-run`
  or `live` mode.
- **Some designed behaviors have no CLI path** because triggering them means
  making a mail provider misbehave on cue: retry-after-transient-failure,
  give-up-after-max-attempts, rate-limit abort, crashed-worker recovery, and
  refusing to send a cancelled campaign. All five are covered by the automated
  tests — run them from the project root with `npm test`, and read
  `simple-mailer/tests/engine.test.ts` to see the behavior directly.

For the library (programmatic) API rather than the CLI, see
[`status-and-usage.md`](./status-and-usage.md) and the project `README.md`.
