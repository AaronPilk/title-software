"use client";
import { Button } from "@/components/ui/button";
import type { SourceReadResult } from "@/lib/title/source-field-reader";
export function DocumentScanStatus({ result, busy, progress, error, onResume }: { result: SourceReadResult | null; busy: boolean; progress: string; error: string; onResume: () => void }) {
  const knownCount = !!result && result.totalPages > 0;
  const complete = !busy && knownCount && result?.status === "complete" && result.pages.length === result.totalPages && !result.unreadPages.length;
  const canResume = !busy && result && (!knownCount || result.status === "cancelled" || !!result.unreadPages.length);
  return <div className="form-stack document-scan-status" aria-live="polite">
    {progress && <p role="status">{progress}</p>}
    {result && <>
      <label className="field-label">Document reading progress<progress aria-label="Document reading progress" value={knownCount ? result.pages.length : undefined} max={Math.max(result.totalPages, 1)} style={{ width: "100%" }} /></label>
      <p role="status">{knownCount ? <>Read {result.pages.length} of {result.totalPages} page(s).{complete ? " All pages are ready for review." : ""}</> : busy ? "Counting document pages…" : "The page count is incomplete. Resume reading to count and read the document."}</p>
      {!!result.unreadPages.length && <p className="form-note">Unread pages: {result.unreadPages.join(", ")}. {busy ? "Reading continues automatically." : "Results are incomplete. Resume reading or review these pages in the original."}</p>}
      {!!result.issues?.length && <details open><summary>Pages needing attention ({result.issues.length})</summary><ul>{result.issues.map(issue => <li key={issue.page}>Page {issue.page}: {issue.message}</li>)}</ul></details>}
      {result.notes.map(note => <p className="form-note" key={note}>{note}</p>)}
      {canResume && <Button type="button" variant="outline" onClick={onResume}>Resume / retry unread pages</Button>}
    </>}
    {error && <p role="alert">{error}</p>}
    <p className="form-note">Completed pages stay available while this review is open. Closing it, reloading, or changing accounts clears the scan session. Saved source fields and original files remain unchanged.</p>
  </div>;
}
