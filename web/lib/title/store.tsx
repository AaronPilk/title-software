"use client";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { createSeed, uid, type Workspace } from "./model";
import { enrichWorkspace } from "./production";
import { enrichBusiness, validateBusinessMutation } from "./business";
const KEY = "titleos.workspace.v1";
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
function isWorkspaceShape(data: unknown): data is Workspace {
  return (
    !!data &&
    typeof data === "object" &&
    (data as { version?: unknown }).version === 1 &&
    WORKSPACE_ARRAY_KEYS.every((k) =>
      Array.isArray((data as Record<string, unknown>)[k]),
    )
  );
}
type Store = {
  s: Workspace;
  ready: boolean;
  update: (
    fn: (draft: Workspace) => void,
    title?: string,
    detail?: string,
  ) => boolean;
  reset: () => void;
  restore: (w: Workspace) => void;
};
const Context = createContext<Store | null>(null);
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [s, setState] = useState(createSeed);
  const [ready, setReady] = useState(false);
  const storageWarning = useRef(false);
  const latest = useRef(s);
  useEffect(() => {
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
  function update(fn: (draft: Workspace) => void, title?: string, detail = "") {
    const next = structuredClone(latest.current);
    try {
      fn(next);
      validateBusinessMutation(latest.current, next);
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
  function restore(w: Workspace) {
    const previous = latest.current;
    const next = enrichBusiness(enrichWorkspace(structuredClone(w)));
    latest.current = next;
    setState(next);
    toast.success("Backup restored", {
      action: {
        label: "Undo",
        onClick: () => {
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
export async function saveAsset(id: string, file: File) {
  const db = await openAssets();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("files", "readwrite");
    tx.objectStore("files").put(file, id);
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
export async function getAsset(id: string): Promise<Blob> {
  const db = await openAssets();
  return new Promise((resolve, reject) => {
    const r = db.transaction("files").objectStore("files").get(id);
    r.onsuccess = () => {
      db.close();
      r.result
        ? resolve(r.result)
        : reject(new Error("File is no longer available in this browser."));
    };
    r.onerror = () => {
      db.close();
      reject(r.error);
    };
  });
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
function base64ToBlob(data: string, mime: string): Blob {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
export async function exportFullBackup(s: Workspace) {
  const docs = s.documents.filter((d) => d.assetId);
  const assets: WorkspaceBackup["assets"] = [];
  const missing: string[] = [];
  for (const d of docs) {
    try {
      const blob = await getAsset(d.assetId!);
      assets.push({
        id: d.assetId!,
        name: d.name,
        mime: d.mime || blob.type || "application/octet-stream",
        data: await blobToBase64(blob),
      });
    } catch {
      missing.push(d.name);
    }
  }
  const payload: WorkspaceBackup = {
    backup: true,
    version: 1,
    exportedAt: new Date().toISOString(),
    workspace: s,
    assets,
  };
  download(
    `titleos-full-backup-${new Date().toISOString().slice(0, 10)}.json`,
    JSON.stringify(payload),
    "application/json",
  );
  return { total: docs.length, saved: assets.length, missing };
}
export function parseBackupFile(raw: string): WorkspaceBackup {
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
  return b as WorkspaceBackup;
}
export async function restoreAssets(assets: WorkspaceBackup["assets"]) {
  for (const a of assets)
    await saveAsset(
      a.id,
      new File([base64ToBlob(a.data, a.mime)], a.name, { type: a.mime }),
    );
}
