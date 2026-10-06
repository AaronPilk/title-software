import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import { handleAgencyMaintenanceTick } from "../../../web/lib/backend/agency-maintenance-runner.ts";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const service = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey!, { auth: { persistSession: false, autoRefreshToken: false } });
Deno.serve(request => handleAgencyMaintenanceTick(request, serviceKey, {
  rpc: async (name, args) => { const result = await service.rpc(name, args); if (result.error) throw result.error; return result.data; },
  mail: { enabled: Deno.env.get("TITLE_MAINTENANCE_EMAIL_ENABLED") === "true", apiKey: Deno.env.get("RESEND_API_KEY"), from: Deno.env.get("TITLE_MAINTENANCE_EMAIL_FROM") || Deno.env.get("TITLE_APPLICATION_EMAIL_FROM") },
}));
