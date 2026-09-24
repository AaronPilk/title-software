import { jvPortalPublicRequest, jvPortalUpload, type JVPortalContext } from "./jv-portal";
import { ApiError } from "./workspace";
import { readRequestFormData, readRequestText, RequestBodyError } from "../shared/request-body";

const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });
async function gatewayMatches(provided: string, expected: string): Promise<boolean> {
  if (provided.length > 256 || provided.length < 32) return false;
  const encode = (s: string) => new TextEncoder().encode(s);
  const key = await crypto.subtle.importKey("raw", encode(expected), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  const signature = await crypto.subtle.sign("HMAC", key, encode(expected));
  return crypto.subtle.verify("HMAC", key, signature, encode(provided));
}
/** This function exposes only recipient capability operations, never staff/workspace APIs. */
export async function jvPortalPublicHttp(request: Request, config: { gatewayKey?: string; context: JVPortalContext }): Promise<Response> {
  try {
    if (!config.gatewayKey || config.gatewayKey.length < 32) return json({ error: "Application service setup is incomplete. Contact the sender." }, 503);
    if (!await gatewayMatches(request.headers.get("X-JV-Gateway-Key") ?? "", config.gatewayKey)) return json({ error: "Application access is unavailable." }, 403);
    const url = new URL(request.url);
    const route = url.pathname.match(/^\/(?:functions\/v1\/)?title-jv-public\/(start|verify|load|save|submit|upload|download|remove-attachment)$/);
    if (!route || url.search) return json({ error: "Not found." }, 404);
    if (request.method !== "POST") return json({ error: "Use POST for application requests." }, 405);
    const ip = request.headers.get("X-JV-Client-IP") ?? "";
    if (!/^[A-Fa-f0-9.:]{3,64}$/.test(ip)) return json({ error: "Application access is unavailable." }, 403);
    const context = { ...config.context, trustedIp: ip }, action = route[1];
    if (action === "upload") {
      if (!/^multipart\/form-data;\s*boundary=/i.test(request.headers.get("Content-Type") ?? "")) return json({ error: "Choose a file to upload." }, 415);
      const form = await readRequestFormData(request, { maxBytes: 11 * 1024 * 1024, timeoutMs: 60_000 });
      const keys = [...form.keys()];
      const session = form.get("session"), file = form.get("file");
      if (keys.length !== 2 || keys.some(key => !["session", "file"].includes(key)) || typeof session !== "string" || !(file instanceof File)) return json({ error: "Choose one file to upload." }, 400);
      return json(await jvPortalUpload(session, { name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) }, context));
    }
    if (!/^application\/json(?:\s*;.*)?$/i.test(request.headers.get("Content-Type") ?? "")) return json({ error: "Use a JSON request." }, 415);
    let input: unknown;
    try { input = JSON.parse(await readRequestText(request, { maxBytes: 131_072, tooLargeMessage: "Application request exceeds 128 KiB." })); }
    catch (cause) { if (cause instanceof RequestBodyError) throw cause; return json({ error: "Invalid application request." }, 400); }
    if (!input || typeof input !== "object" || Array.isArray(input)) return json({ error: "Invalid application request." }, 400);
    const result = await jvPortalPublicRequest(action, input as Record<string, unknown>, context);
    if (action === "download" && result && typeof result === "object" && "bytes" in result && result.bytes instanceof Uint8Array && "name" in result && typeof result.name === "string" && "mime" in result && typeof result.mime === "string") {
      return new Response(new Uint8Array(result.bytes), { headers: { ...headers, "Content-Type": result.mime, "Content-Length": String(result.bytes.length), "Content-Disposition": `attachment; filename="application-document"; filename*=UTF-8''${encodeURIComponent(result.name).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16)}`)}` } });
    }
    return json(result);
  } catch (cause) {
    if (cause instanceof ApiError || cause instanceof RequestBodyError) return json({ error: cause.message }, cause.status);
    return json({ error: "The application service is unavailable. Please try again." }, 503);
  }
}
