import { readFileSync } from "node:fs";
import type { RecipientInput } from "@cegaana/simple-mailer";

const splitCsvLine = (line: string): string[] =>
  (line.match(/("([^"]|"")*"|[^,]*)(,|$)/g) ?? [])
    .map((c) => c.replace(/,$/, "").trim())
    .map((c) => (c.startsWith('"') ? c.slice(1, -1).replace(/""/g, '"') : c))
    .slice(0, -1 || undefined);

export function parseCsvHeader(headerLine: string): string[] {
  return splitCsvLine(headerLine);
}

export function readCsvColumns(path: string): string[] {
  const [header] = readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "");
  if (!header) throw new Error(`${path} is empty`);
  return parseCsvHeader(header);
}

/** Minimal CSV reader: header row, comma separated, optional double quotes. */
export function readCsv(path: string): RecipientInput[] {
  const [header, ...lines] = readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "");
  if (!header) throw new Error(`${path} is empty`);

  const columns = parseCsvHeader(header);
  const emailAt = columns.findIndex((c) => c.toLowerCase() === "email");
  if (emailAt === -1) throw new Error(`${path} has no "email" column`);

  return lines.map((line) => {
    const cells = splitCsvLine(line);
    const metadata: Record<string, unknown> = {};
    columns.forEach((column, i) => {
      if (i !== emailAt && column.toLowerCase() !== "name") metadata[column] = cells[i] ?? "";
    });
    const nameAt = columns.findIndex((c) => c.toLowerCase() === "name");
    const name = nameAt === -1 ? undefined : cells[nameAt];
    return {
      email: cells[emailAt] ?? "",
      ...(name ? { name } : {}),
      metadata,
    };
  });
}
