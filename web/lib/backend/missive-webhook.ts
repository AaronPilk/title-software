import { missiveRouting, missiveEventRoutes, missiveInboxRoutes, type MissiveRouting } from "./missive-routing";
/** Missive signed event intake. Queues metadata for review; never changes a title file. */
export type MissiveWebhookConfig = { workspaceId?: string; secret?: string; ruleIds?: string[]; validationOnly?: boolean };
export type WebhookMapping = { version: number; organizationId: string; teamId: string; companyId: string };
export type MissiveWebhookEvent = {
  provider: 'missive'; kind: 'incoming_review'; externalId: string;
  payload: { ruleId: string; organizationId: string; teamId: string; companyId: string | null; routingRevision?: number; candidateRoutes?: { id: string; companyId: string; version: number }[];
    messageId: string; conversationId: string; mappingVersion: number; subject: string;
    receivedAt: string; payloadHash: string };
};
export type MissiveWebhookStore = {
  mapping(workspaceId: string): Promise<WebhookMapping | MissiveRouting | null>;
  enqueue(workspaceId: string, event: MissiveWebhookEvent): Promise<boolean>;
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const id = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(v);
const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), v => v.toString(16).padStart(2, '0')).join('');
export function webhookConfigured(config: MissiveWebhookConfig) {
  return !config.validationOnly && !!config.workspaceId && typeof config.secret === 'string' && config.secret.length >= 32 &&
    !!config.ruleIds?.length && config.ruleIds.every(id);
}
export async function handleMissiveWebhook(req: Request, config: MissiveWebhookConfig, store: MissiveWebhookStore): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'POST required.' }, 405);
  const validationReady = config.validationOnly && !!config.workspaceId && typeof config.secret === 'string' && config.secret.length >= 32;
  if (!webhookConfigured(config) && !validationReady) return json({ error: 'Event intake is not configured.' }, 503);
  const signature = req.headers.get('X-Hook-Signature') || '';
  if (!/^sha256=[a-f0-9]{64}$/i.test(signature)) return json({ error: 'Invalid event signature.' }, 401);
  if (Number(req.headers.get('Content-Length') || 0) > 262144) return json({ error: 'Event exceeds 256 KB.' }, 413);
  let bytes: Uint8Array;
  try {
    const reader = req.body?.getReader();
    if (!reader) return json({ error: 'An event body is required.' }, 400);
    const chunks: Uint8Array[] = []; let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        length += value.byteLength;
        if (length > 262144) { await reader.cancel(); return json({ error: 'Event exceeds 256 KB.' }, 413); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  } catch { return json({ error: 'Unable to read event.' }, 400); }
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(config.secret!), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const supplied = Uint8Array.from(signature.slice(7).match(/../g)!, value => parseInt(value, 16));
  if (!await crypto.subtle.verify('HMAC', key, supplied, bytes as BufferSource)) return json({ error: 'Invalid event signature.' }, 401);
  let body: Record<string, unknown>;
  try { body = record(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))); }
  catch { return json({ error: 'Invalid event JSON.' }, 400); }
  // Missive validates a rule before its new ID can be enrolled. This explicit
  // setup mode authenticates that handshake but cannot persist any event.
  if (config.validationOnly) return json({ received: true, queued: false, validationOnly: true });
  const rule = record(body.rule), conversation = record(body.conversation), message = record(body.latest_message);
  const organization = record(conversation.organization), team = record(conversation.team);
  if (!id(rule.id) || !config.ruleIds!.includes(rule.id)) return json({ error: 'Event rule is not enabled.' }, 403);
  // Rule validation or a non-email event does not imply any new title work.
  if (!body.latest_message || message.type !== 'email') return json({ received: true, queued: false });
  if (!id(conversation.id) || !id(message.id) || !id(organization.id) || !id(team.id) ||
      typeof message.delivered_at !== 'number' || !Number.isFinite(message.delivered_at) || message.delivered_at <= 0 || message.delivered_at > 253402300799)
    return json({ error: 'Event identifiers are incomplete.' }, 400);
  try {
    const saved = await store.mapping(config.workspaceId!);
    if (!saved) return json({ error: 'Event inbox is outside the approved mapping.' }, 409);
    const routing = 'schemaVersion' in saved ? missiveRouting(saved) : null;
    const scope = { organizationId: organization.id, teamId: team.id };
    const candidates = routing ? missiveInboxRoutes(routing, scope) : [];
    const mapping = routing ? missiveEventRoutes(routing, scope)[0] : saved as WebhookMapping;
    if (!mapping || mapping.organizationId !== organization.id || mapping.teamId !== team.id)
      return json({ error: 'Event inbox is outside the approved mapping.' }, 409);
    const event: MissiveWebhookEvent = {
      provider: 'missive', kind: 'incoming_review',
      // Timestamp/subject changes on a replay must not enqueue the same received message again.
      externalId: `${mapping.organizationId}:${message.id}`,
      payload: { ruleId: rule.id, organizationId: mapping.organizationId, teamId: mapping.teamId,
        companyId: candidates.length > 1 ? null : mapping.companyId,
        ...(routing ? { routingRevision: routing.revision, candidateRoutes: candidates.map(m => ({ id: m.id, companyId: m.companyId, version: m.version })) } : {}), messageId: message.id, conversationId: conversation.id,
        mappingVersion: mapping.version,
        subject: typeof message.subject === 'string' ? message.subject.slice(0, 500) : '(No subject)',
        receivedAt: new Date(message.delivered_at * 1000).toISOString(),
        payloadHash: hex(await crypto.subtle.digest('SHA-256', bytes as BufferSource)) },
    };
    const created = await store.enqueue(config.workspaceId!, event);
    return json({ received: true, queued: true, replayed: !created }, 202);
  } catch { return json({ error: 'Event could not be queued. Retry later.' }, 503); }
}
