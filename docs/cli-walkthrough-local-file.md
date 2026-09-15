# Simple Mailer — Local-File CLI Walkthrough

A guided tour of everything the engine can currently do, using the
**local-file transport** — the default, credential-free way to run `cmailer`
end to end with no Google Workspace setup. For someone who has just checked
out the branch and knows nothing about the codebase.

> Sending through an actual CEGAANA Google Workspace account instead? See the
> **[Google Workspace CLI Walkthrough](./cli-walkthrough-google-workspace.md)**
> and its companion **[setup guide](./setup-google-workspace.md)**.

Every command below is copy-pasteable as written. Run them in order.

---

## What this is

This repo is two packages: `simple-mailer`, a Node/TypeScript library that
sends bulk email — event invitations, campaign mailings, transactional
notices — and `cmailer`, the command-line front end this walkthrough uses. It
stores everything in one SQLite file. There is no server and no background
daemon: you run a command, it works through a queue, it stops.

Three ideas explain the whole tool:

- A **template** is the message — subject and body, with `{{ placeholders }}`
  for per-person details.
- A **campaign** is one send — a name, a subject line, and which template to use.
- The **queue** holds one row per recipient: *"send this campaign to this person,
  not done yet."*

Which gives you the two verbs:

| Verb | What it does |
| :--- | :--- |
| **enqueue** | Builds the list. Nothing is sent. |
| **dispatch** | Works through the list, sending one at a time with a pause between. |

It is a print queue. Enqueue is hitting Print; dispatch is the printer.

> **Nothing is actually emailed.** `cmailer` writes real files via
> `LocalFileTransport` by default — inspect them under `--out-dir`
> (default `./data/outbox`) — rather than sending over the network. Add
> `--dry-run` for a run that writes nothing at all. You can use real addresses
> safely either way.

---

## Prerequisites

- **Node 24 or newer** — check with `node -v`
- `sqlite3` on your PATH, for the optional section 7

Two syntax notes, because both will bite you:

- `npm run dev --` needs that trailing `--`, or npm swallows the flags.
- `--html` and `--text` take **file paths**, not text. Real HTML does not
  survive shell quoting.

---

## Setup

From a fresh clone of the repository:

```bash
npm install
npm run typecheck && npm test
```

Both must be clean — **99 tests passing** (75 in `simple-mailer`, 24 in
`cmailer`). If they are not, stop here; nothing below will mean anything.

---

## Fixtures

Two message bodies (every email carries both an HTML and a plain-text version)
and two recipient lists.

```bash
mkdir -p /tmp/cmailer-demo && cd /tmp/cmailer-demo

cat > body.html <<'EOF'
<p>Dear {{ first_name | default('Friend') }},</p>
<p>You are confirmed for {{ event_name }}, class of {{ grad_year }}.</p>
EOF

cat > body.txt <<'EOF'
Dear {{ first_name | default('Friend') }},

You are confirmed for {{ event_name }}, class of {{ grad_year }}.
EOF

cat > recipients.csv <<'EOF'
email,name,first_name,event_name,grad_year
charlie@example.com,Charlie Brown,Charlie,CEGAANA Fall Event,1988
jane@example.com,Jane Doe,Jane,CEGAANA Fall Event,1991
noname@example.com,,,CEGAANA Fall Event,2004
optout@example.com,Opt Out,Opt,CEGAANA Fall Event,1999
EOF

cat > dupes.csv <<'EOF'
email,name,first_name,event_name,grad_year
charlie@example.com,Charlie Brown,Charlie,CEGAANA Fall Event,1988
EOF
```

Then go back to the repository:

```bash
cd -
```

**About the CSV.** An `email` column is required. `name` is used if present.
**Every other column becomes a merge variable** — so `first_name`, `event_name`
and `grad_year` are what fill the `{{ }}` slots. The third row deliberately has
no name and no first name, to exercise the missing-data path.

**About `--db`.** Every command below writes to
`/tmp/cmailer-demo/mailer.db` so this walkthrough never touches the
repository's own `./data/mailer.db`. The file is created for you.

---

## 1. Templates

Create one:

```bash
npm run dev --workspace cmailer -- --db /tmp/cmailer-demo/mailer.db template create \
  --slug speaker-invite \
  --name "Speaker invite" \
  --subject "Invitation for {{ first_name }}" \
  --html /tmp/cmailer-demo/body.html \
  --text /tmp/cmailer-demo/body.txt
```

Prints a generated id. Templates are stored once and reused across campaigns.

```bash
npm run dev --workspace cmailer -- --db /tmp/cmailer-demo/mailer.db template list
```

```
SLUG                         NAME
speaker-invite               Speaker invite
```

### Preview before sending anything

```bash
npm run dev --workspace cmailer -- --db /tmp/cmailer-demo/mailer.db template preview speaker-invite \
  --data '{"first_name":"Charlie","event_name":"CEGAANA Fall Event","grad_year":1988}'
```

```
Subject: Invitation for Charlie

--- text ---
Dear Charlie,

You are confirmed for CEGAANA Fall Event, class of 1988.

--- html ---
<p>Dear Charlie,</p>
<p>You are confirmed for CEGAANA Fall Event, class of 1988.</p>
```

This renders without sending — how you check a message before committing to
2,000 of them. Note `grad_year` is a JSON **number**, not a string: merge data
from a spreadsheet is not all strings, and the renderer handles that.

Now the same template with nothing to fill it:

```bash
npm run dev --workspace cmailer -- --db /tmp/cmailer-demo/mailer.db template preview speaker-invite \
  --data '{}'
```

```
Missing template variable "first_name" and no default was given
```

`preview` renders **strictly**: a `{{ variable }}` with no value and no
`| default(...)` throws instead of silently sending a blank. This template's
subject is `Invitation for {{ first_name }}` (no default) and its body also
uses undefaulted `{{ event_name }}` / `{{ grad_year }}` — only the body's own
`{{ first_name | default('Friend') }}` has a fallback. Every one of the three
needs a real value before `preview` will render at all, exactly as the full
`--data` above did.

---

## 2. Opt-outs

```bash
npm run dev --workspace cmailer -- --db /tmp/cmailer-demo/mailer.db suppression add \
  optout@example.com --reason unsubscribe
```

```bash
npm run dev --workspace cmailer -- --db /tmp/cmailer-demo/mailer.db suppression list
```

```bash
npm run dev --workspace cmailer -- --db /tmp/cmailer-demo/mailer.db suppression stats
```

```json
{ "total": 1, "byReason": { "unsubscribe": 1 } }
```

The suppression list is **global** — an address on it is never emailed by any
campaign. Adding it now matters for the next step.

---

## 3. Building the list

Create a campaign. It prints an id, which the rest of the walkthrough needs, so
capture it in a shell variable:

```bash
CID=$(npm run dev --workspace cmailer --silent -- --db /tmp/cmailer-demo/mailer.db campaign create \
  --name "Alumni Meet 2026" \
  --subject "Speaker briefing for {{ first_name }}" \
  --template speaker-invite)

echo $CID
```

> If `echo $CID` shows anything other than a bare id, drop `--silent`, run the
> command on its own, and copy the id by hand:
> `CID=paste-the-id-here`

```bash
npm run dev --workspace cmailer -- --db /tmp/cmailer-demo/mailer.db campaign list
```

```
ID                                   STATUS     MODE     NAME
<campaign-id>                        draft      -        Alumni Meet 2026
```

A new campaign is `draft` and its mode is `-` (not yet run). Note it has its **own** subject line, separate from
the template's — the campaign's is the one that gets sent.

### Enqueue

```bash
npm run dev --workspace cmailer -- --db /tmp/cmailer-demo/mailer.db campaign enqueue $CID \
  --csv /tmp/cmailer-demo/recipients.csv
```

```
queued 3, duplicates 0, suppressed 1
```

Four rows in, three queued. `optout@example.com` was filtered because of step 2
— suppression is applied when the list is **built**, not when it is sent.

### Enqueue the same person again

```bash
npm run dev --workspace cmailer -- --db /tmp/cmailer-demo/mailer.db campaign enqueue $CID \
  --csv /tmp/cmailer-demo/dupes.csv
```

```
queued 0, duplicates 1, suppressed 0
```

Counted, not duplicated. This matters in practice: people re-run an import after
fixing one row, and nobody should receive two copies.

```bash
npm run dev --workspace cmailer -- --db /tmp/cmailer-demo/mailer.db campaign stats $CID
```

`totalQueued: 3`, all `pending`. Nothing has been sent yet. The stats also
carry `suppressedCount: 1` and `duplicateCount: 1` — running totals across
every `campaign enqueue` call for this campaign (the opt-out from step 2, and
the repeated `charlie@example.com` from the dupes list above); neither counts
toward `totalQueued` since neither ever reached the queue.

---

## 4. Sending

By default `dispatch` writes to `./data/outbox`; point `--out-dir` at the demo
folder to keep this walkthrough self-contained:

```bash
npm run dev --workspace cmailer -- --db /tmp/cmailer-demo/mailer.db \
  --out-dir /tmp/cmailer-demo/outbox dispatch $CID --delay 0 --limit 2
```

```
Sending via local-file (/tmp/cmailer-demo/outbox)
[ 50%] sent     charlie@example.com
[100%] sent     jane@example.com
{ "status": "completed", "totalProcessed": 2, "sentCount": 2, ... }
```

`--limit 2` caps how many this run handles, so you can watch it resume. Each
send wrote a folder under `/tmp/cmailer-demo/outbox/` — `ls` it, or open one of
its `body.html` files in a browser to see exactly what would have been sent.

```bash
npm run dev --workspace cmailer -- --db /tmp/cmailer-demo/mailer.db campaign stats $CID
```

Status is now `running` — 2 sent, 1 still pending. Note it is **not** `paused`:
hitting a batch limit is normal progress. `paused` is reserved for a real
problem, like a provider rate limit.

```bash
npm run dev --workspace cmailer -- --db /tmp/cmailer-demo/mailer.db \
  --out-dir /tmp/cmailer-demo/outbox dispatch $CID --delay 0
```

Picks up exactly where it stopped.

```bash
npm run dev --workspace cmailer -- --db /tmp/cmailer-demo/mailer.db campaign stats $CID
```

Now `completed`, `100.0%`.

You can also see the overview across all campaigns:

```bash
npm run dev --workspace cmailer -- --db /tmp/cmailer-demo/mailer.db campaign stats
# or: campaign list --stats
```

```
ID                                   STATUS     MODE     QUEUED  SENT   FAILED RETRY  RATE     NAME
<campaign-id>                        completed  live     3       3      0      0      100.0%   Alumni Meet 2026
```

### About the pacing

`--delay 0` above is for your patience. The **default is 2,500 ms** between
messages — roughly 24 per minute, deliberately below Google Workspace's
throttling limits. Skipping the pause is how a sending domain gets flagged.

---

## 5. Scheduling

A campaign can be told not to send before a given time:

```bash
SID=$(npm run dev --workspace cmailer --silent -- --db /tmp/cmailer-demo/mailer.db campaign create \
  --name "Next week" \
  --subject "Later" \
  --template speaker-invite \
  --scheduled-at 2027-01-01T09:00:00.000Z)

npm run dev --workspace cmailer -- --db /tmp/cmailer-demo/mailer.db campaign enqueue $SID \
  --csv /tmp/cmailer-demo/dupes.csv
```

```
queued 1, duplicates 0, suppressed 0
```

```bash
npm run dev --workspace cmailer -- --db /tmp/cmailer-demo/mailer.db dispatch $SID --delay 0
```

```
Sending via local-file (./data/outbox)
{ "status": "completed", "totalProcessed": 0, ... }
```

Queued but not due, so dispatch correctly does nothing. Internally, "wait until
the scheduled date" and "wait before retrying a failure" are the same
mechanism — one timestamp per job.

---

## 6. Error handling

```bash
npm run dev --workspace cmailer -- --db /tmp/cmailer-demo/mailer.db campaign create \
  --name X --subject Y --template does-not-exist
```

```
No template found for "does-not-exist"
```

```bash
npm run dev --workspace cmailer -- --db /tmp/cmailer-demo/mailer.db dispatch not-a-campaign
```

```
No campaign found with id "not-a-campaign"
```

Both print one plain sentence and exit `1` — no stack traces.

---

## 7. Looking underneath (optional)

```bash
sqlite3 /tmp/cmailer-demo/mailer.db \
  "SELECT email, status, attempts FROM _mailer_queue;"
```

```bash
sqlite3 /tmp/cmailer-demo/mailer.db \
  "SELECT email, status, latency_ms, provider_message_id FROM _mailer_logs;"
```

The **queue** holds current state — one row per recipient. The **log** holds
history — one row per *attempt*, including failures. A recipient who failed
twice and then succeeded is one queue row and three log rows.

Every table is prefixed `_mailer_`, so the engine can be embedded in an existing
application's database without colliding with anything already there.

---

## 8. Starting over

```bash
rm -rf /tmp/cmailer-demo
```

---

## What you cannot exercise from the CLI

Five behaviours are built and tested but have no command, because triggering
them means making a mail provider misbehave on cue — and the CLI has no flag for
that:

- retrying a temporary failure after a growing delay
- giving up after three attempts and marking the recipient `failed`
- hitting a provider rate limit, which aborts the run and pauses the campaign
- recovering messages stranded by a crashed process
- refusing to send a cancelled campaign

All five are covered by the test suite:

```bash
npm test
```

`simple-mailer/tests/engine.test.ts` is the readable one if you would rather
see the behaviour than take this document's word for it.

---

## Known gaps

- **Commands described in the PRD but not built:** `campaign cancel` / `pause` /
  `resume`, `suppression remove`.
- **No schema migrations.** Changing a table will not update databases that
  already exist.

Real network delivery is built — see the
**[Google Workspace CLI Walkthrough](./cli-walkthrough-google-workspace.md)**
for sending through a real Gmail account instead of `LocalFileTransport`.

Sending the same kind of mailing repeatedly (different ticket types, say)?
`cmailer send --config <file> --preset <key>` and `cmailer template check`
read the template slug, subject, and body files from a manifest instead of
flags typed by hand — see step 10 of the
**[CLI Testing Guide](./cli-testing-guide.md#10-manifest-driven-sends--template-check)**.

See [`build-roadmap.md`](./build-roadmap.md) for the full picture and
[`status-and-usage.md`](./status-and-usage.md) for the library API.
