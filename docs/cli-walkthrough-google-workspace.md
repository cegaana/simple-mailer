# Simple Mailer — Google Workspace CLI Walkthrough

The same tour as the **[Local-File CLI Walkthrough](./cli-walkthrough-local-file.md)**,
except `dispatch` sends real email through a CEGAANA Google Workspace mailbox
instead of writing to a local folder. Read that walkthrough first if you
haven't — templates, campaigns, suppression, and the queue all work
identically here; this doc only covers what's different.

> ⚠️ **This sends real email.** Every recipient in this walkthrough should be
> an address you personally control. Do not run this against real CEGAANA
> contact lists as a test.

---

## Prerequisites

- Everything from the [Local-File Walkthrough](./cli-walkthrough-local-file.md)'s
  own prerequisites (Node 24+, `npm install`, `npm run build`).
- A working `.env.local` (symlinked to `.env`) with all four
  `MAILER_GOOGLE_*` values — see **[Google Workspace Setup](./setup-google-workspace.md)**
  if you haven't done this yet. This walkthrough assumes it's already done and
  verified.

---

## 1. Fixtures

Same shape as the local-file walkthrough, but point the recipient list at
addresses **you actually control** — this is going to send:

```bash
mkdir -p /tmp/cmailer-gw-demo && cd /tmp/cmailer-gw-demo

cat > body.html <<'EOF'
<p>Dear {{ first_name | default('there') }},</p>
<p>This is a test send from the <code>cmailer</code> Google Workspace walkthrough.</p>
EOF

cat > body.txt <<'EOF'
Dear {{ first_name | default('there') }},

This is a test send from the cmailer Google Workspace walkthrough.
EOF

# Replace with 1-2 addresses you own. Do not use real contact data here.
cat > recipients.csv <<'EOF'
email,name,first_name
you@example.com,Your Name,Your
EOF
```

```bash
cd -
```

---

## 2. Template, campaign, enqueue

Identical to the local-file walkthrough — nothing about template rendering,
campaign creation, or the queue depends on which transport you'll dispatch
with:

```bash
cmailer template create --db /tmp/cmailer-gw-demo/mailer.db \
  --slug gw-setup-check \
  --name "Google Workspace setup check" \
  --subject "cmailer test send — {{ first_name }}" \
  --html /tmp/cmailer-gw-demo/body.html \
  --text /tmp/cmailer-gw-demo/body.txt

CID=$(cmailer campaign create --db /tmp/cmailer-gw-demo/mailer.db \
  --name "GW setup check" \
  --subject "cmailer test send — {{ first_name }}" \
  --template gw-setup-check)

cmailer campaign enqueue "$CID" --db /tmp/cmailer-gw-demo/mailer.db \
  --csv /tmp/cmailer-gw-demo/recipients.csv
```

---

## 3. Sending — the one different step

```bash
cmailer dispatch "$CID" --db /tmp/cmailer-gw-demo/mailer.db \
  --transport google-workspace
```

```
Sending via google-workspace (events@cegaana.org)
[100%] sent     you@example.com
{
  "campaignId": "<campaign-id>",
  "status": "completed",
  "totalProcessed": 1,
  "sentCount": 1,
  "retriedCount": 0,
  "failedCount": 0,
  "durationMs": ...
}
```

Check the delivery statistics and verify mode:

```bash
cmailer campaign stats "$CID" --db /tmp/cmailer-gw-demo/mailer.db
```

```json
{
  "campaignId": "<campaign-id>",
  "campaignName": "GW setup check",
  "status": "completed",
  "isDryRun": false,
  "mode": "live",
  "totalQueued": 1,
  "sentCount": 1,
  "retryingCount": 0,
  "failedCount": 0,
  "pendingCount": 0,
  "processingCount": 0,
  "cancelledCount": 0,
  "successRate": "100.0%"
}
```

Or view the stats overview across all campaigns:

```bash
cmailer campaign stats --db /tmp/cmailer-gw-demo/mailer.db
# or: cmailer campaign list --stats
```

```
ID                                   STATUS     MODE     QUEUED  SENT   FAILED RETRY  RATE     NAME
<campaign-id>                        completed  live     1       1      0      0      100.0%   GW setup check
```

Check the recipient's inbox (and spam folder — a brand-new sending setup has
no reputation yet). If your `.env`/`.env.local` is set up, you don't need
`--transport google-workspace` explicitly — it's only shown here for clarity;
omitting it sends through whatever `MAILER_TRANSPORT` says, and defaults to
`local-file` if that's unset too.

`--dry-run` still works exactly as in the local-file walkthrough — it forces
the in-memory mock transport regardless of `--transport`, so you can rehearse
a run (rendering, pacing, retry logic) without sending anything, Google
Workspace or otherwise. Runs dispatched with `--dry-run` report `MODE` as `dry-run`.

### About pacing and quota

The default 2,500 ms delay between sends (`--delay <ms>` to change it) exists
specifically to stay under Google Workspace's outbound sending limits.
Workspace accounts are typically capped around 2,000 recipients/day
(exact limits depend on your Workspace edition and account age) — this is a
per-mailbox limit set by Google, not something `cmailer` can raise. Hitting it
mid-campaign aborts the run and pauses the campaign — see Troubleshooting.

---

## 4. Troubleshooting real send failures

Unlike the local-file transport, a real send can fail for reasons outside
`cmailer`'s control. `GoogleWorkspaceTransport` maps every failure onto the
same four outcomes the engine already knows how to handle (§7) — you'll see
these in `campaign stats` and in the `dispatch` JSON report:

| Symptom | Likely cause | What to do |
| :--- | :--- | :--- |
| Every send `retrying`/`failed` immediately, error mentions `invalid_grant` or `Username and Password not accepted` | Refresh token expired, revoked, or credentials wrong | Redo [Setup](./setup-google-workspace.md) §2 (get a new refresh token) |
| Run aborts, `"status": "aborted"`, campaign `paused`, error mentions "sending limit" / "too quickly" | Gmail's own rate limiting or daily quota | Wait (quota resets daily), or increase `--delay`; do not retry immediately in a loop |
| One recipient `failed`, error like "email account ... does not exist" | Bad recipient address (permanent failure — not retried) | Fix the address; this is the queue behaving correctly, not a bug |
| Works from your machine, fails from CI/another machine with "not authorized" | Workspace admin restricts OAuth app access by network/device policy | Check Admin console → Security → API controls with your Workspace admin |

For anything not covered here, `cmailer suppression list` and
`cmailer campaign stats <id>` are your first two commands — the error message
in `_mailer_logs`/the dispatch report is always the transport's real error
text, not a `cmailer`-invented one.

---

## 5. For a recurring mailing: `cmailer send`

Steps 2–3 above (template, campaign, enqueue, dispatch) are what
`cmailer send` does in one call — useful once you're sending the same kind of
message repeatedly (an event confirmation, say) and don't want four separate
commands each time:

```bash
cmailer send --db /tmp/cmailer-gw-demo/mailer.db \
  --name "GW setup check" --subject "cmailer test send — {{ first_name }}" \
  --template gw-setup-check --html /tmp/cmailer-gw-demo/body.html --text /tmp/cmailer-gw-demo/body.txt \
  --csv /tmp/cmailer-gw-demo/recipients.csv --transport google-workspace
```

`--html`/`--text` upsert the template at `--template`'s slug first (safe to
re-run after editing those files — see `cmailer help template`); omit both to
send an existing template unchanged. If you send several variants of a
mailing (different ticket types, different audiences), the mapping from a
short name to the right `--template`/`--subject`/`--html`/`--text`/`--csv`
combination belongs in your own thin wrapper script, not in `cmailer` itself
— `cmailer send` is the primitive that script should call.

---

## 6. Cleaning up

```bash
rm -rf /tmp/cmailer-gw-demo
```

Nothing about `_mailer_*` tables or the OAuth setup itself needs cleanup —
the `.env.local` credentials are reusable across runs and campaigns.
