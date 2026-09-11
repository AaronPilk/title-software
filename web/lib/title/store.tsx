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
type Store = {
  s: Workspace;
  ready: boolean;
  update: (
    fn: (draft: Workspace) => void,
    title?: string,
    detail?: string,
  ) => boolean;
  reset: () => void;
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
        if (
          data.version === 1 &&
          [
            "companies",
            "orders",
            "documents",
            "tasks",
            "inbox",
            "activity",
            "rules",
            "approvedReports",
          ].every((k) => Array.isArray(data[k]))
        ) {
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
  return (
    <Context.Provider value={{ s, ready, update, reset }}>
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
