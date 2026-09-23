"use client";

import { useEffect, useId, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { prepareOcrRaster } from "@/lib/title/ocr-raster";
import { OcrError } from "@/lib/title/local-ocr-shared";
import { PACKAGE_SCAN_LIMITS } from "@/lib/title/package-scan";

const RENDER_DEADLINE_MS = 20_000;
type Preview = { file: Blob; page: number } & (
  { url: string; width: number; height: number; totalPages: number; error?: never }
  | { error: string; url?: never }
);

function failureMessage(error: unknown) {
  if (error instanceof OcrError) {
    if (error.code === "password") return "This PDF is password protected. Download it and use your approved document viewer.";
    if (error.code === "size") return "The page preview supports PDFs up to 25 MB. Download the original to view this file.";
    if (error.code === "page") return "That physical page is unavailable. Choose an existing page below, or download the original. Page previews support PDFs up to 1,000 pages.";
  }
  return "This page could not be previewed. Download the original and open it in your approved document viewer.";
}

/** One physical page at a time; the document is never embedded as an active browser document. */
export function PdfPreview({ file, name, initialPage = 1 }: { file: Blob; name: string; initialPage?: number }) {
  const pageRegion = useId();
  const requestedPage = Number.isSafeInteger(initialPage) && initialPage >= 1 && initialPage <= PACKAGE_SCAN_LIMITS.pages ? initialPage : 1;
  const [selection, setSelection] = useState(() => ({ file, initialPage: requestedPage, page: requestedPage }));
  const page = selection.file === file && selection.initialPage === requestedPage ? selection.page : requestedPage;
  const [jump, setJump] = useState(() => ({ file, page, value: String(page) }));
  const jumpValue = jump.file === file && jump.page === page ? jump.value : String(page);
  const [metadata, setMetadata] = useState<{ file: Blob; totalPages: number } | null>(null);
  const totalPages = metadata?.file === file ? metadata.totalPages : undefined;
  const [preview, setPreview] = useState<Preview | null>(null);
  const current = preview?.file === file && preview.page === page ? preview : null;
  const loading = !current;

  useEffect(() => {
    const controller = new AbortController();
    let active = true, imageUrl = "", timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
      if (active) setPreview({ file, page, error: "This page took too long to preview. Download the original or try a smaller copy." });
    }, RENDER_DEADLINE_MS);
    void prepareOcrRaster(file, page, controller.signal, undefined, undefined, true)
      .then((raster) => {
        if (!active || controller.signal.aborted) return;
        const totalPages = raster.totalPages ?? 1;
        if (!Number.isSafeInteger(totalPages) || totalPages < page || totalPages > PACKAGE_SCAN_LIMITS.pages)
          throw new Error("Invalid PDF page count");
        imageUrl = URL.createObjectURL(raster.image);
        setPreview({ file, page, url: imageUrl, width: raster.width, height: raster.height, totalPages });
        setMetadata({ file, totalPages });
      })
      .catch((error: unknown) => {
        if (active && !controller.signal.aborted && !timedOut)
          setPreview({ file, page, error: failureMessage(error) });
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
  }, [file, page]);

  const rendered = current && !current.error && current.url ? current : null;
  const selectedPage = Number(jumpValue);
  const validJump = /^\d+$/.test(jumpValue) && Number.isSafeInteger(selectedPage) && selectedPage >= 1 && selectedPage <= (totalPages || PACKAGE_SCAN_LIMITS.pages);
  function goTo(target: number) {
    setSelection({ file, initialPage: requestedPage, page: target });
    setJump({ file, page: target, value: String(target) });
  }
  return <section aria-label={`${name} PDF preview`} style={{ minWidth: 0 }}>
    <div role="group" aria-label="PDF page navigation" style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "center", flexWrap: "wrap", padding: "12px 0" }}>
      <Button type="button" variant="outline" size="sm" aria-label="Previous PDF page" aria-controls={pageRegion} disabled={loading || page <= 1} onClick={() => goTo(page - 1)}><ChevronLeft aria-hidden="true" /> Previous</Button>
      <span role="status" aria-live="polite" style={{ fontSize: 13 }}>{rendered ? `Page ${page} of ${rendered.totalPages}` : `Page ${page}`}</span>
      <Button type="button" variant="outline" size="sm" aria-label="Next PDF page" aria-controls={pageRegion} disabled={!rendered || page >= rendered.totalPages} onClick={() => goTo(page + 1)}>Next <ChevronRight aria-hidden="true" /></Button>
      <form onSubmit={event => { event.preventDefault(); if (!loading && validJump) goTo(selectedPage); }} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
        <label htmlFor={`${pageRegion}-jump`} style={{ fontSize: 13 }}>Go to page</label>
        <Input id={`${pageRegion}-jump`} aria-label="PDF page number" aria-controls={pageRegion} aria-invalid={!validJump} type="number" min={1} max={totalPages || PACKAGE_SCAN_LIMITS.pages} step={1} inputMode="numeric" value={jumpValue} onChange={event => setJump({ file, page, value: event.target.value })} disabled={loading} style={{ width: 82, fontSize: 16 }} />
        <Button type="submit" variant="outline" size="sm" disabled={loading || !validJump}>Go</Button>
      </form>
    </div>
    <div key={rendered?.url || page} id={pageRegion} aria-busy={loading} style={{ maxHeight: "60vh", minHeight: 220, overflow: "auto", border: "1px solid #dfe4eb", borderRadius: 8, background: "#eef1f5", padding: 12 }}>
      {loading ? <p role="status" style={{ padding: 24, textAlign: "center" }}>Preparing page {page}…</p>
        : current?.error ? <p role="alert" style={{ padding: 24, textAlign: "center" }}>{current.error}</p>
          : rendered ? (
            // eslint-disable-next-line @next/next/no-img-element -- This short-lived local Blob cannot use a remote image optimizer.
            <img src={rendered.url} alt={`${name}, page ${page} of ${rendered.totalPages}`} width={rendered.width} height={rendered.height} style={{ display: "block", width: "100%", height: "auto", background: "white" }} />
          ) : null}
    </div>
    <p style={{ color: "var(--muted-foreground)", fontSize: 12, lineHeight: 1.5, marginTop: 10 }}>This is a page image preview. Use Download to open or read the original PDF in your preferred viewer.</p>
  </section>;
}
