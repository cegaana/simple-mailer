import type { MailerEngine } from "@cegaana/simple-mailer";
import type { CliFlags } from "../flags.js";
import { need } from "../flags.js";
import { printTable } from "../table.js";

/** `cmailer suppression add <email> --reason <reason>` */
export async function suppressionAdd(engine: MailerEngine, values: CliFlags, rest: string[]): Promise<number> {
  const email = need(rest[1], "email");
  await engine.addSuppression(email, values.reason ?? "manual");
  console.log(`suppressed ${email}`);
  return 0;
}

/** `cmailer suppression list` */
export async function suppressionList(engine: MailerEngine): Promise<number> {
  printTable(
    [{ header: "EMAIL", width: 36 }, { header: "REASON", width: 16 }, { header: "CREATED AT" }],
    (await engine.listSuppressions()).map((s) => [s.email, s.reason, s.createdAt]),
  );
  return 0;
}

/** `cmailer suppression stats` */
export async function suppressionStats(engine: MailerEngine): Promise<number> {
  console.log(JSON.stringify(await engine.getSuppressionStats(), null, 2));
  return 0;
}
