import { prepareDocumentIngestion } from "../../../web/lib/backend/document-ingestion.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import { jvPortalPublicHttp } from "../../../web/lib/backend/jv-portal-http.ts";
import { portalEmailConfigured, sendJvPortalEmail } from "../../../web/lib/backend/jv-portal-email.ts";

const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
const mail = {
  apiKey: Deno.env.get("RESEND_API_KEY"),
  from: Deno.env.get("TITLE_APPLICATION_EMAIL_FROM") || "Ballantyne Title <noreply@pilk.ai>",
  portalUrl: Deno.env.get("TITLE_APPLICATION_PORTAL_URL") || "https://title-applications.aaron-9c3.workers.dev",
  staffUrl: "https://title-software-pilot.aaron-9c3.workers.dev/#agency/companies",
};
Deno.serve(request => jvPortalPublicHttp(request, {
  gatewayKey: Deno.env.get("JV_PORTAL_GATEWAY_KEY"),
  context: {
    portalUrl: mail.portalUrl, mailConfigured: portalEmailConfigured(mail),
    sendEmail: job => sendJvPortalEmail(job, mail),
    rpc: async (name, args) => { const { data, error } = await service.rpc(name, args); if (error) throw error; return data; },
    storage: {
      async upload(path, bytes, mime) {
        const clearedBytes = await prepareDocumentIngestion({ path, bytes }, { TITLE_SCANNER_URL: Deno.env.get("TITLE_SCANNER_URL"), TITLE_SCANNER_TOKEN: Deno.env.get("TITLE_SCANNER_TOKEN"), TITLE_SCANNER_TIMEOUT_MS: Deno.env.get("TITLE_SCANNER_TIMEOUT_MS") }, async (name, args) => { const result = await service.rpc(name, args); if (result.error) throw new Error("Document security is unavailable."); return result.data; });
        const { error } = await service.storage.from("title-documents").upload(path, clearedBytes, { contentType: mime, upsert: false }); if (error) throw new Error("Upload unavailable."); },
      async download(path) { const { data, error } = await service.storage.from("title-documents").download(path); if (error || !data || data.size > 10 * 1024 * 1024) throw new Error("Download unavailable."); return new Uint8Array(await data.arrayBuffer()); },
      async remove(path) { const { error } = await service.storage.from("title-documents").remove([path]); if (error) throw new Error("Storage unavailable."); },
    },
  },
}));
