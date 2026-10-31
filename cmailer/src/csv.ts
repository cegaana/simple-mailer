import { readFileSync } from "node:fs";
import type { RecipientInput } from "@cegaana/simple-mailer";

const splitCsvLine = (line: string): string[] =>
  (line.match(/("([^"]|"")*"|[^,]*)(,|$)/g) ?? [])
    .map((c) => c.replace(/,$/, "").trim())
    .map((c) => (c.startsWith('"') ? c.slice(1, -1).replace(/""/g, '"') : c))
    .slice(0, -1 || undefined);

export function parseCsvHeader(headerLine: string): string[] {
  return splitCsvLine(headerLine.replace(/^\uFEFF/, ""));
}

export function readCsvColumns(path: string): string[] {
  const [header] = readFileSync(path, "utf8")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "");
  if (!header) throw new Error(`${path} is empty`);
  const rawCols = parseCsvHeader(header);
  const normalized = rawCols.map((c) => c.toLowerCase().replace(/\s+/g, "_"));
  return [...new Set([...rawCols, ...normalized])];
}

const isInitialOnly = (s: string): boolean => {
  const clean = s.replace(/\./g, "").trim();
  return clean.length <= 1;
};

/** Minimal CSV reader: header row, comma separated, optional double quotes. */
export function readCsv(path: string): RecipientInput[] {
  const [header, ...lines] = readFileSync(path, "utf8")
    .replace(/^\uFEFF/, "")
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
      let val = cells[i] ?? "";
      if (column.toLowerCase() === "badge_id" && /^\d{8}$/.test(val.trim())) {
        val = `${val.trim().slice(0, 4)}-${val.trim().slice(4)}`;
      }
      if (i !== emailAt && column.toLowerCase() !== "name") {
        metadata[column] = val;
        const snakeKey = column.toLowerCase().replace(/\s+/g, "_");
        if (!(snakeKey in metadata)) {
          metadata[snakeKey] = val;
        }
      }
    });

    const rawFirst = String(metadata["first_name"] ?? "").trim();
    const rawLast = String(metadata["last_name"] ?? "").trim();

    if (rawFirst && isInitialOnly(rawFirst)) {
      if (rawLast && !isInitialOnly(rawLast)) {
        metadata["first_name"] = `${rawFirst} ${rawLast}`.trim();
      } else {
        metadata["first_name"] = "";
      }
    }

    const nameAt = columns.findIndex((c) => c.toLowerCase() === "name");
    const explicitName = nameAt === -1 ? undefined : (cells[nameAt] ?? "").trim();
    const synthesizedName = [rawFirst, rawLast].filter(Boolean).join(" ").trim();
    const name = explicitName || synthesizedName || undefined;

    return {
      email: (cells[emailAt] ?? "").trim(),
      ...(name ? { name } : {}),
      metadata,
    };
  });
}
