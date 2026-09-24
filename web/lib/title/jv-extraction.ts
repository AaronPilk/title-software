import { jvReadiness, newJVApplication, newJVApplicant, type JVApplicant, type JVResidence, type JVEmployment } from "./jv-application";
import type { SourceFieldPage } from "./field-extraction";

export type JVExtractField = "name" | "email" | "phone" | "dob" | "ssn" | "driverLicense" | "currentAddress";
export type JVFieldCandidate = { field: JVExtractField; label: string; value: string; quote: string; page: number; method: SourceFieldPage["method"]; warning: string };
export const JV_FIELD_LABELS: Record<JVExtractField, string> = {
  name: "Applicant name", email: "Email", phone: "Phone", dob: "Date of birth", ssn: "Social Security number", driverLicense: "Driver’s license number", currentAddress: "Current address",
};
const labels: [JVExtractField, RegExp][] = [
  ["name", /^(?:applicant(?:'s)? name|full name|name)$/i],
  ["email", /^(?:e[ -]?mail(?: address)?)$/i],
  ["phone", /^(?:phone(?: number| #)?|telephone|cell(?: phone)?)$/i],
  ["dob", /^(?:d\.?o\.?b\.?|date of birth|birth date)$/i],
  ["ssn", /^(?:s\.?s\.?n\.?|social security(?: number| #)?)$/i],
  ["driverLicense", /^(?:driver['’]?s? licen[sc]e(?: number| #| no\.?)?|dl(?: number| #)?)$/i],
  ["currentAddress", /^(?:current(?: home| mailing)? address|home address)$/i],
];
const labelFor = (text: string) => labels.find(([, pattern]) => pattern.test(text.trim()))?.[0];
const placeholder = (value: string) => !value || /^[-_.\s/()[\]]+$/.test(value) || /^(?:n\/?a|unknown|not provided|see attached|mm\s*\/\s*dd\s*\/\s*yyyy)$/i.test(value);

/** Conservative printed-label capture. No inference from instructions, checkboxes, or history tables. */
export function extractJVFields(pages: SourceFieldPage[]): JVFieldCandidate[] {
  if (!Array.isArray(pages) || pages.length > 120) throw new Error("Read an application of up to 120 pages.");
  let characters = 0;
  const seenPages = new Set<number>(), result: JVFieldCandidate[] = [];
  for (const page of pages) {
    if (!page || !Number.isSafeInteger(page.page) || page.page < 1 || page.page > 120 || seenPages.has(page.page) || typeof page.text !== "string" ||
      !["pdf-text", "ocr", "source-text"].includes(page.method) || page.text.length > 50_000 || (characters += page.text.length) > 500_000 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(page.text)) throw new Error("The application text cannot be read safely. Review the original.");
    seenPages.add(page.page);
    for (const line of page.text.split(/\r\n|\r|\n/)) {
      // Require an explicit separator. Flattened or multiline form layouts remain manual review.
      const match = /^\s*([^:\t]{1,65}?)\s*(?::|\t+| {2,})\s*(.*?)\s*$/.exec(line);
      if (!match) continue;
      const field = labelFor(match[1]), raw = match[2].replace(/^_+\s*|\s*_+$/g, "").trim();
      if (!field || placeholder(raw) || raw.length > 500 || /[<>]/.test(raw)) continue;
      // Do not capture the next field's label as a value or combine flattened form fields.
      if (labelFor(raw.replace(/:$/, "")) || /\t/.test(raw) || /\b(?:e[ -]?mail|phone|dob|ssn|current address|driver['’]?s? licen[sc]e)(?::|\t+| {2,})/i.test(raw)) continue;
      let value = raw, warning = "Compare this value with the original before using it.";
      if (field === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) continue;
      if (field === "phone" && (!/^\+?[\d(). \-]{7,30}$/.test(raw) || raw.replace(/\D/g, "").length < 7)) continue;
      if (field === "ssn") {
        if (!/^\d{3}[- ]?\d{2}[- ]?\d{4}$/.test(raw)) continue;
        value = raw.replace(/[- ]/g, "");
        if (/^(?:000|666|9\d\d)|^\d{3}00|0{4}$/.test(value)) continue;
      }
      if (field === "dob") {
        // Do not choose day/month ordering on the user's behalf.
        if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || raw.startsWith("0000-") || raw > new Date().toISOString().slice(0, 10) || !Number.isFinite(Date.parse(raw)) || new Date(raw).toISOString().slice(0, 10) !== raw) continue;
      }
      if (field === "driverLicense" && !/^[A-Za-z0-9 -]{3,40}$/.test(raw)) continue;
      if ((field === "name" || field === "currentAddress") && !/\p{L}/u.test(raw)) continue;
      if (field === "name" && raw.length > 200) continue;
      if (page.method === "ocr") warning = "OCR can misread letters and digits. Check every character against the original.";
      const candidate = { field, label: JV_FIELD_LABELS[field], value, quote: line.trim(), page: page.page, method: page.method, warning };
      if (!result.some(item => item.field === field && item.value === value && item.page === page.page)) result.push(candidate);
      if (result.length > 140) throw new Error("Too many application candidates. Use a smaller source or enter the details manually.");
    }
  }
  return result;
}

export function jvCandidatePatch(candidate: JVFieldCandidate): Partial<JVApplicant> {
  if (!Object.hasOwn(JV_FIELD_LABELS, candidate.field)) throw new Error("Choose a supported applicant field.");
  return { [candidate.field]: candidate.value };
}

export type JVApplicationFillPatch = {
  applicants: { sourceApplicantKey: string; label: string; patch: Partial<JVApplicant>; targetApplicantId?: string }[];
  logoPreferences?: string;
  notes?: string;
};
type ScalarField = JVExtractField | "ownershipType" | "businessName" | "businessStatus" | "businessReference" | "logoPreferences" | "notes";
type HistoryField = "residenceHistory" | "employmentHistory";
export type JVApplicationCandidate = {
  id: string; applicantKey?: string; field: ScalarField | HistoryField; label: string;
  value: string | JVResidence | JVEmployment; quote: string; page: number;
  method: SourceFieldPage["method"]; warning: string; conflict: boolean;
};
export type JVApplicationExtraction = {
  applicants: { key: string; label: string }[];
  candidates: JVApplicationCandidate[];
  issues: { page?: number; message: string }[];
  missing: string[];
};
const fullLabels: Record<ScalarField | HistoryField, string> = {
  ...JV_FIELD_LABELS, ownershipType: "Ownership choice", businessName: "Owner business name", businessStatus: "Owner business status",
  businessReference: "Owner business formation reference", residenceHistory: "Residence history", employmentHistory: "Employment history",
  logoPreferences: "Logo / colors / design preferences", notes: "Additional notes",
};
function fullLabel(text: string): ScalarField | undefined {
  const plain = text.trim().replace(/\s*\((?:yyyy-mm-dd|mm\/dd\/yyyy|dd\/mm\/yyyy)\)\s*$/i, "");
  return labelFor(plain) || ([
    ["ownershipType", /^(?:ownership(?: choice| type)?|individual\s*\/\s*business ownership|owner type|would you like ownership in your name or business\??|will ownership be individual or business\??)$/i],
    ["businessName", /^(?:(?:owner )?business name|owner (?:llc|entity) name)$/i],
    ["businessStatus", /^(?:(?:owner )?business status|(?:owner )?(?:llc|entity) (?:formation )?status)$/i],
    ["businessReference", /^(?:(?:owner )?(?:business )?formation reference|business reference)$/i],
    ["logoPreferences", /^(?:logo(?:\s*\/\s*colors?\s*\/\s*design)? preferences|logo\s*\/\s*colors?\s*\/\s*design|logo(?:,? colors?)?(?: and design)?|colors? and design preferences)$/i],
    ["notes", /^(?:additional notes|notes|any other information you think we should know or suggestions\??)$/i],
  ] as [ScalarField, RegExp][]).find(([, re]) => re.test(plain))?.[0];
}
const unclear = (value: string) => /(?:\?{2,}|\[(?:unclear|illegible|unreadable|crossed out)\]|\b(?:illegible|unreadable)\b|\uFFFD)/i.test(value);
const formInstruction = (value: string) => /\b(?:please (?:enter|provide|complete|let us know)|enter (?:your|the)|complete (?:this|the)|print (?:your|the)|if you want to set up|need to be done prior|colors,? design etc\.?|licenses with nipr and underwriters)\b/i.test(value);
const formDecoration = (value: string) => /^(?:www\.[\w.-]+|ballantyne|title company|appli\s*cat(?:i\s*on|ion))$/i.test(value);
const historyHeadingPattern = /^(?:\d+[.)]\s*)?(?:(?:past|last|five|5|five-year|5-year)\s+)*(residen(?:ce|tial)|address|employment|work)(?:\s+history(?:\s*\([^)]*\)|\s*[-–:]?\s*(?:past|last)\s+(?:five|5)\s*years)?|\s+(?:past|last)\s+(?:five|5)\s*years)\s*:?$/i;
function sourceDate(raw: string, label = "", allowPresent = false): string | null {
  if (allowPresent && /^(?:present|current|ongoing)$/i.test(raw)) return "";
  let value = raw;
  const numeric = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (numeric && /\(mm\/dd\/yyyy\)/i.test(label)) value = `${numeric[3]}-${numeric[1].padStart(2, "0")}-${numeric[2].padStart(2, "0")}`;
  if (numeric && /\(dd\/mm\/yyyy\)/i.test(label)) value = `${numeric[3]}-${numeric[2].padStart(2, "0")}-${numeric[1].padStart(2, "0")}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-")) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}
function election(raw: string, choices: Record<string, string>): string | null {
  const direct = Object.hasOwn(choices, raw.trim().toLowerCase()) ? choices[raw.trim().toLowerCase()] : null;
  if (direct) return direct;
  const marked = [...raw.matchAll(/(?:\[\s*([xX✓✔ ])?\s*\]|([☒☑✓✔☐□]))\s*([^\[☒☑✓✔☐□]+)/g)];
  // Both options must be recognized; an unrecognized or half-read ballot stays manual.
  if (marked.length < 2 || marked.some(item => !Object.hasOwn(choices, item[3].trim().replace(/[;,]$/, "").toLowerCase()))) return null;
  const checked = marked.filter(item => !!item[1]?.trim() || !!item[2] && item[2] !== "☐" && item[2] !== "□");
  return checked.length === 1 ? choices[checked[0][3].trim().replace(/[;,]$/, "").toLowerCase()] : null;
}

/** Local, bounded label/layout parsing only. Source text is data, never instructions.
 * Unsupported layouts and uncertain person boundaries are surfaced for manual review.
 */
export function extractJVApplication(pages: SourceFieldPage[], today = new Date().toISOString().slice(0, 10)): JVApplicationExtraction {
  // Reuse the strict source bounds before processing any text (also preserves the legacy API).
  extractJVFields(pages);
  const result: JVApplicationExtraction = { applicants: [], candidates: [], issues: [], missing: [] };
  let applicantKey = "applicant-1", section: HistoryField | null = null;
  let history: { field: HistoryField; cells: Record<string, string>; labels: Record<string, string>; quotes: string[]; page: SourceFieldPage } | null = null;
  let columns: string[] = [], columnLabels: string[] = [];
  let continuation: JVApplicationCandidate | null = null;
  let pendingLabel: { field: ScalarField; label: string; lines: string[] } | null = null;
  const issue = (page: number, message: string) => { if (!result.issues.some(item => item.page === page && item.message === message)) result.issues.push({ page, message }); };
  const ensureApplicant = () => {
    if (!result.applicants.some(item => item.key === applicantKey)) {
      if (result.applicants.length >= 20) throw new Error("Read no more than 20 applicants at a time.");
      result.applicants.push({ key: applicantKey, label: `Source applicant ${result.applicants.length + 1}` });
    }
  };
  const add = (field: ScalarField | HistoryField, value: JVApplicationCandidate["value"], quote: string, page: SourceFieldPage) => {
    const global = field === "logoPreferences" || field === "notes";
    if (!global) ensureApplicant();
    if ((field === "residenceHistory" || field === "employmentHistory") && result.candidates.filter(item => item.applicantKey === applicantKey && item.field === field).length >= 40) {
      issue(page.page, `${fullLabels[field]} exceeds 40 rows for one applicant. Review the original and enter the applicable history manually.`); return null;
    }
    if (result.candidates.length >= 400) throw new Error("Too many application candidates. Read a smaller packet.");
    const candidate: JVApplicationCandidate = {
      id: `candidate-${result.candidates.length + 1}`, ...(global ? {} : { applicantKey }), field, label: fullLabels[field], value, quote, page: page.page,
      method: page.method, warning: page.method === "ocr" ? "OCR can misread handwriting, letters and digits. Check every character against the original; enter unclear handwriting manually." : "Compare this value and its applicant with the original before using it.", conflict: false,
    };
    if (typeof value === "string") {
      const prior = result.candidates.filter(item => item.applicantKey === candidate.applicantKey && item.field === field);
      if (prior.some(item => item.value === value)) return null;
      if (prior.length) { candidate.conflict = true; prior.forEach(item => { item.conflict = true; }); issue(page.page, `${fullLabels[field]} has competing values. Review the original and choose at most one for this source applicant or application.`); }
    }
    result.candidates.push(candidate); return candidate;
  };
  const flushHistory = () => {
    if (!history) return;
    const row = history; history = null;
    if (!Object.keys(row.cells).length) return;
    const from = sourceDate(row.cells.from || "", row.labels.from), to = sourceDate(row.cells.to || "", row.labels.to, true);
    const required = row.field === "residenceHistory" ? "address" : "employer";
    if (!row.cells[required] || from === null || to === null || to && from > to || Object.values(row.cells).some(unclear)) {
      issue(row.page.page, `${fullLabels[row.field]} contains an incomplete or unclear row. Enter it manually; include explicit start and end dates (or Present).`); return;
    }
    const id = `import-${applicantKey}-${row.field}-${result.candidates.length + 1}`;
    const value = row.field === "residenceHistory" ? { id, address: row.cells.address, from, to } : { id, employer: row.cells.employer, role: row.cells.role || "", address: row.cells.address || "", from, to };
    if ((value.address?.length || 0) > 1000 || "employer" in value && ((value.employer?.length || 0) > 200 || (value.role?.length || 0) > 200)) { issue(row.page.page, "A history row exceeds the application field limits and needs manual entry."); return; }
    add(row.field, value, row.quotes.join("\n"), row.page);
  };
  const historyLabel = (label: string): string | undefined => {
    const clean = label.toLowerCase().replace(/\s*\([^)]*\)\s*$/, "").trim();
    if (/^(?:address|residence address|home address|employer address|business address)$/.test(clean)) return "address";
    if (/^(?:employer|employer name|employment status|company)$/.test(clean)) return "employer";
    if (/^(?:role|title|position|job title)$/.test(clean)) return "role";
    if (/^(?:from|start|start date|date from)$/.test(clean)) return "from";
    if (/^(?:to|end|end date|date to)$/.test(clean)) return "to";
  };
  for (const page of [...pages].sort((a, b) => a.page - b.page)) {
    // A row never silently spans physical pages; the evidence must cover the complete row.
    flushHistory(); continuation = null; pendingLabel = null;
    const lines = page.text.split(/\r\n|\r|\n/);
    const pageHasName = lines.some((line, index) => {
      const match = /^\s*(?:applicant(?:'s)? name|full name|name)\s*(?::|\t+| {2,})\s*(.*?)\s*$/i.exec(line);
      if (!match) return false;
      let answer = match[1];
      if (placeholder(answer)) {
        answer = "";
        for (let next = index + 1; next < lines.length && next <= index + 12; next++) {
          if (lines[next].trim()) { answer = lines[next].trim(); break; }
        }
      }
      const adjacentField = /^([^:\t]{1,100}?)\s*(?::|\t+| {2,})/.exec(answer);
      return !placeholder(answer) && !fullLabel(answer.replace(/:$/, "")) && !(adjacentField && fullLabel(adjacentField[1])) && !historyHeadingPattern.test(answer) && !/^(?:applicant|owner|person)\s*#?\s*\d/i.test(answer) && !formInstruction(answer) && !formDecoration(answer);
    });
    for (const [lineIndex, rawLine] of lines.entries()) {
      const line = rawLine.trim();
      if (!line) { continuation = null; if (pendingLabel && pendingLabel.lines.length < 12) pendingLabel.lines.push(rawLine); else pendingLabel = null; continue; }
      const heading = /^(?:applicant|owner|person)\s*(?:#\s*)?(\d{1,2})(?:\s*[-:]\s*.*)?$/i.exec(line);
      if (heading) {
        flushHistory(); applicantKey = `applicant-${Number(heading[1])}`; ensureApplicant(); section = null; columns = []; continuation = null; pendingLabel = null; continue;
      }
      if (/^joint[- ]venture\s+appli\s*cat(?:i\s*on|ion)$/i.test(line) || /^joint[- ]venture$/i.test(line) && /^appli\s*cat(?:i\s*on|ion)$/i.test(lines[lineIndex + 1]?.trim() || "")) {
        flushHistory(); section = null; columns = []; continuation = null; pendingLabel = null;
        if (pageHasName && result.candidates.some(item => item.applicantKey === applicantKey && item.field === "name" && item.page !== page.page)) {
          let number = result.applicants.length + 1;
          while (result.applicants.some(item => item.key === `applicant-${number}`)) number++;
          applicantKey = `applicant-${number}`; ensureApplicant();
        }
        continue;
      }
      const historyHeading = historyHeadingPattern.exec(line);
      if (historyHeading) {
        flushHistory(); section = /employment|work/i.test(historyHeading[1]) ? "employmentHistory" : "residenceHistory"; columns = []; continuation = null; pendingLabel = null; ensureApplicant(); continue;
      }
      if (section && /^(?:past|last)\s+(?:five|5)\s*years\s*:?$/i.test(line)) continue;
      // The supplied Canva form has standalone labels and a three-line logo prompt.
      // Keep only the next answer on the same page; never turn a prompt/footer into a fact.
      const standaloneField = fullLabel(line.replace(/:$/, ""));
      if (standaloneField) {
        flushHistory(); section = null; columns = []; continuation = null;
        pendingLabel = { field: standaloneField, label: line.replace(/:$/, ""), lines: [rawLine] }; continue;
      }
      if (/^logo:\s*please let us know if you have a preference or sugges(?:tions|toins) for logo\.?$/i.test(line)) {
        flushHistory(); section = null; columns = []; continuation = null;
        pendingLabel = { field: "logoPreferences", label: "Logo preferences", lines: [rawLine] }; continue;
      }
      if (formDecoration(line) || formInstruction(line)) {
        continuation = null;
        if (pendingLabel?.field === "logoPreferences" && /^(?:colors,? design etc\.?|please let us know\.?$)/i.test(line) && pendingLabel.lines.length < 12) pendingLabel.lines.push(rawLine);
        else pendingLabel = null;
        continue;
      }
      if (section && /^(?:(?:residence|employment|job|row)\s*#?\s*\d+|\d+[.)])\s*:?$/i.test(line)) { flushHistory(); continue; }
      if (section && /\||\t| {2,}/.test(line) && !/:/.test(line)) {
        const cells = line.replace(/^\|\s*|\s*\|$/g, "").split(/\s*\|\s*|\t+| {2,}/).map(value => value.trim());
        const keys = cells.map(historyLabel);
        if (keys.every(Boolean) && keys.includes("from") && keys.includes("to") && new Set(keys).size === keys.length) { flushHistory(); columns = keys as string[]; columnLabels = cells; continue; }
        if (columns.length) {
          flushHistory();
          if (cells.length !== columns.length) { issue(page.page, `${fullLabels[section]} has a flattened or unclear table row. Enter it manually.`); continue; }
          history = { field: section, cells: Object.fromEntries(columns.map((key, index) => [key, cells[index]])), labels: Object.fromEntries(columns.map((key, index) => [key, columnLabels[index]])), quotes: [line], page };
          flushHistory(); continue;
        }
      }
      let match: string[] | null = /^([^:\t]{1,100}?)\s*(?::|\t+| {2,})\s*(.*?)\s*$/.exec(line);
      let scalarQuote = line;
      if (pendingLabel) {
        if (!match || !fullLabel(match[1])) {
          match = [line, pendingLabel.label, line];
          scalarQuote = [...pendingLabel.lines, rawLine].join("\n");
        }
        pendingLabel = null;
      }
      if (match) {
        const field = fullLabel(match[1]);
        const rowField = section ? historyLabel(match[1]) : undefined;
        const raw = match[2].replace(/^_+\s*|\s*_+$/g, "").trim();
        if (rowField && !field) {
          continuation = null;
          if (history?.cells[rowField] !== undefined) flushHistory();
          history ||= { field: section!, cells: {}, labels: {}, quotes: [], page };
          history.cells[rowField] = placeholder(raw) ? "" : raw; history.labels[rowField] = match[1]; history.quotes.push(line); continue;
        }
        if (field) {
          flushHistory(); section = null; columns = []; continuation = null;
          if (placeholder(raw)) { pendingLabel = { field, label: match[1], lines: [rawLine] }; continue; }
          if (unclear(raw) || /[<>\t]/.test(raw) || fullLabel(raw.replace(/:$/, "")) || /\b(?:ownership(?: choice| type)?|(?:owner )?business (?:name|status|reference)|logo preferences|additional notes)\s*(?::| {2,})/i.test(raw) || formInstruction(raw)) { issue(page.page, `${fullLabels[field]} is unclear or contains form instructions. Enter it manually.`); continue; }
          let value: string | null = raw;
          if (Object.hasOwn(JV_FIELD_LABELS, field)) {
            if (field === "dob") value = sourceDate(raw, match[1]);
            const verified = value !== null ? extractJVFields([{ ...page, text: `${JV_FIELD_LABELS[field as JVExtractField]}: ${value}` }])[0] : undefined;
            // Driver label uses a typographic apostrophe supported by the legacy parser.
            value = verified?.value ?? null;
          } else if (field === "ownershipType") value = election(raw, { individual: "individual", "in my name": "individual", "personal name": "individual", business: "business", "business name": "business" });
          else if (field === "businessStatus") value = election(raw, { existing: "existing", formed: "existing", forming: "forming", "not yet formed": "forming", "not applicable": "not-applicable", "not-applicable": "not-applicable" });
          if (value === null || raw.length > (field === "businessName" ? 200 : field === "businessReference" ? 2000 : 10000)) { issue(page.page, `${fullLabels[field]} is incomplete, ambiguous or invalid. Check the original and enter it manually.`); continue; }
          const added = add(field, value, scalarQuote, page);
          if (added && ["logoPreferences", "notes", "businessReference"].includes(field)) continuation = added;
          continue;
        }
      }
      const globalHeading = fullLabel(line.replace(/:$/, ""));
      if (globalHeading === "notes" || globalHeading === "logoPreferences") {
        flushHistory(); section = null; columns = []; continuation = null;
        issue(page.page, `${fullLabels[globalHeading]} uses an unlabeled multiline layout. Check the original and enter it manually.`); continue;
      }
      // Only indented continuations of explicit prose answers are safe to attach.
      if (continuation && /^\s{2,}\S/.test(rawLine) && !unclear(line) && !match && typeof continuation.value === "string" && continuation.value.length + line.length < (continuation.field === "businessReference" ? 2000 : 10000)) {
        continuation.value += `\n${line}`; continuation.quote += `\n${rawLine}`;
      } else {
        continuation = null;
        if (section || /(?:ownership|individual.*business|business.*individual|handwrit|illegible|unreadable)/i.test(line)) issue(page.page, "An ownership, history or handwriting section could not be read confidently. Review the original and enter unclear answers manually.");
      }
    }
  }
  flushHistory();
  const app = newJVApplication(); app.applicants = result.applicants.map(item => newJVApplicant(item.key));
  for (const candidate of result.candidates) {
    if (candidate.conflict) continue;
    if (!candidate.applicantKey) { if (candidate.field === "notes" || candidate.field === "logoPreferences") app[candidate.field] = candidate.value as string; continue; }
    const person = app.applicants.find(item => item.id === candidate.applicantKey)!;
    if (candidate.field === "residenceHistory") person.residenceHistory.push(candidate.value as JVResidence);
    else if (candidate.field === "employmentHistory") person.employmentHistory.push(candidate.value as JVEmployment);
    else Object.assign(person, { [candidate.field]: candidate.value });
  }
  result.missing = jvReadiness(app, today);
  if (!app.logoPreferences) result.missing.push("Logo / colors / design preferences were not found unambiguously.");
  if (!app.notes) result.missing.push("Additional notes were not found unambiguously.");
  return result;
}

/** Only explicitly reviewed candidates enter a draft. Conflicting answers require one choice. */
export function jvApplicationCandidatePatch(extraction: JVApplicationExtraction, reviewedIds: string[], targets: Record<string, string> = {}): JVApplicationFillPatch {
  const result: JVApplicationFillPatch = { applicants: [] };
  const selected = extraction.candidates.filter(candidate => reviewedIds.includes(candidate.id));
  const scalarTargets = new Set<string>();
  for (const candidate of selected) {
    if (typeof candidate.value === "string") {
      const target = `${candidate.applicantKey || "application"}:${candidate.field}`;
      if (scalarTargets.has(target)) throw new Error("Choose only one reviewed value for each field.");
      scalarTargets.add(target);
    }
    if (!candidate.applicantKey) {
      if (candidate.field === "logoPreferences" || candidate.field === "notes") result[candidate.field] = candidate.value as string;
      continue;
    }
    let entry = result.applicants.find(item => item.sourceApplicantKey === candidate.applicantKey);
    if (!entry) {
      entry = { sourceApplicantKey: candidate.applicantKey, label: extraction.applicants.find(item => item.key === candidate.applicantKey)!.label, patch: {}, ...(targets[candidate.applicantKey] ? { targetApplicantId: targets[candidate.applicantKey] } : {}) };
      result.applicants.push(entry);
    }
    if (candidate.field === "residenceHistory") (entry.patch.residenceHistory ||= []).push({ ...(candidate.value as JVResidence) });
    else if (candidate.field === "employmentHistory") (entry.patch.employmentHistory ||= []).push({ ...(candidate.value as JVEmployment) });
    else Object.assign(entry.patch, { [candidate.field]: candidate.value });
  }
  const mapped = result.applicants.map(item => item.targetApplicantId).filter(Boolean);
  if (new Set(mapped).size !== mapped.length) throw new Error("Map each source applicant to a different existing applicant or create a new one.");
  return result;
}
