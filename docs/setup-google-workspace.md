# Google Workspace Setup — `cmailer --transport google-workspace`

One-time setup to let `cmailer` send real email through a CEGAANA Google
Workspace account (`events@cegaana.org` or similar), via Gmail's OAuth2 SMTP
support. Do this once per sending account; the result is a `.env.local` file
you keep locally and never commit.

> **New here?** Get comfortable with `cmailer` using the
> **[Local-File CLI Walkthrough](./cli-walkthrough-local-file.md)** first — it
> needs none of this and exercises every other feature. Come back here when
> you're ready to send for real, then continue with the
> **[Google Workspace CLI Walkthrough](./cli-walkthrough-google-workspace.md)**.

---

## What you're setting up

`GoogleWorkspaceTransport` authenticates as a specific Workspace mailbox using
OAuth2 (never a plain password) and sends through Gmail's SMTP endpoint. You
need four values, all four required together:

| Env var | What it is |
| :--- | :--- |
| `MAILER_GOOGLE_USER_EMAIL` | The Workspace mailbox `cmailer` sends as, e.g. `events@cegaana.org` |
| `MAILER_GOOGLE_CLIENT_ID` | OAuth2 client id (from a Google Cloud project) |
| `MAILER_GOOGLE_CLIENT_SECRET` | OAuth2 client secret (same project) |
| `MAILER_GOOGLE_REFRESH_TOKEN` | A refresh token authorizing that client to send as that mailbox |

Each also has a `--google-user` / `--google-client-id` / `--google-client-secret`
/ `--google-refresh-token` CLI flag that overrides the env var, for one-off
use or scripting — but the env-var + `.env.local` path below is the
recommended one, since it keeps secrets out of shell history and process
listings.

---

## 1. Create a Google Cloud OAuth2 client

You need a Google Cloud project with an OAuth2 client — this is what proves
"this is `cmailer`, requesting access to this mailbox," independent of any
individual user's password.

1. Go to [console.cloud.google.com](https://console.cloud.google.com/) and
   select or create a project. (If CEGAANA already has a Google Cloud project
   tied to the Workspace org, ask whoever administers it whether to use that
   one instead of creating a new one — a shared project is usually preferable
   to one-off personal projects for anything sending on behalf of the org.)
2. **APIs & Services → OAuth consent screen.** Choose **Internal** if this
   Google Cloud project is inside the same Google Workspace organization as
   the sending mailbox (simplest — no external review, no publishing step);
   otherwise **External** and add the sending account as a test user while
   the app is unpublished.
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID.**
   Application type **Web application**. Under **Authorized redirect URIs**, click
   **+ ADD URI** and add:
   ```
   https://developers.google.com/oauthplayground
   ```
   (This is required by Google OAuth Playground for the token exchange in step 2;
   without it Google rejects the request with `Error 400: redirect_uri_mismatch`).
   Note the generated **Client ID** and **Client secret**.
4. You do **not** need to separately enable the "Gmail API" for SMTP OAuth2 —
   `GoogleWorkspaceTransport` authenticates SMTP, not the Gmail REST API.

---

## 2. Obtain a refresh token

The refresh token is what lets `cmailer` get new access tokens indefinitely
without a human present. The simplest way to get one for a CLI tool is
Google's OAuth 2.0 Playground, authorizing *as the sending mailbox* — sign
into `events@cegaana.org` (or whichever account will send) in the browser
before doing this, not your personal account.

1. Open [developers.google.com/oauthplayground](https://developers.google.com/oauthplayground/).
2. Click the gear icon (top right) → check **"Use your own OAuth credentials"**
   → paste in the **Client ID** and **Client secret** from step 1.
3. In the left panel, under **Input your own scopes**, enter:
   ```
   https://mail.google.com/
   ```
   Click **Authorize APIs**, sign in as the sending mailbox, and accept.
4. Back on the Playground, click **Exchange authorization code for tokens**.
5. Copy the **Refresh token** shown — this is `MAILER_GOOGLE_REFRESH_TOKEN`.
   (Ignore the access token; `GoogleWorkspaceTransport` gets fresh ones itself.)

A refresh token obtained this way does not expire from age alone, but stops
working if: the mailbox's password is changed, the OAuth client is deleted,
the mailbox owner revokes access (Google Account → Security → Third-party
access), or — for an **Internal** consent screen — a Workspace admin disables
third-party app access org-wide (Admin console → Security → API controls).
If sends start failing with `invalid_grant`, start over from this step.

---

## 3. Fill in `.env.local`

From the repository root:

```bash
cp .env.example .env.local
```

Edit `.env.local` and fill in the four values from steps 1–2:

```bash
MAILER_GOOGLE_USER_EMAIL=events@cegaana.org
MAILER_GOOGLE_CLIENT_ID=123456789-abc...apps.googleusercontent.com
MAILER_GOOGLE_CLIENT_SECRET=GOCSPX-...
MAILER_GOOGLE_REFRESH_TOKEN=1//0g...
```

Then symlink `.env` to it, so `cmailer`'s loader (`cmailer/src/env.ts`) picks
it up automatically — it also reads `.env.local` directly if `.env` doesn't
exist, so this step is a convenience, not a requirement:

```bash
ln -s .env.local .env
```

Both `.env` and `.env.local` are gitignored at the repository root — `git
status` should show neither as trackable. **Never commit either file** or
paste their contents anywhere outside your own machine; the refresh token is
equivalent to a password for that mailbox.

---

## 4. Verify it works

A `--dry-run` won't touch this at all — it always routes through the mock
transport regardless of `--transport`. To actually verify the credentials,
send a real message to an address you control:

```bash
cmailer template create --slug setup-check --name "Setup check" \
  --subject "cmailer Google Workspace setup check" \
  --html body.html --text body.txt   # any short test bodies

CID=$(cmailer campaign create --name "Setup check" \
  --subject "cmailer Google Workspace setup check" --template setup-check)

echo "email
you@example.com" > me.csv   # replace with an address you control

cmailer campaign enqueue "$CID" --csv me.csv
cmailer dispatch "$CID" --transport google-workspace
```

`"status": "completed"` with `"sentCount": 1` and an email actually arriving
means it worked. See the
**[Google Workspace CLI Walkthrough](./cli-walkthrough-google-workspace.md)**
for the full feature tour, and its troubleshooting section for what specific
failures (`invalid_grant`, `rate_limited`, etc.) mean.

---

## Rotating or revoking

- **Rotate the refresh token:** repeat step 2 (Playground exchange) and
  update `.env.local` — no code change needed.
- **Revoke access entirely:** the mailbox owner can remove it from
  [myaccount.google.com/permissions](https://myaccount.google.com/permissions),
  or a Workspace admin can block the OAuth client org-wide from the Admin
  console. Either immediately breaks `--transport google-workspace` until a
  new refresh token is issued.
