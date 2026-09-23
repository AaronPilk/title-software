"use client";
import { useEffect, useRef, useState } from "react";
import { backendRequest } from "@/lib/backend/client";
import { pendingVendorCallback, clearVendorCallback, validVendorIntent, vendorIntentKey } from "@/lib/backend/vendor-callback";
import type { Access } from "@/lib/backend/workspace";
import { Button } from "../ui/button";

export function VendorOAuthReturn({ workspaceId, access }: { workspaceId: string; access: Access }) {
  return <ReturnContent key={`${workspaceId}:${access.userId}:${access.version}`} workspaceId={workspaceId} access={access} />;
}
function ReturnContent({ workspaceId, access }: { workspaceId: string; access: Access }) {
  const [callback] = useState(pendingVendorCallback);
  const [message, setMessage] = useState("Finishing your account connection…");
  const [finished, setFinished] = useState(false), [dismissed, setDismissed] = useState(false);
  const started = useRef(false);
  useEffect(() => {
    if (!callback || started.current) return;
    started.current = true;
    let intent: unknown;
    try { intent = JSON.parse(sessionStorage.getItem(vendorIntentKey) || "null"); } catch { intent = null; }
    if (!validVendorIntent(intent, callback, workspaceId, access.userId)) {
      queueMicrotask(() => { setMessage("This connection approval does not match your signed-in account or has expired. Open Settings → Connections and start again."); setFinished(true); });
      clearVendorCallback(); return;
    }
    sessionStorage.removeItem(vendorIntentKey);
    clearVendorCallback();
    // No automatic retries: the server consumes consent once, including failures.
    void backendRequest("/integrations/vendors/complete", { workspaceId, provider: intent.provider, companyId: intent.companyId, accountId: intent.accountId,
      code: callback.code, state: callback.state, realmId: callback.realmId, denied: callback.denied }, "POST", 90_000, workspaceId, access.userId)
      .then(() => setMessage("Account connected. Open Settings → Connections to review the company account and run a connection check."))
      .catch(error => setMessage(error instanceof Error ? error.message : "The connection could not be completed. Start again in Settings."))
      .finally(() => setFinished(true));
  }, [callback, workspaceId, access.userId]);
  if (!callback || dismissed) return null;
  return <aside className="panel" role="status" style={{ position: "fixed", zIndex: 80, bottom: 80, left: "max(16px, calc((100vw - 620px) / 2))", width: "min(620px, calc(100vw - 32px))", padding: 24, boxShadow: "0 12px 48px #082a4940" }}>
    <strong>Account connection</strong><p>{message}</p>
    {finished && <Button onClick={() => setDismissed(true)}>Close</Button>}
  </aside>;
}
