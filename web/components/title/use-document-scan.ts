"use client";
import { useEffect, useRef, useState } from "react";
import { getAsset } from "@/lib/title/store";
import type { VaultDoc } from "@/lib/title/model";
import type { OcrRotation } from "@/lib/title/local-ocr";
import type { SourceReadResult } from "@/lib/title/source-field-reader";

/** Keep capture forms and their scanner mounted under exactly the same scope. */
export function documentScanIdentity(doc: VaultDoc, connection?: { workspaceId: string; access: { userId: string; version: number } } | null) {
  return JSON.stringify([connection?.workspaceId || "local", connection?.access.userId, connection?.access.version, doc.id, doc.version, doc.name, doc.assetId ? null : doc.text, doc.assetId, doc.mime, doc.visibility, doc.sourceRole, doc.companyId, doc.orderId]);
}

/** Mount this hook in an identity-keyed child. Nothing is persisted outside that session. */
export function useDocumentScan(doc: VaultDoc, identity: string, onActivityChange?: (busy: boolean) => void) {
  const [result, setResult] = useState<SourceReadResult | null>(null);
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState(""), [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null), alive = useRef(true);
  const original = useRef<Blob | undefined>(undefined), latest = useRef<SourceReadResult | null>(null);
  const activity = useRef(onActivityChange);
  useEffect(() => { activity.current = onActivityChange; }, [onActivityChange]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); original.current = undefined; latest.current = null; }; }, []);
  async function read(scanPages = "", rotation: OcrRotation = 0) {
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    const active = () => alive.current && controller.current === abort && !abort.signal.aborted;
    setBusy(true); setError(""); setProgress("Opening the original…"); activity.current?.(true);
    try {
      if (doc.assetId && !original.current) {
        const blob = await getAsset(doc.assetId);
        if (!active()) return;
        original.current = blob;
      }
      const { readFieldSource } = await import("@/lib/title/source-field-reader");
      if (!active()) return;
      const publish = (next: SourceReadResult) => { if (active()) { latest.current = next; setResult(next); } };
      const next = await readFieldSource(doc, original.current, {
        signal: abort.signal, scanPages, rotation, sourceIdentity: identity,
        priorResult: latest.current || undefined, onSnapshot: publish,
        onProgress: message => { if (active()) setProgress(message); },
      });
      publish(next);
      // The engine emits its own authenticated cancellation snapshot. Ignore any
      // late successful response, and never replace a newer run's state.
      if (alive.current && controller.current === abort && abort.signal.aborted && next.status === "cancelled") {
        latest.current = next; setResult(next);
      }
    } catch (reason) {
      if (active()) setError(reason instanceof Error ? reason.message : "The original could not be read. Review it manually or retry.");
    } finally {
      if (active()) { setBusy(false); setProgress(""); activity.current?.(false); }
    }
  }
  function cancel() {
    controller.current?.abort(); setBusy(false); setProgress(""); activity.current?.(false);
    setError("Reading cancelled. Completed pages are retained in this open review. Resume to read unfinished pages.");
  }
  return { result, busy, progress, error, read, cancel };
}
