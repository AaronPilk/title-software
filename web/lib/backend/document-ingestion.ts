import { scanDocument, type DocumentScannerEnv } from "./document-security";
import { ApiError } from "./workspace";

type Rpc = (name: string, args: Record<string, unknown>) => Promise<unknown>;
/** All upload channels use the same database-owned policy and byte-bound receipt. */
export async function prepareDocumentIngestion(input: {
  path: string; bytes: Uint8Array; workspaceId?: string; companyId?: string;
}, env: DocumentScannerEnv, rpc: Rpc, fetcher?: typeof fetch): Promise<Uint8Array> {
  const bytes = new Uint8Array(input.bytes);
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map(b => b.toString(16).padStart(2, "0")).join("");
  const base = { p_path: input.path, p_workspace: input.workspaceId ?? null, p_company: input.companyId ?? null, p_sha: hash, p_bytes: bytes.byteLength };
  const bound = await rpc("title_prepare_document_ingestion", base) as { workspaceId?: unknown; companyId?: unknown; policy?: unknown } | null;
  if (!bound || typeof bound.workspaceId !== "string" || typeof bound.companyId !== "string" || !["required", "pending_setup"].includes(String(bound.policy)))
    throw new ApiError("Document security settings are unavailable. Try again later.", 503);
  const receipt = bound.policy === "required" ? await scanDocument(env, bytes, fetcher) : null;
  if (receipt && receipt.status !== "clean") {
    try {
      await rpc("title_record_security_event", { p_workspace: bound.workspaceId, p_actor: null,
        p_event_type: receipt.status === "infected" ? "document.scan_blocked" : "document.scan_unavailable",
        p_outcome: "failure", p_company_id: bound.companyId });
    } catch { /* An unavailable audit never changes a rejected scan into clearance. */ }
  }
  if (receipt?.status === "infected") throw new ApiError("This file did not pass the security scan. It has not been stored. Use a safe original or contact your administrator.", 422);
  if (receipt?.status === "unavailable") throw new ApiError("The document security scanner is unavailable. No file was stored. Try again later.", 503);
  await rpc("title_record_document_scan", { ...base, p_workspace: bound.workspaceId, p_company: bound.companyId, p_receipt: receipt });
  return bytes;
}
