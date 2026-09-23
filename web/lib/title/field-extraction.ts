/** Bounded, label-based suggestions only. This module never changes or approves a field. */
export type SourceFieldPage = {
  page: number;
  text: string;
  method: "pdf-text" | "ocr" | "source-text";
  /** OCR engine estimate on a 0–100 scale, not field accuracy. */
  confidence?: number;
};
export type SourceFieldCandidate = {
  rawValue: string;
  quote: string;
  page: number;
  method: SourceFieldPage["method"];
  confidence?: number;
  warnings: string[];
};
export type SourceFieldSuggestion = {
  fieldId: string;
  label: string;
  status: "missing" | "suggested" | "ambiguous";
  candidates: SourceFieldCandidate[];
  warnings: string[];
};
export const FIELD_EXTRACTION_LIMITS = {
  fields: 32, pages: 120, pageCharacters: 50_000, characters: 500_000,
  lines: 12_000, valueCharacters: 500, valueLines: 4, candidates: 16,
} as const;

type Scope = "deed" | "security";
type Kind = "name" | "date" | "time" | "amount" | "reference" | "instrument";
type Alias = { field: string; kind: Kind } | { generic: "dated" | "date" | "time" | "reference" | "instrument"; kind: Kind };
type Line = { text: string; start: number; end: number };
type Parsed = { alias: Alias; value: string; valueOffset: number };
const knownFields = new Set(["name", "deedDated", "date", "time", "reference", "loanAmount", "dotDated", "dotDate", "dotTime", "dotReference", "trustee"]);
// Only labels are normalized. Values and evidence always remain original substrings.
const labelKey = (text: string) => text.toLowerCase().replace(/[\s/()._–—-]+/g, " ").trim();
const aliases = new Map<string, Alias>();
function add(names: string[], alias: Alias) {
  for (const name of names) aliases.set(labelKey(name), alias);
}
add(["Vesting / grantee name", "Grantee", "Grantees", "Grantee(s)", "Grantee name", "Grantee names", "Vesting", "Vesting name", "Vested in", "Title vested in"], { field: "name", kind: "name" });
add(["Confirmed loan amount", "Loan amount", "Original loan amount", "Principal amount", "Original principal amount", "Note amount", "Amount of loan"], { field: "loanAmount", kind: "amount" });
add(["Trustee", "Trustee(s)", "Trustees", "Trustee name", "Trustee wording"], { field: "trustee", kind: "name" });
for (const [prefix, scope] of [["Deed", "deed"], ["Deed of trust", "security"], ["DOT", "security"], ["Mortgage", "security"], ["Security instrument", "security"]] as const) {
  add([`${prefix} dated date`, `${prefix} dated`, `${prefix} date`, `Date of ${prefix}`, `Date ${prefix} dated`], { field: scope === "deed" ? "deedDated" : "dotDated", kind: "date" });
  add([`${prefix} recording date`, `${prefix} recorded date`, `${prefix} date recorded`, `${prefix} recorded on`], { field: scope === "deed" ? "date" : "dotDate", kind: "date" });
  add([`${prefix} recording time`, `${prefix} recorded time`, `${prefix} time recorded`], { field: scope === "deed" ? "time" : "dotTime", kind: "time" });
  add([`${prefix} book / page`, `${prefix} book and page`, `${prefix} recording reference`], { field: scope === "deed" ? "reference" : "dotReference", kind: "reference" });
  add([`${prefix} instrument number`, `${prefix} instrument no`, `${prefix} document number`], { field: scope === "deed" ? "reference" : "dotReference", kind: "instrument" });
}
add(["Dated", "Dated date", "Date of instrument"], { generic: "dated", kind: "date" });
add(["Recording date", "Date recorded", "Recorded date", "Recorded on"], { generic: "date", kind: "date" });
add(["Recording time", "Time recorded", "Recorded time"], { generic: "time", kind: "time" });
add(["Book / page", "Book and page", "Recording reference"], { generic: "reference", kind: "reference" });
add(["Instrument number", "Instrument no", "Document number"], { generic: "instrument", kind: "instrument" });
const headings = new Map<string, Scope>();
for (const name of ["Deed", "Warranty deed", "General warranty deed", "Special warranty deed", "Quitclaim deed", "Deed information", "Deed details", "Deed recording information"]) headings.set(labelKey(name), "deed");
for (const name of ["Deed of trust", "Mortgage", "DOT", "Security instrument", "Deed of trust information", "Mortgage information", "DOT information", "Security instrument information", "Deed of trust recording information"]) headings.set(labelKey(name), "security");
const scopeFields = {
  deed: { dated: "deedDated", date: "date", time: "time", reference: "reference", instrument: "reference" },
  security: { dated: "dotDated", date: "dotDate", time: "dotTime", reference: "dotReference", instrument: "dotReference" },
};

function heading(text: string) {
  return headings.get(labelKey(text.trim().replace(/:$/, "")));
}
function parseLabel(text: string): Parsed | undefined {
  // Bound label scanning even if a PDF has flattened a whole page into one line.
  const prefix = text.slice(0, 164);
  const indent = text.length - text.trimStart().length;
  const colon = prefix.indexOf(":");
  const separator = /\t+| {2,}|\s+[–—-]\s+/.exec(prefix.trimStart());
  const splits = [
    ...(colon >= 0 ? [{ end: colon, size: 1 }] : []),
    ...(separator ? [{ end: indent + separator.index, size: separator[0].length }] : []),
  ];
  for (const split of splits) {
    const labelEnd = split.end;
    const alias = aliases.get(labelKey(text.slice(0, labelEnd)));
    if (alias) {
      const after = labelEnd + split.size;
      const remainder = text.slice(after);
      const valueOffset = after + remainder.length - remainder.trimStart().length;
      return { alias, value: text.slice(valueOffset).trimEnd(), valueOffset };
    }
  }
  if (text.length <= 164) {
    const alias = aliases.get(labelKey(text));
    if (alias) return { alias, value: "", valueOffset: text.length };
  }
}
function boundary(text: string) {
  return !text.trim() || !!heading(text) || !!parseLabel(text) ||
    /^[^:\r\n]{1,100}:/.test(text.trim()) ||
    /^(?:grantor|grantors|legal description|property address|mailing address|return to|prepared by|notary|acknowledgment|signature)\s*:?$/i.test(text.trim());
}
function pageLines(text: string) {
  const lines: Line[] = [];
  const pattern = /([^\r\n]*)(?:\r\n|\r|\n|$)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) && match[0].length) {
    lines.push({ text: match[1], start: match.index, end: match.index + match[1].length });
    if (lines.length > FIELD_EXTRACTION_LIMITS.lines) throw new Error("Too many source lines. Read fewer pages at a time.");
  }
  return lines;
}
function addWarning(warnings: string[], message: string) {
  if (!warnings.includes(message)) warnings.push(message);
}
function validDay(year: number, month: number, day: number) {
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}
function checkDate(raw: string): { valid: boolean; ambiguous?: string } {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (iso) return { valid: validDay(+iso[1], +iso[2], +iso[3]) };
  const numeric = /^(\d{1,2})([/-])(\d{1,2})\2(\d{4})$/.exec(raw);
  if (numeric) {
    const a = +numeric[1], b = +numeric[3], year = +numeric[4];
    const monthFirst = validDay(year, a, b), dayFirst = validDay(year, b, a);
    return { valid: monthFirst || dayFirst, ambiguous: monthFirst && dayFirst && a !== b ? "Numeric date order is ambiguous. Confirm month and day against the original; no interpretation was selected." : undefined };
  }
  const named = /^(January|February|March|April|May|June|July|August|September|October|November|December|Jan\.?|Feb\.?|Mar\.?|Apr\.?|Jun\.?|Jul\.?|Aug\.?|Sep\.?|Sept\.?|Oct\.?|Nov\.?|Dec\.?)\s+(\d{1,2}),?\s+(\d{4})$/i.exec(raw);
  if (!named) return { valid: false };
  const month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(named[1].slice(0, 3).toLowerCase()) + 1;
  return { valid: validDay(+named[3], month, +named[2]) };
}
function checkValue(kind: Kind, value: string): { valid: boolean; ambiguous?: string } {
  if (!value || value.length > FIELD_EXTRACTION_LIMITS.valueCharacters || /^(?:n\/?a|none|unknown|tbd|see attached|not provided|not available|blank|[-_]+)$/i.test(value)) return { valid: false };
  if (kind === "date") return checkDate(value);
  if (kind === "amount") return { valid: /^(?:(?:USD|US\$)\s*|\$\s*)?(?:\d{1,12}|\d{1,3}(?:,\d{3}){1,3})(?:\.\d{2})?$/.test(value) };
  if (kind === "time") {
    const time = /^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(AM|PM|A\.M\.|P\.M\.))?$/i.exec(value);
    if (!time || +time[2] > 59 || (time[3] !== undefined && +time[3] > 59)) return { valid: false };
    const hour = +time[1], meridiem = time[4];
    return { valid: meridiem ? hour >= 1 && hour <= 12 : hour <= 23, ambiguous: !meridiem && hour >= 1 && hour <= 12 ? "No AM/PM is shown. Confirm whether the source uses a 24-hour clock." : undefined };
  }
  if (kind === "instrument") return { valid: /^(?=[A-Za-z0-9-]*\d)[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(value) };
  if (kind === "reference") return { valid: /^(?:(?:Book|Bk)\.?\s*)?\d{1,12}[A-Za-z]?\s*(?:\/|,|\s+(?:Page|Pg)\.?\s+)\s*\d{1,12}(?:-\d{1,12})?$/i.test(value) };
  return { valid: /\p{L}/u.test(value) && !/[<>:]/.test(value) };
}
function validateInput(defs: Array<{ id: string; label: string }>, pages: SourceFieldPage[]) {
  if (!Array.isArray(defs) || defs.length > FIELD_EXTRACTION_LIMITS.fields || !Array.isArray(pages) || pages.length > FIELD_EXTRACTION_LIMITS.pages) throw new Error("Too many or invalid fields/pages for source suggestions.");
  const fieldIds = new Set<string>(), pageIds = new Set<string>();
  for (const def of defs) {
    if (!def || typeof def.id !== "string" || !/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(def.id) || typeof def.label !== "string" || !def.label.trim() || def.label.length > 160 || fieldIds.has(def.id)) throw new Error("Invalid or duplicate source field definition.");
    fieldIds.add(def.id);
  }
  let total = 0;
  for (const page of pages) {
    if (!page || !Number.isSafeInteger(page.page) || page.page < 1 || page.page > FIELD_EXTRACTION_LIMITS.pages || typeof page.text !== "string" || !["pdf-text", "ocr", "source-text"].includes(page.method) || (page.confidence !== undefined && (!Number.isFinite(page.confidence) || page.confidence < 0 || page.confidence > 100))) throw new Error("Invalid source page or OCR confidence.");
    if (page.text.length > FIELD_EXTRACTION_LIMITS.pageCharacters || (total += page.text.length) > FIELD_EXTRACTION_LIMITS.characters) throw new Error("Too much source text. Read fewer pages at a time.");
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(page.text)) throw new Error("Source text contains unsupported control characters. Review the original.");
    const key = `${page.page}:${page.method}`;
    if (pageIds.has(key)) throw new Error("Duplicate source page and reading method.");
    pageIds.add(key);
  }
}

export function suggestSourceFields(defs: Array<{ id: string; label: string }>, pages: SourceFieldPage[]): SourceFieldSuggestion[] {
  validateInput(defs, pages);
  const result: SourceFieldSuggestion[] = defs.map(def => ({ fieldId: def.id, label: def.label, status: "missing", candidates: [], warnings: knownFields.has(def.id) ? [] : ["This field has no supported source labels. Capture it manually."] }));
  const byId = new Map(result.map(row => [row.fieldId, row]));
  const ambiguous = new Set<string>();
  let totalLines = 0;
  for (const page of pages) {
    const lines = pageLines(page.text);
    if ((totalLines += lines.length) > FIELD_EXTRACTION_LIMITS.lines) throw new Error("Too many source lines. Read fewer pages at a time.");
    let scope: Scope | undefined;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i], newScope = heading(line.text);
      if (newScope) { scope = newScope; continue; }
      // A different instrument's heading cannot inherit a previous deed's context.
      if (/^(?:assignment|release|satisfaction|substitution|modification|amendment)(?:\s|:|$)/i.test(line.text.trim())) scope = undefined;
      const parsed = parseLabel(line.text);
      if (!parsed) continue;
      const alias = parsed.alias;
      if ("generic" in alias && !scope) {
        for (const group of Object.values(scopeFields)) {
          const row = byId.get(group[alias.generic]);
          if (row) {
            addWarning(row.warnings, "A generic label has no explicit deed/security heading on this page. Capture its context manually.");
            ambiguous.add(row.fieldId);
          }
        }
        continue;
      }
      const fieldId = "field" in alias ? alias.field : scopeFields[scope!][alias.generic];
      if ("field" in alias && scope) {
        const fieldScope = /^(?:dot|loanAmount|trustee)/.test(alias.field) ? "security" : "deed";
        if (fieldScope !== scope) scope = undefined;
      }
      const row = byId.get(fieldId);
      if (!row) continue;
      // Do not borrow a value from another label, blank block, or physical page.
      let first = i, start = line.start + parsed.valueOffset, last = i;
      if (!parsed.value) {
        first = i + 1;
        if (!lines[first] || boundary(lines[first].text)) {
          addWarning(row.warnings, "A source label has no adjacent value.");
          ambiguous.add(fieldId);
          continue;
        }
        start = lines[first].start + lines[first].text.length - lines[first].text.trimStart().length;
        last = first;
      }
      if (alias.kind === "name") {
        while (last + 1 < lines.length && !boundary(lines[last + 1].text) && last - first + 1 < FIELD_EXTRACTION_LIMITS.valueLines) last++;
        if (last + 1 < lines.length && !boundary(lines[last + 1].text)) {
          addWarning(row.warnings, "The wording extends beyond the suggestion limit. Capture the complete wording manually; no clipped value was suggested.");
          ambiguous.add(fieldId);
          continue;
        }
      }
      const rawValue = page.text.slice(start, lines[last].end).trimEnd();
      const checked = checkValue(alias.kind, rawValue);
      if (!checked.valid) {
        addWarning(row.warnings, "A labeled value is incomplete, oversized or not a supported exact format. Check the original; no value was guessed.");
        ambiguous.add(fieldId);
        continue;
      }
      const quote = page.text.slice(line.start, lines[last].end);
      const warnings = ["Label-based suggestion only. Verify the original before capturing; this does not approve the field."];
      if (last > first || /[\r\n]/.test(rawValue)) warnings.push("Multiline wording is preserved. Confirm that all lines belong to this field.");
      if (checked.ambiguous) { warnings.push(checked.ambiguous); ambiguous.add(fieldId); }
      if (page.method === "ocr") {
        warnings.push(page.confidence !== undefined ? `OCR engine confidence ${Math.round(page.confidence)}/100 is an estimate, not field accuracy. Verify every character against the image.` : "OCR engine confidence was not supplied. An engine estimate is not field accuracy; verify every character against the original image.");
        if (page.confidence === undefined || page.confidence < 80) {
          ambiguous.add(fieldId);
          warnings.push("Missing or low OCR confidence requires a deliberate source comparison. This candidate is not eligible for automatic filling.");
        }
      }
      const candidate: SourceFieldCandidate = { rawValue, quote, page: page.page, method: page.method, warnings, ...(page.confidence !== undefined ? { confidence: page.confidence } : {}) };
      if (row.candidates.some(prior => prior.rawValue === rawValue && prior.quote === quote && prior.page === page.page && prior.method === page.method)) continue;
      if (row.candidates.length >= FIELD_EXTRACTION_LIMITS.candidates) {
        ambiguous.add(fieldId);
        addWarning(row.warnings, "There are more labeled candidates than can be displayed. Review the complete source; no value was selected.");
      } else row.candidates.push(candidate);
    }
  }
  for (const row of result) {
    if (new Set(row.candidates.map(candidate => candidate.rawValue)).size > 1) {
      ambiguous.add(row.fieldId);
      addWarning(row.warnings, "Different source values were found. Resolve the conflict manually; no value was selected.");
    }
    row.status = row.candidates.length ? ambiguous.has(row.fieldId) ? "ambiguous" : "suggested" : "missing";
    if (!row.candidates.length && !row.warnings.length) row.warnings.push("No supported, explicitly labeled value found. Capture it from the original manually.");
  }
  return result;
}
