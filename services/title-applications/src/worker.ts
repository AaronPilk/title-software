import { readRequestBytes, RequestBodyError } from "../../../web/lib/shared/request-body";

const policy = {
  "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY",
  "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()", "Strict-Transport-Security": "max-age=31536000",
};
const json = (message: string, status: number) => new Response(JSON.stringify({ error: message }), { status, headers: { ...policy, "Content-Type": "application/json" } });
const actions = new Set(["start", "verify", "load", "save", "submit", "upload", "download", "remove-attachment"]);
export async function portalFetch(request: Request, env: Env, fetcher: typeof fetch = fetch): Promise<Response> {
  try {
    const url = new URL(request.url);
    if (url.search) return json("Not found.", 404);
    if (!url.pathname.startsWith("/api/")) {
      if (request.method !== "GET" && request.method !== "HEAD") return json("Use GET for this page.", 405);
      if (!["/", "/index.html", "/app.js", "/app.css", "/brand/ballantyne-title-logo.png"].includes(url.pathname)) return json("Not found.", 404);
      const asset = await env.ASSETS.fetch(request);
      const headers = new Headers(asset.headers); for (const [name, value] of Object.entries(policy)) headers.set(name, value);
      return new Response(asset.body, { status: asset.status, headers });
    }
    const action = url.pathname.slice(5);
    if (!actions.has(action)) return json("Not found.", 404);
    if (request.method !== "POST") return json("Use POST for application requests.", 405);
    if (request.headers.get("Origin") !== url.origin || (request.headers.get("Sec-Fetch-Site") && request.headers.get("Sec-Fetch-Site") !== "same-origin")) return json("Open the application link to continue.", 403);
    const contentType = request.headers.get("Content-Type") ?? "";
    if (action === "upload" ? !/^multipart\/form-data;\s*boundary=/i.test(contentType) : !/^application\/json(?:\s*;.*)?$/i.test(contentType)) return json("Unsupported application request.", 415);
    if (!env.JV_PORTAL_GATEWAY_KEY || env.JV_PORTAL_GATEWAY_KEY.length < 32) return json("Application service setup is incomplete. Contact the sender.", 503);
    // Only Cloudflare's edge-provided address is forwarded; never accept a client-supplied gateway/IP header.
    const ip = request.headers.get("CF-Connecting-IP") ?? "";
    if (!/^[A-Fa-f0-9.:]{3,64}$/.test(ip)) return json("Application access is unavailable.", 403);
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
    const key = Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, "0")).join("");
    if (!(await env.PORTAL_REQUESTS.limit({ key })).success) return json("Please wait before trying again.", 429);
    const body = await readRequestBytes(request, { maxBytes: action === "upload" ? 11 * 1024 * 1024 : 131_072, timeoutMs: action === "upload" ? 60_000 : 15_000 });
    const endpoint = new URL(env.JV_PUBLIC_ENDPOINT);
    if (endpoint.href !== "https://yhneskzvmtcmbsknidlt.supabase.co/functions/v1/title-jv-public") return json("Application service setup is incomplete.", 503);
    const result = await fetcher(`${endpoint.href}/${action}`, { method: "POST", redirect: "error", signal: AbortSignal.timeout(60_000), headers: { "Content-Type": contentType, "X-JV-Gateway-Key": env.JV_PORTAL_GATEWAY_KEY, "X-JV-Client-IP": ip }, body });
    const headers = new Headers(policy);
    headers.set("Content-Type", result.headers.get("Content-Type") || "application/json");
    const length = result.headers.get("Content-Length");
    if (length && /^\d+$/.test(length)) headers.set("Content-Length", length);
    const disposition = result.headers.get("Content-Disposition");
    if (action === "download" && disposition) headers.set("Content-Disposition", disposition);
    // Stream bounded backend responses and originals. No cookies, CORS or upstream credentials reach recipients.
    return new Response(result.body, { status: result.status, headers });
  } catch (cause) {
    if (cause instanceof RequestBodyError) return json(cause.message, cause.status);
    return json("The application service is unavailable. Please try again.", 503);
  }
}
export default { fetch: (request, env) => portalFetch(request, env) } satisfies ExportedHandler<Env>;
