import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCsv } from "../src/csv.js";

let dir: string | undefined;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

function csvFile(contents: string): string {
  dir = mkdtempSync(join(tmpdir(), "cmailer-csv-test-"));
  const path = join(dir, "recipients.csv");
  writeFileSync(path, contents, "utf8");
  return path;
}

describe("readCsv", () => {
  it("parses email, name, and extra columns into metadata", () => {
    const path = csvFile("email,name,event\ncharlie@example.com,Charlie Brown,CEGAANA Fall Event\n");

    const rows = readCsv(path);

    expect(rows).toEqual([
      { email: "charlie@example.com", name: "Charlie Brown", metadata: { event: "CEGAANA Fall Event" } },
    ]);
  });

  it("is case-insensitive and order-independent for the email column", () => {
    const path = csvFile("Name,Email\nJane,jane@example.com\n");

    const rows = readCsv(path);

    expect(rows).toEqual([{ email: "jane@example.com", name: "Jane", metadata: {} }]);
  });

  it("omits the name field entirely when no name column exists", () => {
    const path = csvFile("email\ncharlie@example.com\n");

    const rows = readCsv(path);

    expect(rows[0]).not.toHaveProperty("name");
  });

  it("throws when there is no email column", () => {
    const path = csvFile("name\nCharlie Brown\n");
    expect(() => readCsv(path)).toThrow(/no "email" column/);
  });

  it("throws on an empty file", () => {
    const path = csvFile("");
    expect(() => readCsv(path)).toThrow(/is empty/);
  });
});
