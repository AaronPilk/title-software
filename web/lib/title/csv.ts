/**
 * Minimal CSV parser for the accounting import preview scaffold (J06-J07).
 * Handles the common real-world cases — quoted fields with embedded commas
 * or newlines, doubled-quote escaping (`""` inside a quoted field), CRLF or
 * LF line endings, and a leading UTF-8 BOM (common from Excel/QuickBooks
 * exports) — without pulling in a dependency. This is a preview tool, not a
 * general-purpose CSV library: no custom delimiters, no streaming for very
 * large files.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let state: "start" | "plain" | "quoted" | "closed" = "start";
  let pendingRow = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const fail = (detail: string): never => {
    throw new Error(`CSV record ${rows.length + 1}: ${detail}`);
  };
  function finishField() {
    row.push(field);
    field = "";
    state = "start";
  }
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (state === "quoted") {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          state = "closed";
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === ",") {
      finishField();
      pendingRow = true;
    } else if (c === "\r" || c === "\n") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      finishField();
      rows.push(row);
      row = [];
      pendingRow = false;
    } else if (state === "closed") {
      if (c !== " " && c !== "\t")
        fail(
          "unexpected text after a closing quote. Check the original export.",
        );
    } else if (c === '"') {
      if (state !== "start")
        fail(
          "a quote appears inside an unquoted field. Quote the whole field and double any quotes within it.",
        );
      state = "quoted";
      pendingRow = true;
    } else {
      field += c;
      state = "plain";
      pendingRow = true;
    }
  }
  if (state === "quoted")
    fail(
      "a quoted field is not closed. Export the file again or repair the missing quote.",
    );
  // A separator already closes its record. Preserve explicit empty cells,
  // including a final quoted empty field, without adding a phantom record.
  if (pendingRow) {
    finishField();
    rows.push(row);
  }
  return rows;
}
export type CsvPreview = {
  headers: string[];
  rows: string[][];
  /** Count of all data rows found, even if `rows` was capped for display. */
  totalDataRows: number;
};
/**
 * Splits a parsed CSV into its header row and a capped preview of the data
 * rows that follow, reporting the true total separately so the UI can say
 * "showing 15 of 4,200 rows" instead of silently truncating.
 */
export function previewCsv(text: string, maxRows = 15): CsvPreview {
  const [headers = [], ...data] = parseCsv(text);
  if (!headers.length)
    throw new Error("This CSV is empty. Choose an export with a header row.");
  const seen = new Set<string>();
  for (const [i, header] of headers.entries()) {
    const key = header.trim().toLowerCase();
    if (!key)
      throw new Error(
        `Column ${i + 1} has no header. Give every column a unique name before mapping it.`,
      );
    if (seen.has(key))
      throw new Error(
        `Duplicate column header "${header}". Give each column a unique name so its mapping stays separate.`,
      );
    seen.add(key);
  }
  for (const [i, row] of data.entries()) {
    if (row.length !== headers.length)
      throw new Error(
        `CSV record ${i + 2} has ${row.length} fields; the header has ${headers.length}. Check for missing fields or extra commas.`,
      );
  }
  return { headers, rows: data.slice(0, maxRows), totalDataRows: data.length };
}
