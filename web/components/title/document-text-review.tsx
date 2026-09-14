"use client";
import { useEffect, useRef, useState } from "react";
import { BookOpen, Copy, ScanText, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getAsset, useWorkspace } from "@/lib/title/store";
import type { VaultDoc } from "@/lib/title/model";
import type { PdfTextReview } from "@/lib/title/pdf-text";
import type { OcrResult, OcrRotation } from "@/lib/title/local-ocr";

const textStyle = { width: "100%", boxSizing: "border-box" as const, resize: "vertical" as const, minHeight: 160, maxHeight: 320, padding: 12, border: "1px solid #dfe7ef", borderRadius: 8, lineHeight: 1.6, color: "#18354b" };
const rowStyle = { display: "flex", gap: 8, flexWrap: "wrap" as const };
export function DocumentTextReview({ doc }: { doc: VaultDoc }) {
  const { s } = useWorkspace();
  const current = s.documents.find(d => d.id === doc.id && d.version === doc.version && d.assetId === doc.assetId);
  const [review, setReview] = useState<PdfTextReview | null>(null);
  const [ocrPages, setOcrPages] = useState<Record<number, OcrResult>>({});
  const [busy, setBusy] = useState<"text" | "ocr" | null>(null), [notice, setNotice] = useState("");
  const [progress, setProgress] = useState("");
  const [pageNumber, setPageNumber] = useState(1), [selected, setSelected] = useState(""), [ocrSelected, setOcrSelected] = useState("");
  const [rotation, setRotation] = useState<OcrRotation>(0);
  const [verified, setVerified] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; controller.current?.abort(); };
  }, [current?.id, current?.version, current?.assetId]);
  if (!current?.assetId || !["application/pdf", "image/png", "image/jpeg"].includes(current.mime || "")) return null;
  const pdf = current.mime === "application/pdf", page = review?.pages.find(p => p.page === pageNumber);
  const savedOcr = ocrPages[pageNumber], ocr = savedOcr && (savedOcr.rotation || 0) === rotation ? savedOcr : undefined;
  function changePage(value: number) { setPageNumber(value); setRotation(0); setSelected(""); setOcrSelected(""); setNotice(""); setVerified(false); }
  function changeRotation(value: OcrRotation) { setRotation(value); setOcrSelected(""); setNotice(""); setVerified(false); }
  function begin(kind: "text" | "ocr") {
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    setBusy(kind); setNotice(""); setSelected(""); setOcrSelected(""); setVerified(false); setProgress("Opening document…"); return abort;
  }
  async function read() {
    const abort = begin("text"); setReview(null);
    try {
      const blob = await getAsset(current!.assetId!); if (abort.signal.aborted) return;
      const { extractPdfText } = await import("@/lib/title/pdf-text");
      const result = await extractPdfText(blob, { signal: abort.signal,
        onProgress: (completed, total) => { if (alive.current && !abort.signal.aborted) setProgress(`Read ${completed} of ${total} pages`); } });
      if (alive.current && !abort.signal.aborted) { setReview(result); setPageNumber(result.pages[0]?.page || 1); setRotation(0); }
    } catch { if (alive.current && !abort.signal.aborted) setNotice("The stored file could not be opened. Check that the original document is available."); }
    finally { if (alive.current && controller.current === abort) { setBusy(null); setProgress(""); } }
  }
  async function scan() {
    const abort = begin("ocr"), targetPage = pageNumber;
    try {
      const blob = await getAsset(current!.assetId!); if (abort.signal.aborted) return;
      const { recognizeDocumentPage, OcrError } = await import("@/lib/title/local-ocr");
      // The stored MIME is part of the document's immutable asset record.
      const typed = blob.type === current!.mime ? blob : new Blob([blob], { type: current!.mime });
      try {
        const result = await recognizeDocumentPage(typed, targetPage, { signal: abort.signal, rotation, onProgress: update => {
          if (alive.current && !abort.signal.aborted) setProgress(`${update.phase}… ${Math.round(update.progress * 100)}%`);
        } });
        if (alive.current && !abort.signal.aborted) { setOcrPages(previous => ({ ...previous, [targetPage]: result })); setNotice(result.text ? "OCR is ready. Compare names, amounts and legal wording with the original before copying." : "No text was recognized. Review the original or try a clearer scan."); }
      } catch (error) { if (alive.current && !abort.signal.aborted) setNotice(error instanceof OcrError ? error.message : "OCR could not read this page. Review the original document."); }
    } catch { if (alive.current && !abort.signal.aborted) setNotice("The stored file could not be opened. Check that the original document is available."); }
    finally { if (alive.current && controller.current === abort) { setBusy(null); setProgress(""); } }
  }
  async function copy(text: string, fromOcr = false) {
    if (!text.trim() || (fromOcr && (!ocr || !verified)) || (!fromOcr && !page)) return;
    try {
      const citation = fromOcr ? (await import("@/lib/title/local-ocr")).ocrCitation(current!, ocr!, text) : (await import("@/lib/title/pdf-text")).pdfPageCitation(current!, page!.page, text);
      await navigator.clipboard.writeText(citation);
      setNotice(`Copied ${fromOcr ? "reviewed OCR" : "text"} with the document version and ${pdf ? `PDF page ${pageNumber}` : "image"} reference.`);
    } catch { setNotice("Clipboard access was unavailable. Select and copy the text manually, keeping the document version and page reference."); }
  }
  return <section className="form-stack" aria-label="Document text review" style={{ padding: 16, border: "1px solid #dfe7ef", borderRadius: 12, background: "#f8fafc", color: "#18354b", gap: 12 }}>
    <h3 style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 15, fontWeight: 650 }}><BookOpen size={17} /> Read document text</h3>
    <p className="form-note">{pdf ? "Read selectable text or recognize a scanned page with OCR." : "Recognize the printed text in this image with OCR."} Processing stays in your browser. Copy a reviewed excerpt with its source; title fields and the original file stay unchanged.</p>
    <p className="form-note">OCR reads one selected page at a time in English. Up to 25 MB, 120 PDF pages, or a 12-megapixel PNG/JPEG. Handwriting, faint scans and complex tables need manual review.</p>
    {pdf && <div style={rowStyle}><Button variant="outline" size="sm" disabled={!!busy} onClick={() => void read()}><BookOpen size={15} />{busy === "text" ? "Reading document…" : review ? "Read document again" : "Read document text"}</Button></div>}
    {review && <p role="status" className="form-note">{review.message}</p>}
    {pdf && <label className="field-label">PDF page{review?.pages.length ? <select disabled={!!busy} style={{ padding: "8px 10px", border: "1px solid #dfe7ef", borderRadius: 8, color: "#18354b", background: "white" }} aria-label="PDF text page" value={pageNumber} onChange={event => changePage(Number(event.target.value))}>
      {review.pages.map(p => <option key={p.page} value={p.page}>Page {p.page} of {review.totalPages}{p.status === "empty" ? " · No selectable text" : ""}{ocrPages[p.page] ? " · OCR available" : ""}</option>)}
    </select> : <input aria-label="PDF page for OCR" type="number" min={1} max={120} value={pageNumber} disabled={!!busy} onChange={event => changePage(Number(event.target.value))} style={{ width: 100, padding: 8, border: "1px solid #dfe7ef", borderRadius: 8 }} />}</label>}
    <p className="form-note"><strong>{doc.name}</strong> · Version {doc.version} · {pdf ? `PDF page ${pageNumber}` : "Image 1"}</p>
    {page?.text && <div className="form-stack">
      <label className="field-label">Selectable PDF text<textarea aria-label="Extracted PDF page text" value={page.text} readOnly rows={8} style={textStyle} onSelect={event => { const target = event.currentTarget; setSelected(target.value.slice(target.selectionStart, target.selectionEnd)); }} /></label>
      <p className="form-note">Text order can differ from the page layout. Compare your excerpt with the original.</p>
      <div style={rowStyle}>
        <Button variant="outline" size="sm" disabled={!selected.trim()} onClick={() => void copy(selected)}><Copy size={15} />Copy selected excerpt with source</Button>
        <Button variant="ghost" size="sm" onClick={() => void copy(page.text)}>Copy page text with source</Button>
      </div>
    </div>}
    {page?.status === "empty" && <p className="form-note">This page has no selectable text. Use OCR below to read its scanned image.</p>}
    <label className="field-label">Page orientation for OCR<select aria-label="Page orientation for OCR" disabled={!!busy} value={rotation} onChange={event => changeRotation(Number(event.target.value) as OcrRotation)} style={{ padding: "8px 10px", border: "1px solid #dfe7ef", borderRadius: 8, background: "white", color: "#18354b" }}>
      <option value="0">As stored</option><option value="90">Turn right (90°)</option><option value="180">Turn upside down (180°)</option><option value="270">Turn left (90°)</option>
    </select></label>
    <p className="form-note">If a scan is upside down or reads incorrectly, choose the turn needed to make it upright, then run OCR. The stored original stays unchanged.</p>
    <div style={rowStyle}>
      <Button variant="outline" size="sm" disabled={!!busy || !Number.isSafeInteger(pageNumber) || pageNumber < 1 || pageNumber > 120} onClick={() => void scan()}><ScanText size={15} />{busy === "ocr" ? "Recognizing text…" : ocr ? "Run OCR again" : pdf ? "Read this page with OCR" : "Read image with OCR"}</Button>
      {busy && <Button variant="ghost" size="sm" onClick={() => { controller.current?.abort(); setBusy(null); setProgress(""); setNotice("Document text review was cancelled."); }}><X size={15} />Cancel</Button>}
    </div>
    {progress && <p role="status" className="form-note" aria-live="polite">{progress}</p>}
    {notice && <p role="status" className="form-note">{notice}</p>}
    {ocr && <div className="form-stack" aria-label="OCR review result">
      <p className="form-note"><strong>OCR result · {Math.round(ocr.confidence)}/100 engine confidence</strong>{ocr.rotation ? <> · Rotated {ocr.rotation}° clockwise</> : null}<br />This score is an engine estimate, not an accuracy guarantee. Review each excerpt against the original.</p>
      {ocr.text && <>
        <label className="field-label">Recognized text<textarea aria-label="Recognized OCR page text" value={ocr.text} readOnly rows={8} style={textStyle} onSelect={event => { const target = event.currentTarget; setOcrSelected(target.value.slice(target.selectionStart, target.selectionEnd)); }} /></label>
        <details><summary style={{ cursor: "pointer", fontSize: 13 }}>Word confidence ({ocr.words.filter(word => word.confidence < 80).length} below 80)</summary>
          <p className="form-note">Lowest-confidence words first. Position is measured in the rendered {ocr.width} × {ocr.height} pixel page. Showing up to 200 words.</p>
          <div style={{ maxHeight: 220, overflow: "auto" }}><table style={{ width: "100%", fontSize: 12 }}><thead><tr><th align="left">Word</th><th align="left">Confidence</th><th align="left">Position</th></tr></thead><tbody>{[...ocr.words].sort((a,b) => a.confidence - b.confidence).slice(0,200).map((word,index) => <tr key={index}><td>{word.text}</td><td>{Math.round(word.confidence)}/100</td><td>{word.box.x0}, {word.box.y0}</td></tr>)}</tbody></table></div>
        </details>
        <label className="form-note" style={{ display: "flex", alignItems: "flex-start", gap: 8 }}><input type="checkbox" checked={verified} onChange={event => setVerified(event.target.checked)} />I compared this OCR result with the original document.</label>
        <div style={rowStyle}><Button variant="outline" size="sm" disabled={!verified || !ocrSelected.trim()} onClick={() => void copy(ocrSelected, true)}><Copy size={15} />Copy reviewed OCR excerpt with source</Button><Button variant="ghost" size="sm" disabled={!verified} onClick={() => void copy(ocr.text, true)}>Copy reviewed OCR page with source</Button></div>
      </>}
    </div>}
  </section>;
}
