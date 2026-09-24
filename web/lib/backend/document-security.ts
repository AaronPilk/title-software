/** Server-only adapter. A clean receipt authorizes only these exact bytes. */
export const MAX_DOCUMENT_SCAN_BYTES = 52_428_800;
export const DOCUMENT_SCAN_PROTOCOL = 1;
const MAX_RESPONSE_BYTES = 4096;
const MAX_SIGNATURE_AGE_MS = 72 * 60 * 60 * 1000;
export type DocumentScannerEnv = {
  TITLE_SCANNER_URL?: string;
  TITLE_SCANNER_TOKEN?: string;
  TITLE_SCANNER_TIMEOUT_MS?: string;
};
export type DocumentScanFailure = "not_configured" | "invalid_configuration" | "invalid_size" |
  "scanner_unavailable" | "scanner_timeout" | "invalid_receipt";
export type DocumentScanResult = {
  status: "clean" | "infected";
  sha256: string;
  byteLength: number;
  scannedAt: string;
  engineVersion: string;
  signatureVersion: string;
  signatureUpdatedAt: string;
  protocolVersion: 1;
} | {
  status: "unavailable";
  sha256: string;
  byteLength: number;
  reason: DocumentScanFailure;
};

function settings(env: DocumentScannerEnv) {
  if (!env.TITLE_SCANNER_URL || !env.TITLE_SCANNER_TOKEN) return "not_configured" as const;
  try {
    const url = new URL(env.TITLE_SCANNER_URL);
    const timeout = env.TITLE_SCANNER_TIMEOUT_MS ?? "30000";
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      url.pathname !== "/v1/scan" || url.href !== env.TITLE_SCANNER_URL ||
      !/^[\x21-\x7e]{32,512}$/.test(env.TITLE_SCANNER_TOKEN) ||
      !/^[0-9]+$/.test(timeout) || Number(timeout) < 1000 || Number(timeout) > 30000)
      return "invalid_configuration" as const;
    return { url: url.href, token: env.TITLE_SCANNER_TOKEN, timeoutMs: Number(timeout) };
  } catch { return "invalid_configuration" as const; }
}

async function boundedJson(response: Response): Promise<unknown> {
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_RESPONSE_BYTES)) throw new Error();
  if (response.headers.get("content-type")?.split(";", 1)[0].trim() !== "application/json" || !response.body) throw new Error();
  const reader = response.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error();
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/** No errors or scanner response text are returned to callers. Missing/failed scans never become clean. */
export async function scanDocument(env: DocumentScannerEnv, input: Uint8Array,
  fetcher: typeof fetch = fetch): Promise<DocumentScanResult> {
  const byteLength = input.byteLength;
  const unavailable = (sha256: string, reason: DocumentScanFailure): DocumentScanResult =>
    ({ status: "unavailable", sha256, byteLength, reason });
  if (!byteLength || byteLength > MAX_DOCUMENT_SCAN_BYTES) return unavailable("", "invalid_size");
  // Snapshot once: a caller changing its original buffer cannot change the submitted content after hashing.
  const bytes = new Uint8Array(input);
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.buffer)))
    .map(value => value.toString(16).padStart(2, "0")).join("");
  const config = settings(env);
  if (typeof config === "string") return unavailable(sha256, config);
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  const controller = new AbortController();
  let deadline: ReturnType<typeof setTimeout> | undefined;
  // An explicit race bounds even a stalled response reader or a non-conforming fetch implementation.
  const timedOut = new Promise<never>((_, reject) => {
    deadline = setTimeout(() => { controller.abort(); reject(new Error("deadline")); }, config.timeoutMs);
  });
  try {
    const work = async () => {
      const response = await fetcher(config.url, {
        method: "POST", redirect: "error", signal: controller.signal,
        headers: { "Authorization": `Bearer ${config.token}`, "Content-Type": "application/octet-stream",
          "X-Content-SHA256": sha256, "X-Scan-Protocol": String(DOCUMENT_SCAN_PROTOCOL), "X-Scan-Request-ID": requestId },
        body: bytes,
      });
      if (response.status !== 200) {
        await response.body?.cancel().catch(() => {});
        return unavailable(sha256, "scanner_unavailable");
      }
      let raw: unknown;
      try { raw = await boundedJson(response); } catch { return unavailable(sha256, "invalid_receipt"); }
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return unavailable(sha256, "invalid_receipt");
      const receipt = raw as Record<string, unknown>;
      const scannedAt = typeof receipt.scannedAt === "string" ? Date.parse(receipt.scannedAt) : NaN;
      const signatureAt = typeof receipt.signatureUpdatedAt === "string" ? Date.parse(receipt.signatureUpdatedAt) : NaN;
      const now = Date.now();
      if (receipt.protocolVersion !== DOCUMENT_SCAN_PROTOCOL || receipt.requestId !== requestId ||
        receipt.sha256 !== sha256 || receipt.byteLength !== byteLength ||
        (receipt.status !== "clean" && receipt.status !== "infected") ||
        typeof receipt.engineVersion !== "string" || !/^ClamAV [0-9]+\.[0-9]+\.[0-9]+(?:[a-zA-Z0-9.+_-]{0,32})?$/.test(receipt.engineVersion) ||
        typeof receipt.signatureVersion !== "string" || !/^[0-9]{1,12}$/.test(receipt.signatureVersion) ||
        !Number.isFinite(scannedAt) || scannedAt < startedAt - 60_000 || scannedAt > now + 60_000 ||
        !Number.isFinite(signatureAt) || signatureAt > now + 60_000 || now - signatureAt > MAX_SIGNATURE_AGE_MS)
        return unavailable(sha256, "invalid_receipt");
      return { status: receipt.status, sha256, byteLength, scannedAt: new Date(scannedAt).toISOString(),
        engineVersion: receipt.engineVersion, signatureVersion: receipt.signatureVersion,
        signatureUpdatedAt: new Date(signatureAt).toISOString(), protocolVersion: DOCUMENT_SCAN_PROTOCOL } as DocumentScanResult;
    };
    return await Promise.race([work(), timedOut]);
  } catch { return unavailable(sha256, controller.signal.aborted ? "scanner_timeout" : "scanner_unavailable"); }
  finally { clearTimeout(deadline); controller.abort(); }
}
