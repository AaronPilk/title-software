type RecoveryStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function recoveryKey(token?: string | null): string {
  // This unsigned payload only identifies UI intent. The API authorizes the session.
  try {
    const parts = token?.split(".");
    if (!parts || parts.length !== 3) return "";
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    if (typeof payload.session_id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.session_id)) return "";
    return `titleos.password-recovery.${payload.session_id}`;
  } catch {
    return "";
  }
}

export function createRecoveryIntent(getStorage: () => RecoveryStorage | undefined) {
  let currentKey = "";
  let pending = false;

  function clear() {
    pending = false;
    try {
      if (currentKey) getStorage()?.removeItem(currentKey);
    } catch { /* In-memory state remains cleared when storage is restricted. */ }
  }

  function read(token?: string | null, mark = false) {
    const key = recoveryKey(token);
    if (!key) {
      clear();
      return false;
    }
    if (key !== currentKey) {
      clear();
      currentKey = key;
      try {
        pending = getStorage()?.getItem(key) === "pending";
      } catch { /* A new session never inherits another session's memory fallback. */ }
    }
    if (mark) {
      pending = true;
      try {
        getStorage()?.setItem(key, "pending");
      } catch { /* Keep recovery available for this session without browser storage. */ }
    }
    return pending;
  }

  return {
    read,
    clear,
    observe(event: string, token?: string | null) {
      if (event === "SIGNED_OUT") {
        clear();
        return false;
      }
      return read(token, event === "PASSWORD_RECOVERY");
    },
  };
}

export const recoveryIntent = createRecoveryIntent(() =>
  typeof window === "undefined" ? undefined : window.sessionStorage,
);
