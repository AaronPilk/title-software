import type { Workspace } from "../title/model";
import { ApiError, projectWorkspace, type Access } from "./workspace";
import type { AssistantContext, AssistantSource } from "../assistant/protocol";
import { finalsQueue } from "../title/finals-queue";
import { orderSources, referencedSourceProblems } from "../title/production";
import { companyDisplayStage } from "../title/company-operating-status";
import { helpGuides, parseHelpScreen, type HelpScreen } from "../assistant/help-guides";

// Only reviewed app records and document metadata enter the assistant. File bytes,
// mail bodies, onboarding applications, credentials and contact details are omitted.
export function assistantContext(state: Workspace, access: Access, workspaceId: string, revision: number,
  companyId = "", orderId = "", helpScreen?: HelpScreen): AssistantContext {
  if (helpScreen !== undefined) {
    if (companyId || orderId) throw new ApiError("Product help does not use company or file records.", 400);
    let screen: HelpScreen;
    try { screen = parseHelpScreen(helpScreen); }
    catch { throw new ApiError("Choose a valid workspace screen for help.", 400); }
    if (access.role === "partner" && (screen.view !== "partner" || !["Partner portal", "Settings"].includes(screen.page)))
      throw new ApiError("Open help from your partner portal.", 403);
    const sources = helpGuides(access.role).map(guide => ({
      id: guide.id, label: guide.title, page: guide.page,
      facts: { summary: guide.summary, steps: guide.steps, note: guide.note || "" },
    }));
    return { userId: access.userId, workspaceId, companyId: "", orderId: "", accessVersion: access.version,
      revision, companyName: "Using Title Software", role: access.role, purpose: "help", screen,
      sources, readableSourceIds: sources.map(source => source.id), truncated: false };
  }
  if (access.role === "partner") throw new ApiError("The staff assistant is not available in the partner portal.", 403);
  const s = projectWorkspace(state, access);
  const company = s.companies.find(c => c.id === companyId);
  if (companyId && !company) throw new ApiError("Choose an available company.", 403);
  const order = s.orders.find(o => o.id === orderId && o.companyId === companyId);
  if (orderId && !order) throw new ApiError("Choose a file in the selected company.", 403);
  const sources: AssistantSource[] = [];
  const readableSourceIds: string[] = [];
  let sourceCharacters = 0;
  function add(id: string, label: string, page: string, facts: Record<string, unknown>) {
    readableSourceIds.push(id);
    const source = {id, label, page, facts}, size = JSON.stringify(source).length;
    if (sources.length < 60 && sourceCharacters + size <= 60_000) {
      sources.push(source);
      sourceCharacters += size;
    }
  }
  if (!company) {
    for (const c of s.companies) add(`company:${c.id}`, c.name, "Companies", {businessStatus:companyDisplayStage(c), workspaceSetupStage:c.stage, operatingStates:c.operatingStates || [c.jurisdiction]});
    add("workspace", "Workspace setup", "Overview", {companyCount:s.companies.length, visibleOrderCount:s.orders.length,
      visibleOpenTaskCount:s.tasks.filter(t=>!t.done).length, guidance:s.companies.length ? "Choose a company to review its files." : "Add a company, assign team access, then create or import a file."});
  } else {
    add(`company:${company.id}`, company.name, "Companies", {businessStatus:companyDisplayStage(company), workspaceSetupStage:company.stage, operatingStates:company.operatingStates || [company.jurisdiction], completedOnboardingSteps:company.steps.filter(Boolean).length, totalOnboardingSteps:company.steps.length});
    const orders = s.orders.filter(o=>o.companyId===companyId && (!orderId || o.id===orderId));
    const finals = new Map(finalsQueue({...s, orders}).map(row=>[row.order.id, row]));
    const currentSourceIds = new Set(orders.flatMap(o=>orderSources(s,o.id).map(d=>d.id)));
    // Selected file gets priority. Company-wide context is explicitly bounded.
    for (const o of orders) {
      const final = finals.get(o.id);
      add(`order:${o.id}`, `${o.id} · ${o.address}`, "Policy workbench", {fileNumber:o.id, address:o.address, status:o.status, assignee:o.owner, type:o.type, underwriter:o.underwriter, due:o.due,
        receivedAt:o.receivedAt || null, reviewedFieldCount:o.fields.filter(f=>f.reviewed).length, fieldCount:o.fields.length, delivered:o.delivered,
        finals: final ? {inBacklog:true, stage:final.stage, receivedAt:final.receivedAt, ageDays:final.ageDays,
          requestCount:final.requestCount, missingSourceCount:final.missingSourceCount, pendingFieldCount:final.pendingFieldCount,
          requiredReferenceHoldCount:referencedSourceProblems(s,o).length,
          nextStaffTask:final.stage==="Ready" ? "Open this file in the policy workbench for authorized final review." :
            final.stage==="Partially issued" ? "Review the remaining policy products; issued history is locked." :
              final.stage==="Waiting" ? "Open the file's waiting reasons and follow up on missing evidence or unresolved holds." :
                "Review the captured fields, file details and requirement clearance in the policy workbench."
        } : {inBacklog:false}});
    }
    for (const d of s.documents.filter(d=>d.companyId===companyId && (!orderId || d.orderId===orderId) && d.visibility!=="Restricted"))
      add(`document:${d.id}`, d.name, "Documents", {fileNumber:d.orderId || null, category:d.category, version:d.version, sourceRole:d.sourceRole || null,
        currentFileSource:d.orderId && d.sourceRole ? currentSourceIds.has(d.id) : null, hasSavedBytes:!!d.assetId, contentRead:false});
    for (const t of s.tasks.filter(t=>t.companyId===companyId && !t.done)) add(`task:${t.id}`, t.title, "Tasks", {assignee:t.owner, due:t.due, priority:t.priority});
    if (["owner","admin","finance"].includes(access.role)) {
      for (const c of s.business?.closes.filter(c=>c.companyId===companyId) || []) add(`close:${c.id}`, `${c.month} close`, "Financials", {status:c.status, period:c.month, totals:c.totals});
    }
  }
  return {userId:access.userId, workspaceId, companyId, orderId, accessVersion:access.version, revision,
    companyName:company?.name || "Workspace setup", role:access.role, sources, readableSourceIds, truncated:readableSourceIds.length>sources.length};
}
