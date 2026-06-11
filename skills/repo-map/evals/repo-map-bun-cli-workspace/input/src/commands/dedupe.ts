import { parseCsv, writeCsv } from "../lib/parse.ts";

/** Remove exact duplicate rows, keeping first occurrence order. */
export async function dedupe(args: string[]): Promise<void> {
  const [file] = args;
  if (!file) throw new Error("dedupe: missing <file.csv>");
  const rows = await parseCsv(file);
  const seen = new Set<string>();
  const unique = rows.filter((row) => {
    const key = JSON.stringify(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  await writeCsv(file, unique);
  console.log(`dedupe: ${rows.length - unique.length} duplicate rows removed`);
}
