import { env } from "cloudflare:workers";
import { readRequestText, RequestBodyError } from "../../../lib/shared/request-body";
export async function POST(request: Request) {
  const origin=request.headers.get("origin");
  if (origin && origin!==new URL(request.url).origin) return Response.json({error:"Open the assistant from your workspace."},{status:403});
  // Only the private pilot binds this service. Local demo remains offline.
  const binding=(env as unknown as {TITLE_ASSISTANT?: Fetcher}).TITLE_ASSISTANT;
  if (!binding) return Response.json({error:"The assistant is available in the connected pilot. Open your private workspace to use it."},{status:503});
  let body: string;
  try { body = await readRequestText(request, { maxBytes: 12000 }); }
  catch (error) {
    if (error instanceof RequestBodyError) return Response.json({error:error.message},{status:error.status});
    throw error;
  }
  const upstream = await binding.fetch("https://assistant.internal/assistant",{method:"POST",headers:{Authorization:request.headers.get("Authorization") || "",apikey:request.headers.get("apikey") || "","Content-Type":"application/json"},body});
  // Framework response headers are mutable; service fetch headers are not.
  return new Response(upstream.body, {status:upstream.status, headers:new Headers(upstream.headers)});
}
