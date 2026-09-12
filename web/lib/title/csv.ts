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
  let inQuotes = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\r") {
      // Swallowed; a following \n (or end of input) closes the row.
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  // Flush a final field/row for a file that doesn't end with a newline.
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  // A file ending in a newline otherwise leaves one phantom fully-blank
  // trailing row; drop just that one so callers don't see a fake last
  // record. A genuinely blank row in the middle of the file is preserved.
  if (rows.length && rows[rows.length - 1].every((c) => c === "")) rows.pop();
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
  return { headers, rows: data.slice(0, maxRows), totalDataRows: data.length };
}
