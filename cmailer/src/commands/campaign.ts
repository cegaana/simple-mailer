import type { MailerEngine } from "@cegaana/simple-mailer";
import type { CliFlags } from "../flags.js";
import { need } from "../flags.js";
import { readCsv } from "../csv.js";
import { printTable } from "../table.js";

/** `cmailer campaign create --name --subject --template [--scheduled-at]` */
export async function campaignCreate(engine: MailerEngine, values: CliFlags): Promise<number> {
  const id = await engine.createCampaign({
    name: need(values.name, "name"),
    subject: need(values.subject, "subject"),
    templateId: need(values.template, "template"),
    ...(values["scheduled-at"] ? { scheduledAt: values["scheduled-at"] } : {}),
  });
  console.log(id);
  return 0;
}

/** `cmailer campaign enqueue <campaign-id> --csv <file>` */
export async function campaignEnqueue(engine: MailerEngine, values: CliFlags, rest: string[]): Promise<number> {
  const campaignId = need(rest[1], "campaign-id");
  const result = await engine.enqueueRecipients(campaignId, readCsv(need(values.csv, "csv")));
  console.log(`queued ${result.queuedCount}, duplicates ${result.duplicateCount}, suppressed ${result.suppressedCount}`);
  return 0;
}

/** `cmailer campaign stats [<campaign-id>]` */
export async function campaignStats(engine: MailerEngine, rest: string[]): Promise<number> {
  const campaignId = rest[1];
  if (campaignId) {
    console.log(JSON.stringify(await engine.getCampaignStats(campaignId), null, 2));
    return 0;
  }
  return campaignStatsList(engine);
}

/** `cmailer campaign list [--stats]` */
export async function campaignList(engine: MailerEngine, values?: CliFlags): Promise<number> {
  if (values?.stats) {
    return campaignStatsList(engine);
  }
  const campaigns = await engine.listCampaigns();
  const rows: string[][] = [];
  for (const c of campaigns) {
    const s = await engine.getCampaignStats(c.id);
    const mode = s.mode === "dry-run" ? "dry-run" : s.mode === "live" ? "live" : "-";
    rows.push([c.id, c.status, mode, c.name]);
  }
  printTable(
    [
      { header: "ID", width: 36 },
      { header: "STATUS", width: 10 },
      { header: "MODE", width: 8 },
      { header: "NAME" },
    ],
    rows,
  );
  return 0;
}

/** Prints a tabular summary of delivery statistics for all campaigns, one row per campaign. */
export async function campaignStatsList(engine: MailerEngine): Promise<number> {
  const campaigns = await engine.listCampaigns();
  const rows: string[][] = [];
  for (const c of campaigns) {
    const s = await engine.getCampaignStats(c.id);
    const mode = s.mode === "dry-run" ? "dry-run" : s.mode === "live" ? "live" : "-";
    rows.push([
      s.campaignId,
      s.status,
      mode,
      String(s.totalQueued),
      String(s.sentCount),
      String(s.failedCount),
      String(s.retryingCount),
      s.successRate,
      s.campaignName,
    ]);
  }
  printTable(
    [
      { header: "ID", width: 36 },
      { header: "STATUS", width: 10 },
      { header: "MODE", width: 8 },
      { header: "QUEUED", width: 7 },
      { header: "SENT", width: 6 },
      { header: "FAILED", width: 6 },
      { header: "RETRY", width: 6 },
      { header: "RATE", width: 8 },
      { header: "NAME" },
    ],
    rows,
  );
  return 0;
}
