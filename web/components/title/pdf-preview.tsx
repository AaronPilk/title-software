"use client";

import { useEffect, useId, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { prepareOcrRaster } from "@/lib/title/ocr-raster";
import { OCR_LIMITS, OcrError } from "@/lib/title/local-ocr-shared";

const RENDER_DEADLINE_MS = 20_000;
type Preview = { file: Blob; page: number } & (
  { url: string; width: number; height: number; totalPages: number; error?: never }
  | { error: string; url?: never }
);

function failureMessage(error: unknown) {
  if (error instanceof OcrError) {
    if (error.code === "password") return "This PDF is password protected. Download it and use your approved document viewer.";
    if (error.code === "size") return "The page preview supports PDFs up to 25 MB. Download the original to view this file.";
    if (error.code === "page") return "The page preview supports PDFs up to 120 pages. Download the original to view this file.";
  }
  return "This page could not be previewed. Download the original and open it in your approved document viewer.";
}

/** One physical page at a time; the document is never embedded as an active browser document. */
export function PdfPreview({ file, name }: { file: Blob; name: string }) {
  const pageRegion = useId();
  const [selection, setSelection] = useState(() => ({ file, page: 1 }));
  const page = selection.file === file ? selection.page : 1;
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
    void prepareOcrRaster(file, page, controller.signal)
      .then((raster) => {
        if (!active || controller.signal.aborted) return;
        const totalPages = raster.totalPages ?? 1;
        if (!Number.isSafeInteger(totalPages) || totalPages < page || totalPages > OCR_LIMITS.pages)
          throw new Error("Invalid PDF page count");
        imageUrl = URL.createObjectURL(raster.image);
        setPreview({ file, page, url: imageUrl, width: raster.width, height: raster.height, totalPages });
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
  return <section aria-label={`${name} PDF preview`} style={{ minWidth: 0 }}>
    <div role="group" aria-label="PDF page navigation" style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "center", flexWrap: "wrap", padding: "12px 0" }}>
      <Button type="button" variant="outline" size="sm" aria-label="Previous PDF page" aria-controls={pageRegion} disabled={loading || page <= 1} onClick={() => setSelection({ file, page: page - 1 })}><ChevronLeft aria-hidden="true" /> Previous</Button>
      <span role="status" aria-live="polite" style={{ fontSize: 13 }}>{rendered ? `Page ${page} of ${rendered.totalPages}` : `Page ${page}`}</span>
      <Button type="button" variant="outline" size="sm" aria-label="Next PDF page" aria-controls={pageRegion} disabled={!rendered || page >= rendered.totalPages} onClick={() => setSelection({ file, page: page + 1 })}>Next <ChevronRight aria-hidden="true" /></Button>
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
