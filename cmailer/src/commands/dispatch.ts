import { MailerEngine, MockTransport } from "@cegaana/simple-mailer";
import type { DispatchReport } from "@cegaana/simple-mailer";
import type { CliFlags } from "../flags.js";
import { need } from "../flags.js";

/**
 * Runs one dispatch against `campaignId`, shared by the standalone `dispatch`
 * command and `send`'s combined create-enqueue-dispatch flow — identical
 * pacing, transport, and progress-printing behavior either way.
 *
 * `--dry-run` forces this run through the mock transport regardless of
 * `--transport`, so nothing is written to disk or sent, no matter what the
 * engine's default transport is.
 */
export async function runDispatch(
  engine: MailerEngine,
  campaignId: string,
  values: CliFlags,
  description: string,
): Promise<DispatchReport> {
  const dryRunOverride = values["dry-run"] ? new MockTransport() : undefined;
  console.log(`Sending via ${dryRunOverride ? "mock (--dry-run)" : description}`);

  const report = await engine.dispatch(campaignId, {
    ...(values.delay ? { delayMs: Number(values.delay) } : {}),
    ...(values.limit ? { limit: Number(values.limit) } : {}),
    ...(dryRunOverride ? { transport: dryRunOverride.send } : {}),
    onProgress: (p) => console.log(`[${String(p.percent).padStart(3)}%] ${p.status.padEnd(8)} ${p.email}`),
  });
  if (values["dry-run"]) {
    report.dryRun = true;
  }
  return report;
}

/** `cmailer dispatch <campaign-id>` */
export async function dispatchCommand(
  engine: MailerEngine,
  values: CliFlags,
  rest: string[],
  description: string,
): Promise<number> {
  const campaignId = need(rest[0], "campaign-id");
  const report = await runDispatch(engine, campaignId, values, description);
  console.log(JSON.stringify(report, null, 2));
  return report.status === "aborted" ? 1 : 0;
}
