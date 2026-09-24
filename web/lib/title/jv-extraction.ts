import type { JVApplicant } from "./jv-application";
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
