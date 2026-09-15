#!/usr/bin/env node
import { parseArgs } from "node:util";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { openMailerDatabase, MailerEngine, SqliteProvider } from "@cegaana/simple-mailer";
import { selectTransport } from "./transport.js";
import { loadDotEnv } from "./env.js";
import { readVersion } from "./version.js";
import { OVERVIEW, HELP } from "./help.js";
import type { CliFlags } from "./flags.js";
import { campaignCreate, campaignEnqueue, campaignStats, campaignList } from "./commands/campaign.js";
import { templateCreate, templateUpsert, templatePreview, templateList, templateCheck } from "./commands/template.js";
import { suppressionAdd, suppressionList, suppressionStats } from "./commands/suppression.js";
import { dispatchCommand } from "./commands/dispatch.js";
import { sendCommand } from "./commands/send.js";

loadDotEnv();

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      db: { type: "string", default: "./data/mailer.db" },
      name: { type: "string" },
      subject: { type: "string" },
      template: { type: "string" },
      "template-name": { type: "string" },
      slug: { type: "string" },
      html: { type: "string" },
      text: { type: "string" },
      csv: { type: "string" },
      data: { type: "string" },
      reason: { type: "string" },
      delay: { type: "string" },
      limit: { type: "string" },
      "scheduled-at": { type: "string" },
      "dry-run": { type: "boolean", default: false },
      transport: { type: "string" },
      "out-dir": { type: "string" },
      "google-user": { type: "string" },
      "google-client-id": { type: "string" },
      "google-client-secret": { type: "string" },
      "google-refresh-token": { type: "string" },
      stats: { type: "boolean", default: false },
      config: { type: "string" },
      preset: { type: "string" },
      "ticket-type": { type: "string" },
      "template-dir": { type: "string" },
      strict: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "v", default: false },
    },
  }) as { values: CliFlags; positionals: string[] };

  const [command, ...rest] = positionals;

  // `--version` / `-v`
  if (values.version) {
    console.log(readVersion());
    return 0;
  }

  // `cmailer help [command]`
  if (command === "help") {
    const topic = rest[0];
    console.log(topic && HELP[topic] ? HELP[topic] : OVERVIEW);
    return 0;
  }

  // No command: show the overview.
  if (!command) {
    console.log(OVERVIEW);
    return 0;
  }

  // `--help` / `-h`: show command-specific help when a known command is named,
  // otherwise the overview.
  if (values.help) {
    console.log(HELP[command] ?? OVERVIEW);
    return 0;
  }

  const db = openMailerDatabase(values.db);
  const provider = new SqliteProvider(db);
  const { transport, description } = selectTransport(values);
  const engine = new MailerEngine(provider, { transport });

  // Only these commands take a subcommand; `dispatch <id>` and `send` must
  // not read their first positional/flag-only args as one.
  const GROUPED = new Set(["campaign", "template", "suppression"]);
  const key = GROUPED.has(command) ? `${command} ${rest[0] ?? ""}`.trim() : command;

  switch (key) {
    case "campaign create":
      return campaignCreate(engine, values);
    case "campaign enqueue":
      return campaignEnqueue(engine, values, rest);
    case "campaign stats":
      return campaignStats(engine, rest);
    case "campaign list":
      return campaignList(engine, values);

    case "dispatch":
      return dispatchCommand(engine, values, rest, description);

    case "send":
      return sendCommand(engine, values, description);

    case "template create":
      return templateCreate(engine, values);
    case "template upsert":
      return templateUpsert(engine, values);
    case "template preview":
      return templatePreview(engine, values, rest);
    case "template list":
      return templateList(engine);
    case "template check":
    case "template validate":
      return templateCheck(engine, values, rest);

    case "suppression add":
      return suppressionAdd(engine, values, rest);
    case "suppression list":
      return suppressionList(engine);
    case "suppression stats":
      return suppressionStats(engine);

    default:
      console.error(`Unknown command: ${command} ${rest[0] ?? ""}\n`);
      console.log(HELP[command] ?? OVERVIEW);
      return 1;
  }
}

// Only run when executed directly (as the bin entrypoint or via tsx), not
// when imported — e.g. by tests that import command handlers from this
// package's modules.
//
// Resolved through realpathSync because the installed `cmailer` command is a
// symlink (npm workspaces' node_modules/.bin, or `npm link`): Node reports
// import.meta.url as the *real* path of this file, while process.argv[1]
// stays the symlink path, so a naive comparison never matches and the CLI
// silently no-ops under its actual installed name.
function isMain(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
}

if (isMain()) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}
