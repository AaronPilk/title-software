/** Application-only reading order. PDF paint order often puts completed answers last. */
export type PdfPositionedText = { str: string; transform: number[]; width: number; height: number; dir?: string };
type Run = { text: string; x: number; y: number; width: number; height: number };
export function applicationVisualText(items: unknown[]): string {
  if (items.length > 50_000) throw new Error("Too many form elements to read safely.");
  const runs: Run[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object" || !("str" in item)) continue;
    const t = item as PdfPositionedText;
    if (!t.str.trim()) continue;
    if (!Array.isArray(t.transform) || t.transform.length !== 6 || !t.transform.every(Number.isFinite) || !Number.isFinite(t.width) || !Number.isFinite(t.height) || t.height <= 0 || t.dir === "rtl" || Math.abs(t.transform[1]) > .1 || Math.abs(t.transform[2]) > .1 || t.transform[0] <= 0 || t.transform[3] <= 0)
      throw new Error("This application layout needs OCR or manual review.");
    runs.push({ text: t.str, x: t.transform[4], y: t.transform[5], width: t.width, height: t.height });
  }
  runs.sort((a,b) => b.y - a.y || a.x - b.x);
  const rows: { y: number; height: number; runs: Run[] }[] = [];
  for (const run of runs) {
    const row = rows.at(-1);
    if (row && Math.abs(row.y - run.y) <= Math.min(row.height, run.height) * .65) row.runs.push(run);
    else rows.push({ y: run.y, height: run.height, runs: [run] });
  }
  return rows.map(row => {
    row.runs.sort((a,b) => a.x - b.x);
    let text = "", prior: Run | undefined;
    for (const run of row.runs) {
      if (prior && Math.abs(run.x - prior.x) < 1 && Math.abs(run.y - prior.y) < 1 && run.text === prior.text) continue;
      const gap = prior ? run.x - prior.x - prior.width : 0;
      if (prior && gap < -Math.min(prior.height, run.height) * .3) throw new Error("Overlapping form answers need review against the original.");
      text += (prior ? gap > Math.max(prior.height, run.height) * 1.2 ? "\t" : gap > Math.min(prior.height, run.height) * .15 ? " " : "" : "") + run.text;
      prior = run;
    }
    return text.trim();
  }).join("\n");
}

/** Canonical widget values can differ from their rendered appearance. Read visible
 * filled forms with OCR instead of treating their metadata as the printed answer. */
export function applicationWidgetsNeedOcr(widgets: unknown[]): boolean {
  if (widgets.length > 2_000) throw new Error("Too many form elements to read safely.");
  return widgets.some(widget => {
    if (!widget || typeof widget !== "object") return false;
    const w = widget as { subtype?: string; fieldValue?: unknown; annotationFlags?: number };
    return w.subtype === "Widget" && !((w.annotationFlags || 0) & (1 | 2 | 32)) &&
      w.fieldValue !== undefined && w.fieldValue !== null && w.fieldValue !== "" && w.fieldValue !== "Off";
  });
}
