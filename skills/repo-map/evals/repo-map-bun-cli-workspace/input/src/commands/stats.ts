import { parseCsv } from "../lib/parse.ts";

/** Print per-column counts of non-empty values. */
export async function stats(args: string[]): Promise<void> {
  const [file] = args;
  if (!file) throw new Error("stats: missing <file.csv>");
  const rows = await parseCsv(file);
  if (rows.length === 0) {
    console.log("stats: empty file");
    return;
  }
  const header = rows[0];
  for (let col = 0; col < header.length; col++) {
    const filled = rows.slice(1).filter((r) => (r[col] ?? "") !== "").length;
    console.log(`${header[col]}: ${filled}/${rows.length - 1} non-empty`);
  }
}
