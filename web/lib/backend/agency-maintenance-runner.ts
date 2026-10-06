import type { Task, Workspace } from "../title/model";
import { businessDay } from "../title/business-date";
import { syncAgencyMaintenance, validateAgencyMaintenance } from "../title/agency-maintenance";
import { readRequestText } from "../shared/request-body";
export type MaintenanceSnapshot = { id: string; revision: number; state: Workspace };
export type MaintenanceMailJob = { id: string; workspaceId: string; leaseToken: string; recipient: string; sender: string; companyName: string; taskTitle: string; dueOn: string; firstAttemptAt: string };
export type MaintenanceMailConfig = { apiKey?: string; from?: string; enabled?: boolean };
export type MaintenanceRunnerContext = { rpc: (name: string, input: Record<string, unknown>) => Promise<unknown>; mail: MaintenanceMailConfig; fetcher?: typeof fetch; now?: Date };
const hash = async (value: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map(v => v.toString(16).padStart(2, "0")).join("");
/** Plan only task additions; the SQL transaction appends to its locked canonical state. */
export async function maintenanceTaskAdditions(snapshot: MaintenanceSnapshot, day: string): Promise<Task[]> {
  const state = structuredClone(snapshot.state);
  validateAgencyMaintenance(state);
  const oldIds = new Set(state.tasks.map(task => task.id));
  syncAgencyMaintenance(state, day);
  const additions = state.tasks.filter(task => !oldIds.has(task.id));
  for (const task of additions) task.id = `task-maintenance-${(await hash(`${snapshot.id}:${task.phaseOne!.maintenanceId}:${task.phaseOne!.cycleOn}`)).slice(0, 40)}`;
  return additions;
}
const clean = (value: unknown, max: number): value is string => typeof value === "string" && !!value.trim() && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
export function maintenanceEmailConfigured(config: MaintenanceMailConfig) {
  return config.enabled === true && clean(config.apiKey, 500) && clean(config.from, 300) && /(?:^|<)[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>?$/.test(config.from);
}
export async function sendMaintenanceEmail(job: MaintenanceMailJob, config: MaintenanceMailConfig, fetcher: typeof fetch = fetch, now = new Date()): Promise<{ status: "sent" | "failed" | "unknown" | "manual"; providerId?: string }> {
  // Resend retains idempotency keys for 24h. Stop before that boundary, including
  // after a suspended worker wakes up with a previously leased request.
  const age = now.getTime() - Date.parse(job.firstAttemptAt);
  if (!Number.isFinite(age) || age < 0 || age >= 23 * 60 * 60 * 1000) return { status: "manual" };
  if (!maintenanceEmailConfigured(config) || !clean(job.recipient, 254) || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(job.recipient) || !clean(job.sender, 300) || !clean(job.companyName, 500) || !clean(job.taskTitle, 220) || !/^\d{4}-\d{2}-\d{2}$/.test(job.dueOn) || !/^[a-f\d-]{36}$/i.test(job.id)) return { status: "failed" };
  try {
    const response = await fetcher("https://api.resend.com/emails", { method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000), headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json", "Idempotency-Key": `title-maintenance-${job.id}` }, body: JSON.stringify({ from: job.sender, to: [job.recipient], subject: "Agency maintenance reminder", text: `${job.companyName}\n${job.taskTitle}\nDue: ${job.dueOn}\n\nSign in to the agency workspace to review this maintenance task.` }) });
    if (!response.ok) { void response.body?.cancel().catch(() => {}); return { status: response.status >= 500 || [408,409,425,429].includes(response.status) ? "unknown" : "failed" }; }
    const result: unknown = JSON.parse(await readRequestText({ body: response.body, headers: response.headers, signal: AbortSignal.timeout(15_000) }, { maxBytes: 16_384 }));
    if (!result || typeof result !== "object" || !("id" in result) || typeof result.id !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(result.id)) return { status: "unknown" };
    return { status: "sent", providerId: result.id };
  } catch { return { status: "unknown" }; }
}
export async function runAgencyMaintenance(context: MaintenanceRunnerContext) {
  const day = businessDay(context.now || new Date());
  const snapshots = await context.rpc("title_maintenance_candidates", { p_limit: 25 }) as MaintenanceSnapshot[];
  if (!Array.isArray(snapshots) || snapshots.length > 25) throw new Error("Maintenance snapshots are unavailable.");
  const summary = { scanned: 0, created: 0, queued: 0, sent: 0, needsAttention: 0, deferred: 0, failedWorkspaces: 0, deliveryEnabled: maintenanceEmailConfigured(context.mail) };
  let deliveryBudget = 10;
  for (const snapshot of snapshots) {
    try {
      const tasks = await maintenanceTaskAdditions(snapshot, day);
      const saved = await context.rpc("title_materialize_maintenance", { p_workspace: snapshot.id, p_expected: snapshot.revision, p_day: day, p_tasks: tasks }) as { created: number; queued: number };
      summary.scanned++; summary.created += saved.created; summary.queued += saved.queued;
      if (!summary.deliveryEnabled || deliveryBudget <= 0) continue;
      const jobs = await context.rpc("title_claim_maintenance_email", { p_workspace: snapshot.id, p_limit: Math.min(5, deliveryBudget), p_sender: context.mail.from }) as MaintenanceMailJob[];
      if (!Array.isArray(jobs) || jobs.length > Math.min(5, deliveryBudget)) throw new Error("Maintenance delivery queue is unavailable.");
      deliveryBudget -= jobs.length;
      await Promise.all(jobs.map(async job => {
        // Check the durable lease/settings immediately before provider I/O.
        const valid = await context.rpc("title_check_maintenance_email", { p_workspace: snapshot.id, p_id: job.id, p_lease: job.leaseToken });
        if (valid !== true) { summary.deferred++; return; }
        const outcome = await sendMaintenanceEmail(job, context.mail, context.fetcher, context.now || new Date());
        const recorded = await context.rpc("title_finish_maintenance_email", { p_workspace: snapshot.id, p_id: job.id, p_lease: job.leaseToken, p_status: outcome.status, p_provider_id: outcome.providerId || "" });
        if (recorded !== true) { summary.needsAttention++; return; }
        if (outcome.status === "sent") summary.sent++; else summary.needsAttention++;
      }));
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "PT409") summary.deferred++;
      else summary.failedWorkspaces++;
      // No state payload, private data, addresses, provider errors or tokens in output.
    }
  }
  return summary;
}
export async function handleAgencyMaintenanceTick(request: Request, serviceKey: string | undefined, context: MaintenanceRunnerContext) {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  if (request.method !== "POST") return new Response(JSON.stringify({ error: "POST required." }), { status: 405, headers });
  const supplied = request.headers.get("Authorization") || "";
  if (!serviceKey || serviceKey.length < 20 || supplied.length > 8192 || await hash(supplied) !== await hash(`Bearer ${serviceKey}`)) return new Response(JSON.stringify({ error: "Service authorization required." }), { status: 401, headers });
  try {
    const body = await readRequestText(request, { maxBytes: 1024 });
    if (body.trim() && body.trim() !== "{}") return new Response(JSON.stringify({ error: "Tick accepts no workspace data." }), { status: 400, headers });
    const summary = await runAgencyMaintenance(context);
    return new Response(JSON.stringify(summary), { status: summary.failedWorkspaces ? 503 : 200, headers });
  } catch { return new Response(JSON.stringify({ error: "Maintenance tick could not complete." }), { status: 503, headers }); }
}
