"use client";
import { useEffect, useRef, useState } from "react";
import { BookOpen, Copy, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getAsset, useWorkspace } from "@/lib/title/store";
import type { VaultDoc } from "@/lib/title/model";
import type { PdfTextReview } from "@/lib/title/pdf-text";

export function DocumentTextReview({ doc }: { doc: VaultDoc }) {
  const { s } = useWorkspace();
  const current = s.documents.find(d => d.id === doc.id && d.version === doc.version && d.assetId === doc.assetId);
  const [review, setReview] = useState<PdfTextReview | null>(null);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const [progress, setProgress] = useState("");
  const [pageNumber, setPageNumber] = useState(1), [selected, setSelected] = useState("");
  const controller = useRef<AbortController | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; controller.current?.abort(); };
  }, [current?.id, current?.version, current?.assetId]);
  if (!current?.assetId || current.mime !== "application/pdf") return null;
  const page = review?.pages.find(p => p.page === pageNumber);
  async function read() {
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    setBusy(true); setNotice(""); setReview(null); setSelected(""); setProgress("Opening document…");
    try {
      const blob = await getAsset(current!.assetId!);
      if (abort.signal.aborted) return;
      const { extractPdfText } = await import("@/lib/title/pdf-text");
      const result = await extractPdfText(blob, { signal: abort.signal,
        onProgress: (completed, total) => { if (alive.current && !abort.signal.aborted) setProgress(`Read ${completed} of ${total} pages`); } });
      if (alive.current && !abort.signal.aborted) { setReview(result); setPageNumber(result.pages[0]?.page || 1); }
    } catch {
      if (alive.current && !abort.signal.aborted) setNotice("The stored file could not be opened. Check that the original document is available.");
    } finally {
      if (alive.current && controller.current === abort) { setBusy(false); setProgress(""); }
    }
  }
  async function copy(text: string) {
    if (!text.trim() || !page) return;
    try {
      const { pdfPageCitation } = await import("@/lib/title/pdf-text");
      await navigator.clipboard.writeText(pdfPageCitation(current!, page.page, text));
      setNotice(`Copied text with the document version and PDF page ${page.page} reference.`);
    } catch { setNotice("Clipboard access was unavailable. Select and copy the text manually, keeping the document version and page reference."); }
  }
  return <section className="form-stack" aria-label="Document text review" style={{ padding: 16, border: "1px solid #dfe7ef", borderRadius: 12, background: "#f8fafc", color: "#18354b", gap: 12 }}>
    <h3 style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 15, fontWeight: 650 }}><BookOpen size={17} /> Read document text</h3>
    <p className="form-note">Read selectable PDF text locally, then copy an excerpt with its page reference. The original file and title fields stay unchanged.</p>
    <p className="form-note">Up to 25 MB and 120 pages. Text order can differ from the page layout; compare an excerpt with the original before using it.</p>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <Button variant="outline" size="sm" disabled={busy} onClick={() => void read()}><BookOpen size={15} />{busy ? "Reading document…" : review ? "Read document again" : "Read document text"}</Button>
      {busy && <Button variant="ghost" size="sm" onClick={() => { controller.current?.abort(); setBusy(false); setProgress(""); setNotice("Document text review was cancelled."); }}><X size={15} />Cancel</Button>}
    </div>
    {progress && <p role="status" className="form-note">{progress}</p>}
    {notice && <p role="status" className="form-note">{notice}</p>}
    {review && <div>
      <p role="status" className="form-note">{review.message}</p>
      {!!review.pages.length && <label className="field-label">PDF page<select style={{ padding: "8px 10px", border: "1px solid #dfe7ef", borderRadius: 8, color: "#18354b", background: "white" }} aria-label="PDF text page" value={pageNumber} onChange={event => { setPageNumber(Number(event.target.value)); setSelected(""); setNotice(""); }}>
        {review.pages.map(p => <option key={p.page} value={p.page}>Page {p.page} of {review.totalPages}{p.status === "empty" ? " · No selectable text" : ""}</option>)}
      </select></label>}
      {page && <>
        <p className="form-note"><strong>{doc.name}</strong> · Version {doc.version} · PDF page {page.page}</p>
        {page.text ? <>
          <label className="field-label">Select an excerpt<textarea aria-label="Extracted PDF page text" value={page.text} readOnly rows={8} style={{ width: "100%", boxSizing: "border-box", resize: "vertical", minHeight: 160, maxHeight: 320, padding: 12, border: "1px solid #dfe7ef", borderRadius: 8, lineHeight: 1.6, color: "#18354b" }} onSelect={event => {
            const target = event.currentTarget; setSelected(target.value.slice(target.selectionStart, target.selectionEnd));
          }} /></label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button variant="outline" size="sm" disabled={!selected.trim()} onClick={() => void copy(selected)}><Copy size={15} />Copy selected excerpt with source</Button>
            <Button variant="ghost" size="sm" onClick={() => void copy(page.text)}>Copy page text with source</Button>
          </div>
        </> : <p className="form-note">This page has no selectable text. Review its image above or use OCR before capturing evidence.</p>}
      </>}
    </div>}
  </section>;
}
