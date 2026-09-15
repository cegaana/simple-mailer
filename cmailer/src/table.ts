/** Prints a left-aligned table: a header row, then one row per data row. */
export function printTable(columns: Array<{ header: string; width?: number }>, rows: string[][]): void {
  const line = (cells: string[]) =>
    columns
      .map((c, i) => (c.width ? (cells[i] ?? "").padEnd(c.width) : (cells[i] ?? "")))
      .join(" ")
      .trimEnd();

  console.log(line(columns.map((c) => c.header)));
  for (const row of rows) console.log(line(row));
}
