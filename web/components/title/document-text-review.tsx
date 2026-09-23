"use client";
import { useEffect, useRef, useState } from "react";
import { BookOpen, Copy, ScanText, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/lib/title/store";
import type { VaultDoc } from "@/lib/title/model";
import type { OcrRotation } from "@/lib/title/local-ocr";
import { ocrCitation } from "@/lib/title/local-ocr-shared";
import { pdfPageCitation } from "@/lib/title/pdf-text";
import { documentScanIdentity, useDocumentScan } from "./use-document-scan";
import { DocumentScanStatus } from "./document-scan-status";

const textStyle = { width: "100%", boxSizing: "border-box" as const, resize: "vertical" as const, minHeight: 160, maxHeight: 320, padding: 12, border: "1px solid #dfe7ef", borderRadius: 8, lineHeight: 1.6, color: "#18354b" };
const rowStyle = { display: "flex", gap: 8, flexWrap: "wrap" as const };
export function DocumentTextReview({ doc }: { doc: VaultDoc }) {
  const { s, connection } = useWorkspace();
  const current = s.documents.find(d => d.id === doc.id && d.version === doc.version && d.assetId === doc.assetId && d.mime === doc.mime && d.visibility === doc.visibility && d.companyId === doc.companyId && d.orderId === doc.orderId && d.sourceRole === doc.sourceRole);
  const identity = documentScanIdentity(doc, connection);
  if (!current?.assetId || !["application/pdf", "image/png", "image/jpeg"].includes(current.mime || "")) return null;
  return <DocumentTextSession key={identity} doc={current} identity={identity} />;
}
function DocumentTextSession({ doc, identity }: { doc: VaultDoc; identity: string }) {
  const [notice, setNotice] = useState(""), [pageNumber, setPageNumber] = useState(1);
  const [selected, setSelected] = useState(""), [ocrSelected, setOcrSelected] = useState("");
  const [rotation, setRotation] = useState<OcrRotation>(0), [verified, setVerified] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const scan = useDocumentScan(doc, identity, () => { setVerified(false); setSelected(""); setOcrSelected(""); setNotice(""); });
  const { busy, result } = scan, pdf = doc.mime === "application/pdf";
  const page = result?.pages.find(p => p.page === pageNumber), ocr = page?.ocr;
  function changePage(value: number) { setPageNumber(value); setRotation(0); setSelected(""); setOcrSelected(""); setNotice(""); setVerified(false); }
  function changeRotation(value: OcrRotation) { setRotation(value); setOcrSelected(""); setNotice(""); setVerified(false); }
  async function copy(text: string, fromOcr = false) {
    if (busy || !text.trim() || !page || !page.text.includes(text) || (fromOcr && (!ocr || !verified))) return;
    try {
      const citation = fromOcr ? ocrCitation(doc, ocr!, text) : pdfPageCitation(doc, page.page, text);
      await navigator.clipboard.writeText(citation);
      if (alive.current) setNotice(`Copied ${fromOcr ? "reviewed OCR" : "text"} with the document version and ${pdf ? `PDF page ${pageNumber}` : "image"} reference.`);
    } catch { if (alive.current) setNotice("Clipboard access was unavailable. Select and copy the text manually, keeping the document version and page reference."); }
  }
  return <section className="form-stack document-scan-review" aria-label="Document text review" style={{ padding: 16, border: "1px solid #dfe7ef", borderRadius: 12, background: "#f8fafc", color: "#18354b", gap: 12 }}>
    <h3 style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 15, fontWeight: 650 }}><BookOpen size={17} /> Read document text</h3>
    <p className="form-note">{pdf ? "Read the whole document: selectable text and scanned pages are combined automatically." : "Recognize the printed text in this image with OCR."} Processing stays in your browser. Copy a reviewed excerpt with its source; title fields and the original file stay unchanged.</p>
    <p className="form-note">Up to 25 MB and 120 PDF pages, or a 12-megapixel PNG/JPEG. Scanned pages are processed one after another in English. Handwriting, faint scans and complex tables need manual review.</p>
    <div style={rowStyle}>
      <Button variant="outline" size="sm" disabled={busy} onClick={() => void scan.read("", 0)}><BookOpen size={15} />{busy ? "Reading document…" : pdf ? "Read whole document" : "Read image with OCR"}</Button>
      {busy && <Button variant="ghost" size="sm" onClick={scan.cancel}><X size={15} />Cancel</Button>}
    </div>
    <DocumentScanStatus {...scan} onResume={() => void scan.read("", 0)} />
    {pdf && <label className="field-label">PDF page{result?.totalPages ? <select disabled={busy} style={{ padding: "8px 10px", border: "1px solid #dfe7ef", borderRadius: 8, color: "#18354b", background: "white" }} aria-label="PDF text page" value={pageNumber} onChange={event => changePage(Number(event.target.value))}>
      {Array.from({ length: result.totalPages }, (_, index) => { const number = index + 1, found = result.pages.find(p => p.page === number); return <option key={number} value={number}>Page {number} of {result.totalPages}{found?.method === "ocr" ? " · OCR available" : found ? " · Text available" : " · Unread"}</option>; })}
    </select> : <input aria-label="PDF page for OCR" type="number" min={1} max={120} value={pageNumber} disabled={busy} onChange={event => changePage(Number(event.target.value))} style={{ width: 100, padding: 8, border: "1px solid #dfe7ef", borderRadius: 8 }} />}</label>}
    <p className="form-note"><strong>{doc.name}</strong> · Version {doc.version} · {pdf ? `PDF page ${pageNumber}` : "Image 1"}</p>
    {page?.method === "pdf-text" && <div className="form-stack">
      <label className="field-label">Selectable PDF text<textarea aria-label="Extracted PDF page text" value={page.text} readOnly rows={8} style={textStyle} onSelect={event => { if (!busy) { const target = event.currentTarget; setSelected(target.value.slice(target.selectionStart, target.selectionEnd)); } }} /></label>
      <p className="form-note">Text order can differ from the page layout. Compare your excerpt with the original.</p>
      <div style={rowStyle}>
        <Button variant="outline" size="sm" disabled={busy || !selected.trim()} onClick={() => void copy(selected)}><Copy size={15} />Copy selected excerpt with source</Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void copy(page.text)}>Copy page text with source</Button>
      </div>
    </div>}
    {result && !page && <p className="form-note">This page is unread. Resume unfinished pages, or choose its orientation and retry this page below.</p>}
    <label className="field-label">Page orientation for OCR<select aria-label="Page orientation for OCR" disabled={busy} value={rotation} onChange={event => changeRotation(Number(event.target.value) as OcrRotation)} style={{ padding: "8px 10px", border: "1px solid #dfe7ef", borderRadius: 8, background: "white", color: "#18354b" }}>
      <option value="0">As stored</option><option value="90">Turn right (90°)</option><option value="180">Turn upside down (180°)</option><option value="270">Turn left (90°)</option>
    </select></label>
    <p className="form-note">If a scan is upside down or reads incorrectly, choose the turn needed to make it upright, then rerun this page. Other completed pages are retained. The stored original stays unchanged.</p>
    <div style={rowStyle}>
      <Button variant="outline" size="sm" disabled={busy || !Number.isSafeInteger(pageNumber) || pageNumber < 1 || pageNumber > 120} onClick={() => void scan.read(String(pageNumber), rotation)}><ScanText size={15} />{ocr ? "Run OCR again" : pdf ? "Read this page with OCR" : "Rerun image OCR"}</Button>
    </div>
    {notice && <p role="status" className="form-note">{notice}</p>}
    {ocr && <div className="form-stack" aria-label="OCR review result">
      <p className="form-note"><strong>OCR result · {Math.round(ocr.confidence)}/100 engine confidence</strong>{ocr.rotation ? <> · Rotated {ocr.rotation}° clockwise</> : null}<br />This score is an engine estimate, not an accuracy guarantee. Review each excerpt against the original.</p>
      {ocr.text && <>
        <label className="field-label">Recognized text<textarea aria-label="Recognized OCR page text" value={ocr.text} readOnly rows={8} style={textStyle} onSelect={event => { if (!busy) { const target = event.currentTarget; setOcrSelected(target.value.slice(target.selectionStart, target.selectionEnd)); } }} /></label>
        <details><summary style={{ cursor: "pointer", fontSize: 13 }}>Word confidence</summary>
          <p className="form-note">Lowest-confidence words first. Position is measured in the rendered {ocr.width} × {ocr.height} pixel page. Showing up to 200 of {page?.ocrWordCount ?? ocr.words.length} recognized words.</p>
          <div style={{ maxHeight: 220, overflow: "auto" }}><table style={{ width: "100%", fontSize: 12 }}><thead><tr><th align="left">Word</th><th align="left">Confidence</th><th align="left">Position</th></tr></thead><tbody>{[...ocr.words].sort((a,b) => a.confidence - b.confidence).slice(0,200).map((word,index) => <tr key={index}><td>{word.text}</td><td>{Math.round(word.confidence)}/100</td><td>{word.box.x0}, {word.box.y0}</td></tr>)}</tbody></table></div>
        </details>
        <label className="form-note" style={{ display: "flex", alignItems: "flex-start", gap: 8 }}><input type="checkbox" checked={verified} disabled={busy} onChange={event => setVerified(event.target.checked)} />I compared this OCR result with the original document.</label>
        <div style={rowStyle}><Button variant="outline" size="sm" disabled={busy || !verified || !ocrSelected.trim()} onClick={() => void copy(ocrSelected, true)}><Copy size={15} />Copy reviewed OCR excerpt with source</Button><Button variant="ghost" size="sm" disabled={busy || !verified} onClick={() => void copy(ocr.text, true)}>Copy reviewed OCR page with source</Button></div>
      </>}
    </div>}
  </section>;
}
