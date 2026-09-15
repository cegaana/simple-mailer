import { readFileSync } from "node:fs";
import type { MailerEngine } from "@cegaana/simple-mailer";
import type { CliFlags } from "../flags.js";
import { need } from "../flags.js";
import { readCsv } from "../csv.js";
import { applyManifestConfig, checkTemplateVariables } from "../manifest.js";
import { runDispatch } from "./dispatch.js";

/**
 * `cmailer send` — create a campaign, enqueue a CSV, dispatch it, and print
 * final stats in one command. The one-shot version of:
 *
 *   cmailer template upsert ...   (only if --html/--text are given)
 *   cmailer campaign create ...
 *   cmailer campaign enqueue ...
 *   cmailer dispatch ...
 *   cmailer campaign stats ...
 *
 * Supports --config <manifest.json> [--preset <key> | --ticket-type <key>]
 * to automatically populate template, subject, name, and body files from a
 * central configuration.
 */
export async function sendCommand(engine: MailerEngine, values: CliFlags, description: string): Promise<number> {
  // Apply manifest config if --config is provided
  applyManifestConfig(values);

  const templateId = need(values.template, "template");

  // Upserting the template is optional: only when --html/--text are given,
  // so `send` still works against a template created separately. Both or
  // neither — half a template update is worse than none.
  let bodyHtml: string | undefined;
  let bodyText: string | undefined;
  if (values.html || values.text) {
    bodyHtml = readFileSync(need(values.html, "html"), "utf8");
    bodyText = readFileSync(need(values.text, "text"), "utf8");
  }

  // Preflight check: compare required template placeholders against CSV columns
  if (values.csv) {
    let subjectToCheck = values.subject;
    let htmlToCheck = bodyHtml;
    let textToCheck = bodyText;

    if (!htmlToCheck || !textToCheck || !subjectToCheck) {
      const existing = await engine.getTemplate(templateId);
      if (existing) {
        subjectToCheck = subjectToCheck ?? existing.subject;
        htmlToCheck = htmlToCheck ?? existing.bodyHtml;
        textToCheck = textToCheck ?? existing.bodyText;
      }
    }

    if (subjectToCheck && htmlToCheck && textToCheck) {
      checkTemplateVariables(subjectToCheck, htmlToCheck, textToCheck, values.csv, values.strict);
    }
  }

  if (bodyHtml && bodyText) {
    const upsertedId = await engine.upsertTemplate({
      slug: templateId,
      name: values["template-name"] ?? need(values.name, "name"),
      subject: need(values.subject, "subject"),
      bodyHtml,
      bodyText,
    });
    console.log(`1. Template upserted: ${upsertedId}\n`);
  }

  const campaignId = await engine.createCampaign({
    name: need(values.name, "name"),
    subject: need(values.subject, "subject"),
    templateId,
    ...(values["scheduled-at"] ? { scheduledAt: values["scheduled-at"] } : {}),
  });
  console.log(`2. Campaign created: ${campaignId}\n`);

  const enqueueResult = await engine.enqueueRecipients(campaignId, readCsv(need(values.csv, "csv")));
  console.log(
    `3. Queued ${enqueueResult.queuedCount}, duplicates ${enqueueResult.duplicateCount}, suppressed ${enqueueResult.suppressedCount}`,
  );

  const report = await runDispatch(engine, campaignId, values, description);
  console.log(`\n4. Report:\n${JSON.stringify(report, null, 2)}\n`);

  console.log(`5. Stats:\n${JSON.stringify(await engine.getCampaignStats(campaignId), null, 2)}\n`);

  return report.status === "aborted" ? 1 : 0;
}
