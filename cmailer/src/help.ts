/** Top-level help, shown for `cmailer`, `cmailer --help`, or `help`. */
export const OVERVIEW = `cmailer — CEGAANA mail CLI, built on simple-mailer

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

Run "cmailer <command> --help" for detailed help on a command.`;

const GOOGLE_WORKSPACE_OPTIONS = `  --google-user <email>        Sending account (--transport google-workspace)
  --google-client-id <id>      OAuth2 client id (--transport google-workspace)
  --google-client-secret <s>   OAuth2 client secret (--transport google-workspace)
  --google-refresh-token <t>   OAuth2 refresh token (--transport google-workspace)

  The four --google-* options each fall back to an env var when omitted
  (MAILER_GOOGLE_USER_EMAIL, _CLIENT_ID, _CLIENT_SECRET, _REFRESH_TOKEN) —
  see docs/setup-google-workspace.md.`;

/** Per-command help, keyed by the top-level command. */
export const HELP: Record<string, string> = {
  campaign: `cmailer campaign — manage email campaigns

Usage
  cmailer campaign create   --name <name> --subject <subject> --template <slug> [--scheduled-at <iso>]
  cmailer campaign enqueue  <campaign-id> --csv <file>
  cmailer campaign stats    [<campaign-id>]
  cmailer campaign list     [--stats]

Subcommands
  create    Create a campaign that sends the given template. Prints the new campaign id.
  enqueue   Add recipients from a CSV file. The CSV must have an "email" column; an
            optional "name" column is used for personalization and any other columns
            are stored as per-recipient metadata. Reports queued, duplicate, and
            suppressed counts.
  stats     Print delivery statistics for a campaign (or for all campaigns if omitted).
  list      List all campaigns with their id, status, and name (pass --stats for full metrics).

Options
  --name <name>          Campaign name (create)
  --subject <subject>    Default subject line (create)
  --template <slug>      Template slug to send (create)
  --scheduled-at <iso>   ISO timestamp to schedule the campaign (create, optional)
  --csv <file>           Path to the recipients CSV (enqueue)
  --stats                Show delivery statistics for all listed campaigns (list)
  --db <path>            Database file (default ./data/mailer.db)

See also: "cmailer send" combines create + enqueue + dispatch + stats.`,

  dispatch: `cmailer dispatch — send a campaign's queued messages

Usage
  cmailer dispatch <campaign-id> [--dry-run] [--delay <ms>] [--limit <n>]

Description
  Works through a campaign's queued recipients, sending each one and printing live
  progress. Exits with a non-zero status if the run is aborted (e.g. by a provider
  rate limit).

Options
  --dry-run                    Route this run through the mock transport instead of
                                --transport, so nothing is written or sent
  --delay <ms>                 Delay in milliseconds between each message (rate pacing)
  --limit <n>                  Send at most <n> messages in this run
  --db <path>                  Database file (default ./data/mailer.db)
  --transport <kind>           Delivery transport: "local-file" (default), "mock", or
                                "google-workspace"
  --out-dir <path>             Output directory for --transport local-file (default ./data/outbox)
${GOOGLE_WORKSPACE_OPTIONS}`,

  send: `cmailer send — create a campaign, enqueue, dispatch, and print stats

Usage
  cmailer send --name <name> --subject <subject> --template <slug> --csv <file>
               [--html <file> --text <file>] [--template-name <name>]
               [--scheduled-at <iso>] [--delay <ms>] [--limit <n>] [--dry-run]
  cmailer send --config <manifest.json> [--preset <key>] --csv <file>
               [--strict] [--dry-run]

Description
  The one-shot version of "campaign create" + "campaign enqueue" + "dispatch" +
  "campaign stats" — for the common case of sending a fresh campaign start to
  finish without inspecting state in between. Prints each step's output in
  sequence (template upsert id if applicable, campaign id, enqueue counts,
  dispatch report, final stats), and exits non-zero if the dispatch aborts.

  Pass --html and --text together to upsert the template at --template's slug
  first (creating it if new, overwriting its content if not) before sending —
  omit both to send an existing template unchanged.

  Or pass --config <manifest.json> [--preset <key>] to load template slug, display
  name, subject line, and body file paths from a central configuration file.

Options
  --config <file>               Path to campaign manifest / tickets JSON config
  --preset <key>                Preset name to select from manifest (alias: --ticket-type)
  --ticket-type <key>           Alias for --preset
  --template-dir <dir>          Base directory for template body files (optional override)
  --name <name>                 Campaign name, and the template's display name
                                 when upserting (unless --template-name is given)
  --subject <subject>           Subject line — used for the campaign, and for the
                                 template too when upserting
  --template <slug>             Template slug — referenced as-is, or upserted
                                 when --html/--text are given
  --template-name <name>        Template's display name when upserting (default: --name)
  --html <file>                 Path to the HTML body file (upserts the template; requires --text)
  --text <file>                 Path to the plain-text body file (upserts the template; requires --html)
  --csv <file>                  Path to the recipients CSV
  --strict                      Preflight check: abort if CSV is missing required template variables
  --scheduled-at <iso>          ISO timestamp to schedule the campaign, optional
  --delay <ms>                  Delay in milliseconds between each message (rate pacing)
  --limit <n>                   Send at most <n> messages in this run
  --dry-run                     Route dispatch through the mock transport; nothing written or sent
  --db <path>                   Database file (default ./data/mailer.db)
  --transport <kind>            Delivery transport: "local-file" (default), "mock", or
                                 "google-workspace"
  --out-dir <path>              Output directory for --transport local-file (default ./data/outbox)
${GOOGLE_WORKSPACE_OPTIONS}`,

  template: `cmailer template — manage email templates

Usage
  cmailer template create   --slug <slug> --name <name> --subject <subject> --html <file> --text <file>
  cmailer template upsert   --slug <slug> --name <name> --subject <subject> --html <file> --text <file>
  cmailer template check    [--slug <slug>] [--html <file> --text <file>] [--config <file>] [--csv <file>]
  cmailer template preview  <slug> [--data '<json>']
  cmailer template list

Subcommands
  create    Create a template from HTML and plain-text body files. Fails if the
            slug already exists. Prints the new template id.
  upsert    Like create, but overwrites an existing template's content instead of
            failing if the slug already exists — safe to re-run after editing the
            HTML/text files. Prints the template id either way.
  check     Preflight check: validates template syntax and ensures all required
            placeholders exist in the provided CSV file (alias: template validate).
  preview   Render a template with optional JSON data and print the result.
  list      List all templates with their slug and name.

Options
  --slug <slug>        Unique template slug (create, upsert, check)
  --name <name>        Human-readable template name (create, upsert)
  --subject <subject>  Subject line, may contain template variables (create, upsert)
  --html <file>        Path to the HTML body file (create, upsert, check)
  --text <file>        Path to the plain-text body file (create, upsert, check)
  --config <file>      Path to JSON config mapping presets to template files (check)
  --preset <key>       Preset key from config (check, alias: --ticket-type)
  --csv <file>         Recipients CSV to validate against required placeholders (check)
  --data '<json>'      JSON object of variables to render with (preview, optional)
  --db <path>          Database file (default ./data/mailer.db)`,

  suppression: `cmailer suppression — manage the do-not-send list

Usage
  cmailer suppression add    <email> --reason <reason>
  cmailer suppression list
  cmailer suppression stats

Subcommands
  add     Add an email address to the suppression list so it is skipped on enqueue.
  list    List suppressed addresses with their reason and date.
  stats   Print JSON counts of the suppression list, total and by reason.

Options
  --reason <reason>   Why the address is suppressed (add, default "manual")
  --db <path>         Database file (default ./data/mailer.db)`,
};
