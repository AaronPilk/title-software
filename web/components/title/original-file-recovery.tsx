"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "../ui/button";
import { download, useWorkspace } from "@/lib/title/store";
import { backendRequest, downloadRemoteAsset } from "@/lib/backend/client";
import { MAX_BACKUP_FILE_BYTES } from "@/lib/title/backup-assets";
import { createOriginalsArchive, recoverArchivedOriginal, verifyOriginalsArchive, type OriginalsArchive } from "@/lib/title/originals-archive";

const controlWidth = { minWidth: 0, width: "100%", maxWidth: "100%" };

export function OriginalFileRecovery({ workspaceId }: { workspaceId: string }) {
  const { s, connection } = useWorkspace();
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [archive, setArchive] = useState<OriginalsArchive | null>(null), [selected, setSelected] = useState("");
  const [exportId, setExportId] = useState("");
  const operation = useRef<AbortController | null>(null);
  const available = s.documents.filter(doc => doc.assetId);
  const exportDocuments = available.filter(doc => !exportId || doc.id === exportId);
  useEffect(() => () => { operation.current?.abort(); }, [workspaceId, connection?.revision]);
  async function run(action: (signal: AbortSignal) => Promise<void>) {
    if (operation.current && !operation.current.signal.aborted) return;
    const controller = new AbortController(); operation.current = controller;
    setBusy(true); setError(""); setNotice("");
    try { await action(controller.signal); }
    catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Original file recovery failed."); }
    finally { if (operation.current === controller) { operation.current = null; setBusy(false); if (controller.signal.aborted) setError("The workspace changed during this operation. Start again from its current records."); } }
  }
  return <section className="backend-settings-section" aria-label="Original file recovery" style={{ minWidth: 0, maxWidth: "100%", overflowWrap: "anywhere" }}>
    <h3>Independent original files</h3>
    <p>Export a separate copy of the file bytes available to your account, with each document’s company, file, version, and checksum. Server recovery points alone cannot recover a missing storage object.</p>
    <p className="form-note">Up to 2,000 originals, 64 MB total, and 50 MB per file. For a larger collection, export individual originals. Keep the downloaded archives in your approved backup location. Unreadable or unavailable originals are listed as missing.</p>
    <label style={{ minWidth: 0 }}>Export scope<select aria-label="Original files export scope" style={controlWidth} value={exportId} disabled={busy} onChange={event => setExportId(event.target.value)}>
      <option value="">All originals available to your account</option>
      {available.map(doc => <option key={doc.id} value={doc.id}>{doc.name} · version {doc.version} · company {doc.companyId}{doc.orderId ? ` · file ${doc.orderId}` : ""}</option>)}
    </select></label>
    {!available.length && <p className="form-note">There are no uploaded originals available in these workspace records.</p>}
    <Button variant="outline" disabled={busy || !exportDocuments.length} onClick={() => void run(async signal => {
      if (!connection) return;
      const result = await createOriginalsArchive({ workspaceId, revision: connection.revision, documents: exportDocuments }, downloadRemoteAsset, signal);
      if (signal.aborted) return;
      await backendRequest("/security/workspace-export", { workspaceId }, "POST", 30_000, workspaceId, connection.access.userId, true);
      if (signal.aborted) return;
      download(`titleos-originals-${workspaceId}${exportId ? `-${exportId}` : ""}-${result.exportedAt.slice(0, 10)}.json`, JSON.stringify(result), "application/json");
      setNotice(`Archive downloaded: ${result.originals.length} originals, ${result.missing.length} missing. ${result.missing.length ? "This archive is incomplete; recover the missing originals before bulk import." : "Verify the downloaded archive and recover a sample original before bulk import."}`);
    })}>{busy ? "Working with originals…" : "Export original files archive"}</Button>
    <h4>Test recovery from an archive</h4>
    <p className="form-note">Choose the downloaded archive to verify its bytes, then download a recovered original and open it. This check works without the original server storage. It does not restore hosted records or repair existing document references. To return a recovered file to the workspace, upload it as a new version and review its references.</p>
    <input type="file" accept="application/json,.json" aria-label="Original files archive" style={controlWidth} disabled={busy} onChange={event => {
      const file = event.target.files?.[0]; event.target.value = ""; setArchive(null); setSelected("");
      if (!file) return;
      void run(async signal => {
        if (file.size > MAX_BACKUP_FILE_BYTES) throw new Error("Choose an originals archive up to 96 MB.");
        const checked = await verifyOriginalsArchive(await file.text(), signal);
        if (signal.aborted) return;
        setArchive(checked); setNotice(`Checksums verified for ${checked.originals.length} originals. ${checked.missing.length} missing originals cannot be recovered from this archive.`);
      });
    }} />
    {archive && <div style={{ minWidth: 0 }}>
      <p>Archive workspace: {archive.workspaceId} · revision {archive.revision} · exported {new Date(archive.exportedAt).toLocaleString()}</p>
      {!!archive.missing.length && <p role="status">Missing originals: {archive.missing.map(item => `${item.name} (version ${item.version})`).join(", ")}. Keep bulk import on hold until all required originals have independent copies.</p>}
      <label style={{ minWidth: 0 }}>Original to recover<select aria-label="Original to recover" style={controlWidth} value={selected} disabled={busy} onChange={event => setSelected(event.target.value)}>
        <option value="">Choose an original</option>
        {archive.originals.map(item => <option value={item.reference.id} key={item.reference.id}>{item.reference.name} · version {item.reference.version} · company {item.reference.companyId}{item.reference.orderId ? ` · file ${item.reference.orderId}` : ""}</option>)}
      </select></label>
      <Button variant="outline" disabled={busy || !selected} onClick={() => void run(async signal => {
        const file = await recoverArchivedOriginal(archive, selected);
        if (signal.aborted) return;
        download(file.name, file); setNotice(`${file.name} recovered as a download; its SHA-256 checksum matches the archive. Open it to confirm readability. Hosted records were unchanged.`);
      })}>Download recovered original</Button>
    </div>}
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}
