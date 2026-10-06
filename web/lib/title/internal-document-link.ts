/** Staff links identify a record; they never grant access or expose an original URL. */
export function internalDocumentLink({ documentId, workspaceId, origin }: { documentId: string; workspaceId: string; origin: string }): string {
  const url = new URL(origin);
  if (url.protocol !== "https:" || ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !documentId || !workspaceId || documentId.length > 200 || workspaceId.length > 200 || /[\u0000-\u001f\u007f]/.test(workspaceId + documentId))
    throw new Error("Open the live workspace to copy a staff link.");
  return `${url.origin}/#agency/documents/${encodeURIComponent(workspaceId)}/${encodeURIComponent(documentId)}`;
}

export function readInternalDocumentLink(hash: string): { workspaceId: string; documentId: string } | null {
  const parts = hash.split("/");
  if (parts.length !== 4 || parts[0] !== "#agency" || parts[1] !== "documents") return null;
  try {
    const [workspaceId, documentId] = parts.slice(2).map(decodeURIComponent);
    if (!workspaceId || !documentId || workspaceId.length > 200 || documentId.length > 200 || /[\u0000-\u001f\u007f]/.test(workspaceId + documentId)) return null;
    return { workspaceId, documentId };
  } catch { return null; }
}
