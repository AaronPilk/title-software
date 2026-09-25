"use client";
import { companyWorkspaceShapeValid } from "./company-workspace";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { createSeed, uid, type Workspace, type VaultDoc } from "./model";
import { decodeBackupAssets, validateBackupReferences, safeDocumentMime, MAX_BACKUP_FILE_BYTES, MAX_ASSETS, MAX_ASSET_BYTES, MAX_DECODED_BYTES } from "./backup-assets";
import { referencedSourcesShapeValid } from "./production";
import { finalPreparationShapeValid, validateFinalPreparationMutation } from "./final-preparation";
import { fieldReviewHistoryShapeValid, recordFieldReviewChanges } from "./field-review-history";
import { enrichWorkspace } from "./production";
import { enrichBusiness, validateBusinessMutation } from "./business";
import { isValidStatementDeliveryWorkspace } from "./statement-delivery";
import { isValidDeliveries } from "./delivery-ledger";
import { isValidOwnershipHistory } from "./ownership-history";
import { isValidTaskFields } from "./task-clock";
import { isValidOrchestration, validateOrchestrationMutation } from "./orchestration";
import { captureCommands } from "./command-log";
import { BackendAccess } from "@/components/title/backend-access";
import {
  supabase,
  backendConfigured,
  hostedPilot,
  backendRequest,
  activeWorkspace,
  uploadRemoteAsset,
  downloadRemoteAsset,
  type RemoteState,
} from "../backend/client";
const KEY = "titleos.workspace.v1";
type LocalWorkspace = Workspace & { localAssetNamespace?: string };
function localAssetNamespace() {
  const namespace = (JSON.parse(localStorage.getItem(KEY) || "{}") as LocalWorkspace).localAssetNamespace;
  return typeof namespace === "string" && /^[a-f\d-]{36}$/i.test(namespace) ? namespace : "";
}
const assetKey = (id: string, namespace: string) => namespace ? namespace + ":" + id : id;
const WORKSPACE_ARRAY_KEYS = [
  "companies",
  "orders",
  "documents",
  "tasks",
  "inbox",
  "activity",
  "rules",
  "approvedReports",
] as const;
/**
 * Optional top-level modules (currently just `materials`, see
 * lib/title/materials.ts) are never required here — an older or
 * materials-untouched workspace simply omits the key — but if one IS
 * present it must have its own expected shape, so a corrupted or foreign
 * value doesn't pass hydration/restore only to fail later when
 * materials-aware UI reads it. Add future optional modules the same way.
 */
function isValidOptionalMaterials(data: unknown): boolean {
  if (data === undefined) return true;
  return (
    !!data &&
    typeof data === "object" &&
    (data as { version?: unknown }).version === 1 &&
    Array.isArray((data as { items?: unknown }).items) &&
    Array.isArray((data as { publications?: unknown }).publications)
  );
}
function isWorkspaceShape(data: unknown): data is Workspace {
  return (
    !!data &&
    typeof data === "object" &&
    (data as { version?: unknown }).version === 1 &&
    WORKSPACE_ARRAY_KEYS.every((k) =>
      Array.isArray((data as Record<string, unknown>)[k]),
    ) &&
    (data as Workspace).orders.every(o => !!o && referencedSourcesShapeValid(o.production?.referencedSources) && (o.finalPreparation === undefined || finalPreparationShapeValid(o.finalPreparation)) && fieldReviewHistoryShapeValid(o.fieldReviewHistory)) &&
    isValidOptionalMaterials((data as { materials?: unknown }).materials) &&
    isValidStatementDeliveryWorkspace(data) &&
    companyWorkspaceShapeValid(data as Workspace) &&
    isValidDeliveries((data as { deliveries?: unknown }).deliveries) &&
    isValidOwnershipHistory((data as { ownershipHistory?: unknown }).ownershipHistory) &&
    isValidOrchestration((data as Workspace).orchestration) &&
    validOrchestrationSnapshot(data as Workspace) &&
    (data as Workspace).tasks.every(isValidTaskFields)
  );
}
function validOrchestrationSnapshot(data: Workspace) {
  try { validateOrchestrationMutation(data, data); return true; }
  catch { return false; }
}
type Store = {
  s: Workspace;
  ready: boolean;
  update: (
    fn: (draft: Workspace) => void,
    title?: string,
    detail?: string,
    expectedRevision?: number,
  ) => Promise<boolean>;
  reset: () => void;
  restore: (w: Workspace, assets?: WorkspaceBackup["assets"]) => Promise<void>;
  connection?: {
    workspaceId: string;
    access: RemoteState["access"];
    revision: number;
    saving: boolean;
    refresh: () => Promise<boolean>;
  };
};
const Context = createContext<Store | null>(null);
/** Presentation only: retain the authenticated connection and canonical update
 * handlers while showing the current workspace view's subset of records. */
export function WorkspacePresentation({ state, children }: { state: Workspace; children: ReactNode }) {
  const store = useWorkspace();
  return <Context.Provider value={{ ...store, s: state }}>{children}</Context.Provider>;
}
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [demo, setDemo] = useState(!backendConfigured && !hostedPilot);
  if (hostedPilot && !backendConfigured)
    return <main className="backend-entry"><section className="backend-login panel"><h1>Workspace unavailable</h1><p>The shared workspace connection has not been configured. Contact your administrator.</p></section></main>;
  if (demo)
    return (
      <LocalWorkspaceProvider>
        {backendConfigured && (
          <div className="demo-mode-bar">
            Local sample workspace
            <Buttonless onClick={() => setDemo(false)}>
              Open shared workspace
            </Buttonless>
          </div>
        )}
        {children}
      </LocalWorkspaceProvider>
    );
  return (
    <BackendAccess onDemo={() => { if (!hostedPilot) setDemo(true); }}>
      {(remote) => (
        <ConnectedWorkspaceProvider initial={remote}>
          {children}
        </ConnectedWorkspaceProvider>
      )}
    </BackendAccess>
  );
}
function Buttonless({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  );
}
function ConnectedWorkspaceProvider({
  initial,
  children,
}: {
  initial: RemoteState;
  children: ReactNode;
}) {
  const [remote, setRemote] = useState(initial),
    [saving, setSaving] = useState(false),
    [failure, setFailure] = useState<{ kind: "read" | "write"; message: string } | null>(null);
  const latest = useRef(initial),
    busy = useRef(false);
  const accept = useCallback((next: RemoteState) => {
    if (next.revision < latest.current.revision) return;
    latest.current = next;
    setRemote(next);
    setFailure(null);
  }, []);
  const refresh = useCallback(async () => {
    try {
      accept(await backendRequest<RemoteState>("/state"));
      return true;
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unable to refresh.";
      setFailure(current => current?.kind === "write" ? current : { kind: "read", message });
      if ([401, 403].includes((e as { status?: number }).status || 0))
        await supabase?.auth.signOut().catch(() => undefined);
      return false;
    }
  }, [accept]);
  useEffect(() => {
    const focus = () => {
      if (!busy.current) void refresh();
    };
    window.addEventListener("focus", focus);
    const interval = setInterval(focus, 30000);
    return () => {
      window.removeEventListener("focus", focus);
      clearInterval(interval);
    };
  }, [refresh]);
  async function update(
    fn: (draft: Workspace) => void,
    title?: string,
    detail?: string,
    expectedRevision?: number,
  ) {
    if (busy.current) {
      toast.error(
        "A save is still in progress. Please try again when it completes.",
      );
      return false;
    }
    if (expectedRevision !== undefined && latest.current.revision !== expectedRevision) {
      toast.error("Records changed after this review. Run a fresh review before saving.");
      return false;
    }
    const before = latest.current,
      next = structuredClone(before.state);
    let commands;
    try {
      commands = captureCommands(next, fn);
      validateBusinessMutation(before.state, next);
      validateFinalPreparationMutation(before.state, next);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Check this change.");
      return false;
    }
    if (!commands.length) return true;
    busy.current = true;
    setSaving(true);
    setFailure(null);
    const request = {
      workspaceId: before.workspaceId,
      expectedRevision: before.revision,
      requestId: crypto.randomUUID(),
      commands,
    };
    try {
      let result: RemoteState;
      try {
        result = await backendRequest<RemoteState>("/commands", request);
      } catch (e) {
        // Only transport uncertainty is retried, with exactly the same request ID and payload.
        if (e instanceof TypeError)
          result = await backendRequest<RemoteState>("/commands", request);
        else throw e;
      }
      accept(result);
      if (title)
        toast.success(
          title.replace(/locally|local|Demo /gi, "shared workspace").trim(),
        );
      return true;
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "The change was not saved.";
      setFailure({ kind: "write", message });
      toast.error(message);
      if ([401, 403, 409].includes((e as { status?: number }).status || 0))
        await refresh();
      return false;
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }
  return (
    <Context.Provider
      value={{
        s: remote.state,
        ready: true,
        update,
        reset: () =>
          toast.error(
            "Use an owner-reviewed server backup to recover shared records.",
          ),
        restore: async () => {
          throw new Error(
            "Local backup replacement is disabled for the shared workspace. Use server backups.",
          );
        },
        connection: {
          workspaceId: remote.workspaceId,
          access: remote.access,
          revision: remote.revision,
          saving,
          refresh,
        },
      }}
    >
      <div className="shared-mode-bar" role="status">
        {saving
          ? "Saving securely…"
          : failure ? failure.kind === "read" ? "Could not refresh records" : "Changes not saved" : "All changes saved"}
        {failure && (
          <button type="button" onClick={() => void refresh()}>
            Refresh connection
          </button>
        )}
      </div>
      {failure && (
        <div className="backend-save-error" role="alert">
          {failure.message}
        </div>
      )}
      <div style={{ display: "contents" }} inert={saving || undefined}>
        {children}
      </div>
    </Context.Provider>
  );
}
function LocalWorkspaceProvider({ children }: { children: ReactNode }) {
  const [s, setState] = useState(createSeed);
  const [ready, setReady] = useState(false);
  const storageWarning = useRef(false);
  const latest = useRef(s);
  useEffect(() => {
    let active = true;
    // Browser storage is an external source; publish hydration after mount and
    // ignore a queued read if this local provider has already been replaced.
    queueMicrotask(() => {
    if (!active) return;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const data = JSON.parse(raw);
        if (isWorkspaceShape(data)) {
          for (const order of data.orders) {
            for (const field of order.fields || []) {
              if (
                field.id === "name" &&
                field.label === "Vesting / insured name"
              )
                field.label = "Vesting / grantee name";
            }
          }
          const migrated = enrichBusiness(enrichWorkspace(data));
          latest.current = migrated;
          setState(migrated);
        } else
          toast.error(
            "Saved demo was not compatible. The sample workspace has been loaded.",
          );
      }
    } catch {
      toast.error(
        "Could not load saved demo data. The sample workspace has been loaded.",
      );
    }
    setReady(true);
    });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
      storageWarning.current = false;
    } catch {
      if (!storageWarning.current) {
        toast.error(
          "Browser storage is unavailable. Current changes are not saved.",
        );
        storageWarning.current = true;
      }
    }
  }, [s, ready]);
  useEffect(() => {
    if (!ready) return;
    let day = new Date().toDateString();
    const timer = setInterval(() => {
      const nextDay = new Date().toDateString();
      if (day === nextDay) return;
      day = nextDay;
      const next = enrichBusiness(structuredClone(latest.current));
      latest.current = next;
      setState(next);
    }, 60000);
    return () => clearInterval(timer);
  }, [ready]);
  async function update(
    fn: (draft: Workspace) => void,
    title?: string,
    detail = "",
  ) {
    const next = structuredClone(latest.current);
    try {
      fn(next);
      recordFieldReviewChanges(latest.current, next, next.user);
      validateBusinessMutation(latest.current, next);
      validateFinalPreparationMutation(latest.current, next);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "This change could not be applied.",
      );
      return false;
    }
    if (title)
      next.activity.unshift({
        id: uid("activity"),
        title,
        detail,
        at: new Date().toISOString(),
        actor: next.user,
      });
    next.activity = next.activity.slice(0, 100);
    latest.current = next;
    setState(next);
    if (title) toast.success(title);
    return true;
  }
  function reset() {
    const previous = latest.current;
    const next = createSeed();
    latest.current = next;
    setState(next);
    toast.success("Demo workspace reset", {
      action: {
        label: "Undo",
        onClick: () => {
          latest.current = previous;
          setState(previous);
        },
      },
    });
  }
  async function restore(w: Workspace, assets: WorkspaceBackup["assets"] = []) {
    if (!isWorkspaceShape(w))
      throw new Error("This backup contains invalid workspace records.");
    const previous = latest.current;
    const next = enrichBusiness(enrichWorkspace(structuredClone(w)));
    validateBackupReferences(next, assets, []);
    // Publish one metadata pointer only after a complete new file generation.
    // Logical asset IDs stay stable for document evidence and publication history.
    const namespace = crypto.randomUUID();
    (next as LocalWorkspace).localAssetNamespace = namespace;
    const serialized = JSON.stringify(next);
    await restoreAssets(assets, namespace);
    if (latest.current !== previous)
      throw new Error("The workspace changed during restore. Please review and retry.");
    localStorage.setItem(KEY, serialized);
    latest.current = next;
    setState(next);
    toast.success("Backup restored", {
      action: {
        label: "Undo",
        onClick: () => {
          localStorage.setItem(KEY, JSON.stringify(previous));
          latest.current = previous;
          setState(previous);
        },
      },
    });
  }
  return (
    <Context.Provider value={{ s, ready, update, reset, restore }}>
      {children}
    </Context.Provider>
  );
}
export function useWorkspace() {
  const c = useContext(Context);
  if (!c) throw new Error("Workspace context unavailable");
  return c;
}
function openAssets(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("titleos-local-assets", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("files");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function saveAsset(
  id: string,
  file: File,
  binding?: { companyId: string; documentId: string; expectedUserId?: string; expectedWorkspaceId?: string },
) {
  const workspaceId = activeWorkspace();
  if (binding?.expectedWorkspaceId !== undefined && binding.expectedWorkspaceId !== workspaceId)
    throw Object.assign(new Error("Your account or workspace changed. Reopen Upload documents before sending these originals."), { status: 403 });
  if (workspaceId) {
    if (!binding)
      throw new Error("Choose the company and document for this upload.");
    await uploadRemoteAsset(id, file, binding.companyId, binding.documentId, {
      expectedUserId: binding.expectedUserId,
      expectedWorkspaceId: binding.expectedWorkspaceId ?? workspaceId,
    });
    return;
  }
  const db = await openAssets();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("files", "readwrite");
    tx.objectStore("files").put(file, assetKey(id, localAssetNamespace()));
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}
export async function getAsset(id: string, namespace?: string): Promise<Blob> {
  if (activeWorkspace()) return downloadRemoteAsset(id);
  const key = assetKey(id, namespace ?? localAssetNamespace());
  const db = await openAssets();
  return new Promise((resolve, reject) => {
    const r = db.transaction("files").objectStore("files").get(key);
    r.onsuccess = () => {
      db.close();
      if (r.result) resolve(r.result);
      else reject(new Error("File is no longer available in this browser."));
    };
    r.onerror = () => {
      db.close();
      reject(r.error);
    };
  });
}
/** Read one already-selected original without following an account/workspace switch. */
export async function getAssetForDocument(doc: VaultDoc, binding: { expectedWorkspaceId: string; expectedUserId?: string }): Promise<Blob> {
  if (!doc.assetId) throw new Error("This document has no uploaded original.");
  const changed = () => new Error("Your workspace changed. Reopen the original before downloading.");
  if (activeWorkspace() !== binding.expectedWorkspaceId) throw changed();
  if (binding.expectedWorkspaceId) return downloadRemoteAsset(doc.assetId, binding);
  const namespace = localAssetNamespace();
  const blob = await getAsset(doc.assetId, namespace);
  if (activeWorkspace() || localAssetNamespace() !== namespace) throw changed();
  if (blob.size > MAX_ASSET_BYTES) throw new Error("Original exceeds the 50 MB download limit.");
  return blob;
}

export function download(
  name: string,
  content: Blob | string,
  type = "text/plain",
) {
  const blob =
    typeof content === "string" ? new Blob([content], { type }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
export function exportCsv(name: string, rows: (string | number | boolean)[][]) {
  const cell = (v: string | number | boolean) => {
    let t = String(v);
    if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;
    return '"' + t.replaceAll('"', '""') + '"';
  };
  download(
    name,
    "\uFEFF" + rows.map((r) => r.map(cell).join(",")).join("\r\n"),
    "text/csv;charset=utf-8",
  );
}
/**
 * Full binary backup/restore. The metadata-only "Export demo records" export
 * intentionally leaves uploaded files in browser storage; this instead bundles
 * every uploaded file's bytes alongside the workspace metadata into one JSON
 * file, so the browser's IndexedDB is not the only copy of anything.
 */
export type WorkspaceBackup = {
  backup: true;
  version: 1;
  exportedAt: string;
  workspace: Workspace;
  assets: { id: string; name: string; mime: string; data: string }[];
  /**
   * Documents whose bytes could not be read from this browser's storage at
   * export time (cleared IndexedDB, another tab/profile, etc). Restoring
   * this backup will not recover these — they are persisted in the file
   * itself (not just an export-time toast) so a later restore can tell the
   * operator which documents — including any published company materials
   * that reference them — still need their file re-attached afterward.
   */
  missingAssets: { id: string; name: string }[];
};
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
export async function createFullBackup(s: Workspace): Promise<WorkspaceBackup> {
  const workspace = structuredClone(s);
  // Undo or a restore may switch the active generation while file reads await.
  const namespace = (workspace as LocalWorkspace).localAssetNamespace || "";
  const docs = workspace.documents.filter((d) => d.assetId);
  if (docs.length > MAX_ASSETS)
    throw new Error("A local backup supports up to 2,000 files. Use the shared workspace for larger collections.");
  const assets: WorkspaceBackup["assets"] = [];
  const missingAssets: WorkspaceBackup["missingAssets"] = [];
  const files: { doc: typeof docs[number]; blob: Blob; mime: string }[] = [];
  let total = 0;
  for (const d of docs) {
    let blob: Blob;
    try {
      blob = await getAsset(d.assetId!, namespace);
    } catch {
      missingAssets.push({ id: d.assetId!, name: d.name });
      continue;
    }
    total += blob.size;
    if (blob.size > MAX_ASSET_BYTES || total > MAX_DECODED_BYTES)
      throw new Error("A local backup supports 64 MB of files, with up to 50 MB per file. Use the shared workspace for larger collections.");
    const mime = d.mime || blob.type || "application/octet-stream";
    if (!safeDocumentMime(mime) || (d.mime && blob.type && d.mime !== blob.type))
      throw new Error("A stored file does not match its document type. Reattach the correct original before exporting.");
    d.mime = mime;
    files.push({ doc: d, blob, mime });
  }
  // Preflight the whole collection before allocating base64 strings.
  for (const { doc, blob, mime } of files)
    assets.push({ id: doc.assetId!, name: doc.name, mime, data: await blobToBase64(blob) });
  const payload: WorkspaceBackup = {
    backup: true,
    version: 1,
    exportedAt: new Date().toISOString(),
    workspace,
    assets,
    missingAssets,
  };
  decodeBackupAssets(assets);
  validateBackupReferences(workspace, assets, missingAssets);
  return payload;
}
export async function exportFullBackup(s: Workspace) {
  const payload = await createFullBackup(s);
  const serialized = JSON.stringify(payload);
  if (new Blob([serialized]).size > MAX_BACKUP_FILE_BYTES)
    throw new Error("This local backup exceeds the 96 MB file limit. Use the shared workspace for larger collections.");
  download(
    `titleos-full-backup-${new Date().toISOString().slice(0, 10)}.json`,
    serialized,
    "application/json",
  );
  return {
    total: payload.assets.length + payload.missingAssets.length,
    saved: payload.assets.length,
    missing: payload.missingAssets.map((m) => m.name),
  };
}
export function parseBackupFile(raw: string): WorkspaceBackup {
  if (raw.length > MAX_BACKUP_FILE_BYTES)
    throw new Error("Choose a local backup file up to 96 MB.");
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("This file is not valid JSON.");
  }
  const b = data as Partial<WorkspaceBackup> | null;
  if (
    !b ||
    typeof b !== "object" ||
    b.backup !== true ||
    b.version !== 1 ||
    !isWorkspaceShape(b.workspace) ||
    !Array.isArray(b.assets)
  )
    throw new Error(
      "This is not a TitleOS full backup file (use one downloaded from Export full backup).",
    );
  // The asset list and the missing-asset manifest are read by the restore
  // confirmation dialog and by restoreAssets, so a malformed entry has to be
  // rejected here, up front, not discovered as a crash inside the dialog.
  // missingAssets was added after the first release of this format — absent
  // is fine (an older backup) and defaults to empty; present-but-malformed
  // is not.
  const stringFields = (x: unknown, keys: string[]) =>
    !!x &&
    typeof x === "object" &&
    keys.every((k) => typeof (x as Record<string, unknown>)[k] === "string");
  if (!b.assets.every((a) => stringFields(a, ["id", "name", "mime", "data"])))
    throw new Error(
      "This backup file's asset list is malformed and cannot be restored safely.",
    );
  if (
    b.missingAssets !== undefined &&
    (!Array.isArray(b.missingAssets) ||
      !b.missingAssets.every((m) => stringFields(m, ["id", "name"])))
  )
    throw new Error(
      "This backup file's missing-asset manifest is malformed and cannot be restored safely.",
    );
  b.missingAssets ??= [];
  decodeBackupAssets(b.assets);
  validateBackupReferences(b.workspace!, b.assets, b.missingAssets);
  return b as WorkspaceBackup;
}
export async function restoreAssets(assets: WorkspaceBackup["assets"], namespace = localAssetNamespace()) {
  if (activeWorkspace())
    throw new Error(
      "Restore shared records through owner-reviewed server backups.",
    );
  const decoded = decodeBackupAssets(assets);
  if (!decoded.length) return;
  const db = await openAssets();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("files", "readwrite");
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onabort = () => { db.close(); reject(tx.error || new Error("File restore was canceled. Nothing was changed.")); };
    try {
      for (const asset of decoded) tx.objectStore("files").put(asset.file, assetKey(asset.id, namespace));
    } catch {
      tx.abort();
    }
  });
}
