/** Minimal CSV reader/writer: comma-separated, double-quote escaping. */

export async function parseCsv(path: string): Promise<string[][]> {
  const text = await Bun.file(path).text();
  return text
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map(splitLine);
}

export async function writeCsv(path: string, rows: string[][]): Promise<void> {
  const text = rows.map((r) => r.map(quote).join(",")).join("\n") + "\n";
  await Bun.write(path, text);
}

function splitLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      out.push(field);
      field = "";
    } else {
      field += ch;
    }
  }
  out.push(field);
  return out;
}

function quote(field: string): string {
  return /[",\n]/.test(field) ? `"${field.replaceAll('"', '""')}"` : field;
}
