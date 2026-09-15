import { readFileSync } from "node:fs";
import { inspectVariables, type MailerEngine } from "@cegaana/simple-mailer";
import type { CliFlags } from "../flags.js";
import { need } from "../flags.js";
import { printTable } from "../table.js";
import { applyManifestConfig } from "../manifest.js";
import { readCsvColumns } from "../csv.js";

/** `cmailer template create --slug --name --subject --html --text` */
export async function templateCreate(engine: MailerEngine, values: CliFlags): Promise<number> {
  const id = await engine.createTemplate({
    slug: need(values.slug, "slug"),
    name: need(values.name, "name"),
    subject: need(values.subject, "subject"),
    bodyHtml: readFileSync(need(values.html, "html"), "utf8"),
    bodyText: readFileSync(need(values.text, "text"), "utf8"),
  });
  console.log(id);
  return 0;
}

/**
 * `cmailer template upsert --slug --name --subject --html --text` — creates
 * the template if the slug is new, or overwrites its content if it already
 * exists. Useful for a template whose HTML/text lives in files you keep
 * re-editing (e.g. ahead of a recurring event mailing) without hand-tracking
 * whether this is the first run or the tenth.
 */
export async function templateUpsert(engine: MailerEngine, values: CliFlags): Promise<number> {
  const id = await engine.upsertTemplate({
    slug: need(values.slug, "slug"),
    name: need(values.name, "name"),
    subject: need(values.subject, "subject"),
    bodyHtml: readFileSync(need(values.html, "html"), "utf8"),
    bodyText: readFileSync(need(values.text, "text"), "utf8"),
  });
  console.log(id);
  return 0;
}

/** `cmailer template preview <slug> [--data '<json>']` */
export async function templatePreview(engine: MailerEngine, values: CliFlags, rest: string[]): Promise<number> {
  const data = values.data ? (JSON.parse(values.data) as Record<string, unknown>) : {};
  const rendered = await engine.previewTemplate(need(rest[1], "slug"), data);
  console.log(`Subject: ${rendered.subject}\n\n--- text ---\n${rendered.text}\n\n--- html ---\n${rendered.html}`);
  return 0;
}

/** `cmailer template list` */
export async function templateList(engine: MailerEngine): Promise<number> {
  printTable(
    [{ header: "SLUG", width: 28 }, { header: "NAME" }],
    (await engine.listTemplates()).map((t) => [t.slug, t.name]),
  );
  return 0;
}

/**
 * `cmailer template check [--slug <slug>] [--html <file> --text <file>] [--config <file> --preset <key>] [--csv <file>]`
 * Validates template placeholder syntax and optionally checks against CSV columns.
 */
export async function templateCheck(
  engine: MailerEngine,
  values: CliFlags,
  rest: string[],
): Promise<number> {
  if (values.config) {
    applyManifestConfig(values);
  }

  let subject = values.subject ?? "";
  let bodyHtml = "";
  let bodyText = "";
  let identifier = "";

  const slug = values.slug ?? (rest[1] && !rest[1].startsWith("-") ? rest[1] : undefined);

  if (values.html && values.text) {
    bodyHtml = readFileSync(values.html, "utf8");
    bodyText = readFileSync(values.text, "utf8");
    identifier = `${values.html}, ${values.text}`;
  } else if (slug) {
    const tmpl = await engine.getTemplate(slug);
    if (!tmpl) {
      console.error(`Error: Template with slug "${slug}" not found in database.`);
      return 1;
    }
    bodyHtml = tmpl.bodyHtml;
    bodyText = tmpl.bodyText;
    subject = subject || tmpl.subject;
    identifier = `template slug "${slug}"`;
  } else {
    console.error(
      "Error: template check requires either --html and --text, --slug <slug>, or --config <file> [--preset <key>]",
    );
    return 1;
  }

  const inspected = inspectVariables(subject, bodyHtml, bodyText);
  console.log(`Template: ${identifier}`);
  if (subject) console.log(`Subject:  ${subject}`);
  console.log(`Placeholders found (${inspected.length}):`);
  if (inspected.length === 0) {
    console.log("  (none)");
  } else {
    for (const v of inspected) {
      if (v.hasDefault) {
        console.log(`  - ${v.name} (optional, default: "${v.defaultValue}")`);
      } else {
        console.log(`  - ${v.name} (required)`);
      }
    }
  }

  if (values.csv) {
    const columns = readCsvColumns(values.csv);
    console.log(`\nCSV: ${values.csv} (${columns.length} columns: ${columns.join(", ")})`);

    const colSet = new Set(columns.map((c) => c.toLowerCase()));
    colSet.add("email");
    colSet.add("name");

    const required = inspected.filter((v) => !v.hasDefault).map((v) => v.name);
    const missing = required.filter((v) => {
      const root = v.split(".")[0]!.toLowerCase();
      return !colSet.has(root) && !colSet.has(v.toLowerCase());
    });

    if (missing.length > 0) {
      console.error(`\n❌ Validation failed: ${missing.length} required variable(s) missing from CSV:`);
      for (const m of missing) {
        console.error(`  - ${m}`);
      }
      return 1;
    }

    console.log("\n✓ Validation passed: All required template variables are present in CSV.");
  } else {
    console.log("\n✓ Template syntax is valid.");
  }

  return 0;
}
