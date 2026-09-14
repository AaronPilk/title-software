import { createClient } from 'npm:@supabase/supabase-js@2.116.0';
import { missiveRouting } from '../../../web/lib/backend/missive-routing.ts';
import { handleMissiveWebhook } from '../../../web/lib/backend/missive-webhook.ts';
const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
Deno.serve(req => handleMissiveWebhook(req, {
  workspaceId: Deno.env.get('MISSIVE_WORKSPACE_ID'),
  secret: Deno.env.get('MISSIVE_WEBHOOK_SECRET'),
  ruleIds: (Deno.env.get('MISSIVE_WEBHOOK_RULE_IDS') || '').split(',').map(v => v.trim()).filter(Boolean),
  validationOnly: Deno.env.get('MISSIVE_WEBHOOK_VALIDATION_ONLY') === 'true',
}, {
  async mapping(workspaceId) {
    const result = await service.from('title_integrations').select('status,config').eq('workspace_id', workspaceId).eq('provider', 'missive').maybeSingle();
    if (result.error) throw result.error;
    if (!result.data || result.data.status === 'disabled') return null;
    const routing = missiveRouting(result.data.config);
    return routing.mappings.some(m => m.enabled) ? routing : null;
  },
  async enqueue(workspaceId, event) {
    const result = await service.rpc('title_enqueue_missive_event', { p_workspace: workspaceId, p_event: event.payload });
    if (result.error) throw result.error;
    return result.data === true;
  },
}));
