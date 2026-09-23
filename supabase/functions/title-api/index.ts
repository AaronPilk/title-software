import { invitationEmailRedirect, sendInvitationEmail, invitationDeliveryMessage } from "../../../web/lib/backend/invitation-email.ts";
import { feedbackSubmission, feedbackUpdate, feedbackList } from "../../../web/lib/backend/feedback-validation.ts";
import { readRequestFormData, readRequestText, RequestBodyError } from "../../../web/lib/shared/request-body.ts";
import { documentByteProblem } from "../../../web/lib/shared/document-bytes.ts";
import { assistantContext } from "../../../web/lib/backend/assistant-context.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import { accountSecurity, requireAccountReady } from "../../../web/lib/backend/account-security.ts";
import { checkMissiveConnection } from "../../../web/lib/backend/missive.ts";
import { credentialStatus, credentialChange, workspaceMissiveConfig, verifyCredentialChange } from "../../../web/lib/backend/missive-credentials.ts";
import { missiveAttachmentsEnabled, existingMissiveAttachment, downloadMissiveAttachment,
  attachMissiveAttachment } from "../../../web/lib/backend/missive-attachments.ts";
import { webhookConfigured } from "../../../web/lib/backend/missive-webhook.ts";
import { listMissiveConversations, listMissiveMessages, readMissiveMessage, previewMissiveMessage,
  importMissiveText, existingMissiveImport, requireMissiveDestination, providerId,
  } from "../../../web/lib/backend/missive-import.ts";
import { missiveRouting, selectMissiveRoute, requireRoutingRevision, missiveEventRoutes } from "../../../web/lib/backend/missive-routing.ts";
import {
  ApiError,
  emptyWorkspace,
  normalizeWorkspace,
  executeCommands,
  projectWorkspace,
  allowedAsset,
  canCompany,
  safePayload,
  type Access,
} from "../../../web/lib/backend/workspace.ts";

const url = Deno.env.get("SUPABASE_URL")!;
const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Cache-Control": "no-store",
};
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
const error = (message: string, status = 400): never => {
  throw new ApiError(message, status);
};
const checked = (result: any) => {
  if (result.error)
    throw new ApiError(
      result.error.message,
      ["40001", "PT409"].includes(result.error.code)
        ? 409
        : result.error.code === "PT404"
          ? 404
        : result.error.code === "PT429"
          ? 429
        : result.error.code === "42501"
          ? 403
          : 400,
    );
  return result.data;
};
const digest = async (bytes: BufferSource) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
const uuid = (id: unknown) => {
  if (typeof id !== "string" || !/^[a-f\d-]{36}$/i.test(id))
    error("Invalid identifier.");
  return id as string;
};
const ident = (id: unknown) => {
  if (typeof id !== "string" || !/^[-\w .:@]{1,180}$/.test(id))
    error("Invalid record identifier.");
  return id as string;
};
function expectedVersion(value: unknown) {
  if (!Number.isSafeInteger(value) || (value as number) < 1) error("Refresh the access list and review this change.", 409);
  return value as number;
}
function invitationGrant(input: any) {
  if (typeof input.email !== "string" || input.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) error("Enter an email address.");
  if (!["admin", "operations", "onboarding", "finance", "viewer", "partner"].includes(input.role)) error("Choose a role.");
  if (typeof input.allCompanies !== "boolean" || typeof input.restricted !== "boolean") error("Choose explicit access permissions.");
  if (!Array.isArray(input.companyIds) || input.companyIds.length > 250) error("Choose existing companies.");
  const companies = [...new Set(input.companyIds.map(ident))].sort();
  if (!Array.isArray(input.partnerMembers) || input.partnerMembers.length > 250) error("Choose existing company members.");
  const partners = input.partnerMembers.map((member: any) => {
    if (!member || typeof member.memberName !== "string" || !member.memberName.trim() || member.memberName.length > 500) error("Choose an existing company member.");
    return { companyId: ident(member.companyId), memberName: member.memberName };
  });
  return { p_recipient: input.email.trim().toLowerCase(), p_role: input.role, p_companies: companies,
    p_all_companies: input.allCompanies, p_restricted: input.restricted, p_partner_members: partners };
}
async function body(req: Request, maxBytes = 8_000_000) {
  const raw = await readRequestText(req, { maxBytes, tooLargeMessage: maxBytes === 8_000_000 ? "Request exceeds 8 MB." : "Feedback request exceeds 32 KiB." });
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    error("Invalid JSON.");
  }
  safePayload(value);
  return value;
}

async function memberIdentities(memberships: any[]) {
  const members: any[] = [];
      const identityDeadline = Date.now() + 8000;
      const identityClient = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { fetch: (input, init) => fetch(input, {
          ...init,
          signal: AbortSignal.any([
            ...(init?.signal ? [init.signal] : []),
            AbortSignal.timeout(Math.max(1, Math.min(3000, identityDeadline - Date.now()))),
          ]),
        }) },
      });
      // Resolve only IDs already scoped to this workspace. Keep Auth traffic
      // bounded, and never return the Auth profile or its metadata to the UI.
      for (let offset = 0; offset < memberships.length; offset += 4) {
        const batch = await Promise.all(memberships.slice(offset, offset + 4).map(async (membership: any) => {
          let email: string | null = null;
          if (Date.now() >= identityDeadline) return { ...membership, email };
          try {
            const lookup = await identityClient.auth.admin.getUserById(membership.user_id);
            if (!lookup.error && lookup.data?.user?.id === membership.user_id &&
              typeof lookup.data.user.email === "string" && lookup.data.user.email.trim())
              email = lookup.data.user.email.trim();
          } catch {
            // One unavailable identity must not hide the other workspace members.
          }
          return { ...membership, email };
        }));
        members.push(...batch);
      }
  return members;
}
async function actor(req: Request) {
  const authorization = req.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) error("Sign in to continue.", 401);
  const token = authorization.slice(7);
  const { data, error: authError } = await service.auth.getUser(token);
  if (authError || !data.user)
    error("Your sign-in expired. Sign in again.", 401);
  if (
    data.user.is_anonymous ||
    !data.user.email_confirmed_at ||
    !data.user.email
  )
    error("Confirm your email before opening company records.", 403);
  const claims = await service.auth.getClaims(token);
  if (claims.error || claims.data?.claims.sub !== data.user.id)
    error("Your sign-in expired. Sign in again.", 401);
  const sessionId = claims.data.claims.session_id;
  if (typeof sessionId !== "string" || !/^[a-f\d-]{36}$/i.test(sessionId))
    error("Your sign-in expired. Sign in again.", 401);
  const facts = checked(await service.rpc("title_security_state", {
    p_user: data.user.id, p_session: sessionId,
  }));
  if (!facts) error("Your sign-in expired. Sign in again.", 401);
  return { id: data.user.id, email: data.user.email!, sessionId,
    credentialVersion: facts.credential_version ?? null,
    security: accountSecurity(data.user.email!, claims.data.claims.aal, facts) };
}
async function access(
  workspaceId: string,
  user: { id: string; email: string },
): Promise<Access> {
  const m = checked(
    await service
      .from("title_memberships")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("user_id", user.id)
      .eq("active", true)
      .maybeSingle(),
  );
  if (!m) error("This workspace is not available to your account.", 403);
  return {
    userId: user.id,
    email: user.email,
    role: m.role,
    companyIds: m.company_ids,
    allCompanies: m.all_companies,
    restricted: m.restricted_access,
    version: m.version,
    partnerMembers: m.partner_members,
  };
}
async function workspace(id: string) {
  const w = checked(
    await service.from("title_workspaces").select("*").eq("id", id).single(),
  );
  return w;
}
async function stateResponse(id: string, a: Access) {
  const w = await workspace(id);
  const audit = checked(
    await service
      .from("title_audit")
      .select("id,actor_email,action,company_ids,detail,created_at")
      .eq("workspace_id", id)
      .order("id", { ascending: false })
      .limit(100),
  );
  const projected = projectWorkspace(w.state, a);
  if (a.role !== "partner")
    projected.activity = audit
      .filter(
        (r: any) =>
          a.allCompanies ||
          (r.company_ids.length &&
            r.company_ids.every((c: string) => canCompany(a, c))),
      )
      .map((r: any) => ({
        id: String(r.id),
        title: r.action,
        detail: (r.detail?.actions || []).join(", "),
        actor: r.actor_email,
        at: r.created_at,
      }));
  return {
    workspaceId: id,
    name: w.name,
    revision: w.revision,
    state: projected,
    access: a,
  };
}
function administrator(a: Access) {
  if (a.role !== "owner" && !(a.role === "admin" && a.allCompanies))
    error("Organization-wide administrator access is required.", 403);
}
async function checkAssets(state: any, id: string) {
  const assets = checked(
    await service
      .from("title_assets")
      .select("id,company_id,document_id,sha256,byte_size,mime,filename")
      .eq("workspace_id", id),
  );
  for (const d of state.documents)
    if (
      d.assetId &&
      !assets.some(
        (a: any) =>
          a.id === d.assetId &&
          a.company_id === d.companyId &&
          a.document_id === d.id && (!d.providerSource ||
            (a.sha256 === d.providerSource.sha256 && a.byte_size === d.providerSource.bytes &&
             a.mime === d.providerSource.mime && a.filename === d.providerSource.filename)),
      )
    )
      error("A document refers to an unavailable or differently owned upload.");
}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: cors });
  try {
    const user = await actor(req);
    const pathname =
      new URL(req.url).pathname.replace(/^.*\/title-api/, "") || "/";
    if (pathname === "/security/status" && req.method === "GET")
      return response(user.security);
    if (pathname === "/security/password" && req.method === "POST") {
      if (user.security.step === "challenge")
        error("Verify your authenticator before changing your password.", 403);
      const input = await body(req);
      if (typeof input.password !== "string" || input.password.length < 12 || input.password.length > 128)
        error("Use a password between 12 and 128 characters.");
      const changed = await fetch(`${url}/auth/v1/user`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", apikey: Deno.env.get("SUPABASE_ANON_KEY")!,
          Authorization: req.headers.get("Authorization")! },
        body: JSON.stringify({ password: input.password,
          ...(typeof input.nonce === "string" && input.nonce ? { nonce: input.nonce } : {}) }),
        signal: AbortSignal.timeout(20000),
      });
      const result = await changed.json();
      if (!changed.ok) return response({ error: result.msg || result.message || "Password change failed.",
        code: result.error_code || result.code }, changed.status);
      if (result.id !== user.id) error("Password change could not be verified.", 500);
      const completionArgs = {
        p_user: user.id, p_session: user.sessionId, p_expected_rotation: user.credentialVersion,
      };
      let completionStatus = 503;
      // Auth already accepted the new password. Retry only the idempotent setup
      // confirmation, bound to the original session and credential rotation.
      for (let attempt = 0; attempt < 2; attempt++) {
        let completed;
        try {
          completed = await service.rpc("title_complete_password_change", completionArgs)
            .abortSignal(AbortSignal.timeout(4000));
        } catch {
          continue;
        }
        if (!completed.error) return response({ updated: true });
        const code = completed.error.code || "";
        if (code === "PT409" || code === "42501") {
          completionStatus = code === "PT409" ? 409 : 403;
          break;
        }
        const transient = !code || code.startsWith("08") ||
          ["40001", "40P01", "55P03", "57014", "57P01", "57P02", "57P03", "PGRST000", "PGRST001", "PGRST002"].includes(code) ||
          completed.status >= 500;
        if (!transient) break;
      }
      return response({ code: "password_setup_incomplete",
        error: "Your password change was accepted, but setup could not be confirmed. Sign out and sign in again. If password setup is still required, choose another new password; contact the workspace owner if sign-in fails.",
      }, completionStatus);
    }
    requireAccountReady(user.security);
    if (pathname === "/session" && req.method === "GET") {
      checked(
        await service.rpc("title_claim_access", {
          p_actor: user.id,
          p_email: user.email,
          p_state: emptyWorkspace(user.email),
        }),
      );
      const rows = checked(
        await service
          .from("title_memberships")
          .select("workspace_id,role")
          .eq("user_id", user.id)
          .eq("active", true),
      );
      return response({ user: { id: user.id, email: user.email }, workspaces: rows });
    }
    if (pathname === "/feedback" || pathname === "/feedback/update") {
      if (pathname === "/feedback" && req.method === "GET") {
        const params = new URL(req.url).searchParams;
        if (new Set(params.keys()).size !== [...params.keys()].length) error("Duplicate feedback query fields.");
        const input = feedbackList(Object.fromEntries(params));
        const a = await access(input.workspaceId, user);
        return response(checked(await service.rpc("title_list_feedback", {
          p_workspace: input.workspaceId, p_actor: user.id, p_actor_version: a.version,
          p_limit: input.limit, p_before: input.before, p_before_id: input.beforeId,
        })));
      }
      if (req.method !== "POST") error("Feedback supports GET and POST only.", 405);
      const raw = await body(req, 32_768);
      if (pathname === "/feedback") {
        const input = feedbackSubmission(raw);
        const a = await access(input.workspaceId, user);
        return response(checked(await service.rpc("title_submit_feedback", {
          p_workspace: input.workspaceId, p_actor: user.id, p_email: user.email, p_actor_version: a.version,
          p_id: input.id, p_kind: input.kind, p_message: input.message, p_page: input.page, p_view: input.view,
        })));
      }
      const input = feedbackUpdate(raw);
      const a = await access(input.workspaceId, user);
      if (a.role !== "owner") error("Only the workspace owner can respond to feedback.", 403);
      return response(checked(await service.rpc("title_update_feedback", {
        p_workspace: input.workspaceId, p_actor: user.id, p_actor_version: a.version,
        p_id: input.id, p_expected_version: input.expectedVersion, p_status: input.status, p_reply: input.reply,
      })));
    }
    const input =
      req.method === "GET"
        ? Object.fromEntries(new URL(req.url).searchParams)
        : pathname === "/assets/upload"
          ? null
          : await body(req);
    if (pathname === "/assets/upload" && req.method === "POST") {
      const form = await readRequestFormData(req, { maxBytes: 52_500_000, timeoutMs: 120_000, tooLargeMessage: "Upload exceeds 50 MB." });
      const wid = uuid(form.get("workspaceId")),
        id = ident(form.get("id")),
        companyId = ident(form.get("companyId")),
        documentId = ident(form.get("documentId"));
      const a = await access(wid, user);
      if (
        ["partner", "viewer", "finance"].includes(a.role) ||
        !canCompany(a, companyId)
      )
        error("You cannot upload to this company.", 403);
      const w = await workspace(wid);
      if (!w.state.companies.some((c: any) => c.id === companyId))
        error("Choose a company.");
      const file = form.get("file");
      if (!(file instanceof File) || file.size > 52_428_800)
        error("Choose a file up to 50 MB.", 413);
      const allowed = [
        "application/pdf",
        "text/plain",
        "text/csv",
        "image/png",
        "image/jpeg",
        "image/webp",
        "image/gif",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/msword",
        "application/vnd.ms-excel",
        "application/octet-stream",
      ];
      const mime = file.type || "application/octet-stream";
      if (!allowed.includes(mime)) error("This file type is not supported.");
      const bytes = await file.arrayBuffer();
      const problem = documentByteProblem(new Uint8Array(bytes), mime);
      if (problem) error(problem);
      const hash = await digest(bytes);
      const prior = checked(
        await service
          .from("title_assets")
          .select("*")
          .eq("workspace_id", wid)
          .eq("id", id)
          .maybeSingle(),
      );
      if (prior) {
        if (
          prior.sha256 !== hash ||
          prior.company_id !== companyId ||
          prior.document_id !== documentId
        )
          error("This file version is immutable. Upload a new version.", 409);
        return response({ id, sha256: hash, bytes: file.size });
      }
      const path = `${wid}/${crypto.randomUUID()}`;
      checked(
        await service.storage
          .from("title-documents")
          .upload(path, bytes, { contentType: mime, upsert: false }),
      );
      const inserted = await service
        .from("title_assets")
        .insert({
          workspace_id: wid,
          id,
          company_id: companyId,
          document_id: documentId,
          object_path: path,
          mime,
          filename: file.name,
          byte_size: file.size,
          sha256: hash,
          uploaded_by: user.id,
        });
      if (inserted.error) {
        await service.storage.from("title-documents").remove([path]);
        checked(inserted);
      }
      return response({ id, sha256: hash, bytes: file.size });
    }
    const wid = uuid(input.workspaceId),
      a = await access(wid, user);
    if (pathname === "/assistant/context" && req.method === "POST") {
      const w = await workspace(wid);
      return response(assistantContext(w.state, a, wid, w.revision,
        input.companyId ? ident(input.companyId) : "", input.orderId ? ident(input.orderId) : ""));
    }
    if (pathname === "/state" && req.method === "GET")
      return response(await stateResponse(wid, a));
    if (pathname === "/staff/assignable" && req.method === "POST") {
      if (["partner", "viewer"].includes(a.role)) error("Staff assignment is not available to this account.", 403);
      if (!["task", "order"].includes(input.kind)) error("Choose an assignment type.");
      const w = await workspace(wid);
      const companyId = input.companyId ? ident(input.companyId) : "";
      const companies = w.state.companies.filter((c: any) => canCompany(a, c.id) && (!companyId || c.id === companyId)).map((c: any) => c.id);
      if (companyId && !companies.length) error("This company is not available to your account.", 403);
      const roles = input.kind === "order" ? ["owner", "admin", "operations"] : ["owner", "admin", "operations", "onboarding", "finance"];
      const memberships = checked(await service.from("title_memberships")
        .select("user_id,role,company_ids,all_companies,active").eq("workspace_id", wid).eq("active", true))
        .filter((m: any) => roles.includes(m.role) && companies.some((id: string) => m.all_companies || m.company_ids.includes(id)));
      const resolved = await memberIdentities(memberships);
      return response({ staff: resolved.filter((m: any) => m.email).map((m: any) => ({ userId: m.user_id, email: m.email, label: m.email })),
        unavailable: resolved.filter((m: any) => !m.email).length });
    }
    if (pathname === "/commands" && req.method === "POST") {
      const requestId = uuid(input.requestId),
        hash = await digest(
          new TextEncoder().encode(
            JSON.stringify({
              expectedRevision: input.expectedRevision,
              commands: input.commands,
            }),
          ),
        );
      const receipt = checked(
        await service
          .from("title_command_receipts")
          .select("*")
          .eq("workspace_id", wid)
          .eq("request_id", requestId)
          .maybeSingle(),
      );
      if (receipt) {
        if (receipt.actor_id !== user.id || receipt.payload_hash !== hash)
          error("This request ID already represents a different change.", 409);
        return response({ ...(await stateResponse(wid, a)), replayed: true });
      }
      const w = await workspace(wid);
      if (w.revision !== input.expectedRevision)
        error(
          "Someone saved a newer version. Refresh and review your change.",
          409,
        );
      // Resolve only explicitly selected stable account IDs. Display labels from
      // a stale or modified client cannot become authoritative assignment data.
      const selectedIds = new Set<string>();
      for (const command of Array.isArray(input.commands) ? input.commands : []) {
        if (!command || typeof command !== "object" || command.name !== "editDraft" || !Array.isArray(command.args?.[0])) continue;
        for (const edit of command.args[0]) if (edit && typeof edit === "object" && ["tasks", "orders"].includes(edit.table) && edit.value?.assigneeId)
          selectedIds.add(uuid(edit.value.assigneeId));
      }
      if (selectedIds.size) {
        const memberships = checked(await service.from("title_memberships")
          .select("user_id,role,company_ids,all_companies,active").eq("workspace_id", wid).eq("active", true))
          .filter((m: any) => selectedIds.has(m.user_id));
        a.assignableStaff = (await memberIdentities(memberships)).filter((m: any) => m.email)
          .map((m: any) => ({ userId: m.user_id, email: m.email, role: m.role, companyIds: m.company_ids, allCompanies: m.all_companies }));
      }
      const next = executeCommands(w.state, input.commands, { ...a, requireStaffAssignments: true });
      await checkAssets(next, wid);
      const changed = new Set<string>();
      for (const c of next.companies)
        if (JSON.stringify(w.state).includes(c.id)) changed.add(c.id); // Audit scope is conservative; restricted staff never see another company's event.
      const result = checked(
        await service.rpc("title_commit", {
          p_workspace: wid,
          p_actor: user.id,
          p_email: user.email,
          p_access_version: a.version,
          p_expected: input.expectedRevision,
          p_request: requestId,
          p_hash: hash,
          p_state: next,
          p_actions: input.commands.map((c: any) => c.name),
          p_companies: [...changed],
        }),
      );
      return response({
        ...(await stateResponse(wid, { ...a, assignableStaff: undefined })),
        replayed: result.replayed,
      });
    }
    if (pathname === "/assets/download" && req.method === "GET") {
      const w = await workspace(wid),
        id = ident(input.id);
      if (!allowedAsset(w.state, a, id))
        error("Document is not available to this account.", 403);
      const asset = checked(
        await service
          .from("title_assets")
          .select("*")
          .eq("workspace_id", wid)
          .eq("id", id)
          .maybeSingle(),
      );
      if (!asset) error("Document bytes are unavailable.", 404);
      const blob = checked(
        await service.storage
          .from("title-documents")
          .download(asset.object_path),
      );
      return new Response(blob, {
        headers: {
          ...cors,
          "Content-Type": asset.mime,
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(asset.filename)}`,
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    if (pathname === "/members" && req.method === "GET") {
      administrator(a);
      const memberships = checked(
        await service
          .from("title_memberships")
          .select(
            "user_id,role,company_ids,all_companies,restricted_access,partner_members,active,version",
          )
          .eq("workspace_id", wid),
      );
      const members = await memberIdentities(memberships);
      const invitations = checked(await service.from("title_invitations")
        .select("id,email,role,company_ids,all_companies,restricted_access,partner_members,accepted_at,revoked_at,expires_at,version,updated_at,last_action")
        .eq("workspace_id", wid));
      const deliveries = checked(await service.rpc("title_invitation_delivery_status", {
        p_workspace: wid, p_actor: user.id, p_access_version: a.version,
      }));
      return response({ members,
        emailDeliveryEnabled: !!invitationEmailRedirect(Deno.env.get("TITLE_INVITATION_EMAIL_ENABLED"), Deno.env.get("TITLE_INVITATION_REDIRECT_URL")),
        invitations: invitations.map((invitation: any) => {
          const delivery = deliveries.find((d: any) => d.invitation_id === invitation.id);
          const status = delivery?.status === "sending" && Date.parse(delivery.created_at) < Date.now() - 300_000 ? "unknown" : delivery?.status || "not_sent";
          return { ...invitation, delivery_status: status, delivery_at: delivery?.finished_at || delivery?.created_at || null };
        }),
      });
    }
    if (pathname === "/members/invitations/send" && req.method === "POST") {
      administrator(a);
      const redirect = invitationEmailRedirect(Deno.env.get("TITLE_INVITATION_EMAIL_ENABLED"), Deno.env.get("TITLE_INVITATION_REDIRECT_URL"));
      if (!redirect) error("Email delivery needs owner setup. The access invitation can still be prepared.", 503);
      const requestId = uuid(input.requestId);
      const delivery = checked(await service.rpc("title_begin_invitation_email", {
        p_workspace: wid, p_actor: user.id, p_email: user.email, p_access_version: a.version,
        p_invitation: uuid(input.invitationId), p_expected: expectedVersion(input.expectedVersion), p_request: requestId,
      }));
      if (!delivery.send) return response({ id: delivery.id, status: delivery.status, recorded: true,
        message: invitationDeliveryMessage(delivery.status) });
      const timeout = AbortSignal.timeout(15_000);
      const mailClient = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { fetch: (input, init) => fetch(input, { ...init,
          signal: AbortSignal.any([timeout, ...(init?.signal ? [init.signal] : [])]),
        }) },
      });
      const status = await sendInvitationEmail(mailClient, delivery, redirect!);
      let recorded = false;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const result = await service.rpc("title_finish_invitation_email", {
            p_workspace: wid, p_actor: user.id, p_email: user.email, p_delivery: delivery.id, p_request: requestId, p_status: status,
          }).abortSignal(AbortSignal.timeout(4000));
          if (!result.error) { recorded = true; break; }
          if (["42501", "40001"].includes(result.error.code || "")) break;
        } catch { /* Retry only recording this same outcome, never the provider send. */ }
      }
      return response({ id: delivery.id, status, recorded, message: invitationDeliveryMessage(status, recorded) });
    }
    if (pathname === "/members/invite" && req.method === "POST") {
      administrator(a);
      const grant = invitationGrant(input);
      const invitationId = input.invitationId === undefined ? null : uuid(input.invitationId);
      const result = checked(await service.rpc("title_prepare_invitation", {
        p_workspace: wid, p_actor: user.id, p_email: user.email, p_access_version: a.version,
        ...grant, p_invitation: invitationId,
        p_expected: invitationId ? expectedVersion(input.expectedVersion) : null,
        p_reissue: false, p_request: invitationId ? null : uuid(input.requestId),
      }));
      if (Date.parse(result.expires_at) <= Date.now()) error("This invitation has expired. Refresh the list and renew it explicitly.", 409);
      if (result.accepted_at || result.revoked_at) error("This invitation was already accepted or cancelled. Refresh the list before preparing another grant.", 409);
      return response({ ...result, status: invitationId
        ? "Access invitation updated; no email sent"
        : result.replayed ? "Access invitation already prepared; no email sent" : "Access invitation prepared; no email sent" });
    }
    if (pathname === "/members/invitations/cancel" && req.method === "POST") {
      administrator(a);
      const result = checked(await service.rpc("title_cancel_invitation", {
        p_workspace: wid, p_actor: user.id, p_email: user.email, p_access_version: a.version,
        p_invitation: uuid(input.invitationId), p_expected: expectedVersion(input.expectedVersion),
      }));
      return response({ ...result, status: "Access invitation cancelled; existing memberships were not changed" });
    }
    if (pathname === "/members/invitations/reissue" && req.method === "POST") {
      administrator(a);
      const invitationId = uuid(input.invitationId);
      const row = checked(await service.from("title_invitations")
        .select("email,role,company_ids,all_companies,restricted_access,partner_members")
        .eq("workspace_id", wid).eq("id", invitationId).maybeSingle());
      if (!row) error("This invitation is not available.", 404);
      const result = checked(await service.rpc("title_prepare_invitation", {
        p_workspace: wid, p_actor: user.id, p_email: user.email, p_access_version: a.version,
        p_recipient: row.email, p_role: row.role, p_companies: row.company_ids,
        p_all_companies: row.all_companies, p_restricted: row.restricted_access,
        p_partner_members: row.partner_members, p_invitation: invitationId,
        p_expected: expectedVersion(input.expectedVersion), p_reissue: true, p_request: null,
      }));
      return response({ ...result, status: "Access invitation reissued for seven days; no email sent" });
    }
    if (pathname === "/members/revoke" && req.method === "POST") {
      administrator(a);
      const result = checked(await service.rpc("title_revoke_member", {
        p_workspace: wid, p_actor: user.id, p_email: user.email, p_access_version: a.version,
        p_target: uuid(input.userId), p_expected: expectedVersion(input.expectedVersion),
      }));
      return response(result);
    }
    if (pathname.startsWith("/integrations/missive")) {
      administrator(a);
      // The single explicitly bootstrapped workspace is the default token owner.
      // A server override can bind a different workspace during a reviewed move.
      const bootstrap = checked(await service.from("title_bootstrap").select("workspace_id").eq("singleton", true).maybeSingle());
      const fallback = { token: Deno.env.get("MISSIVE_API_TOKEN"), workspaceId: Deno.env.get("MISSIVE_WORKSPACE_ID") || bootstrap?.workspace_id };
      const credentialResult = await service.rpc("title_missive_credential_status", {
        p_workspace: wid, p_actor: user.id, p_access_version: a.version,
      });
      if (credentialResult.error) error(credentialResult.error.code === "42501" ? "Administrator access changed. Sign in again." :
        "Missive connection could not be loaded. Open connection settings to replace or disconnect the token.",
        credentialResult.error.code === "42501" ? 403 : 500);
      const credential = credentialResult.data;
      if (pathname === "/integrations/missive/credential" && req.method === "GET")
        return response(credentialStatus(credential, fallback, wid));
      if (pathname === "/integrations/missive/credential" && req.method === "POST") {
        const proposed = credentialChange(input);
        if (proposed.expectedRevision !== credential.revision) error("Missive connection changed. Refresh before saving.", 409);
        const { change } = await verifyCredentialChange(input, wid, a);
        // Only fixed metadata is returned. Neither vendor bodies nor tokens are logged.
        const result = await service.rpc("title_save_missive_credential", { p_workspace: wid,
          p_actor: user.id, p_access_version: a.version, p_expected: change.expectedRevision, p_token: change.token });
        if (result.error) error(result.error.code === "PT409" ? "Missive connection changed. Refresh before saving." :
          result.error.code === "42501" ? "Administrator access changed. Sign in again." : "Unable to save the Missive connection.",
          result.error.code === "PT409" ? 409 : result.error.code === "42501" ? 403 : 500);
        return response(result.data);
      }
      const attachmentOrigins = (Deno.env.get("MISSIVE_ATTACHMENT_ORIGINS") || "").split(",").map(v => v.trim()).filter(Boolean);
      // Inspecting saved setup/events and pausing a route must remain available
      // during a provider/Vault outage. Decrypt only for an actual provider read.
      async function providerConfig() {
        const result = await service.rpc("title_read_missive_credential", { p_workspace: wid, p_actor: user.id, p_access_version: a.version });
        if (result.error) error(result.error.code === "42501" ? "Administrator access changed. Sign in again." :
          "Missive connection could not be loaded. Open connection settings to replace or disconnect the token.", result.error.code === "42501" ? 403 : 500);
        return { ...workspaceMissiveConfig(result.data, fallback, wid), attachmentOrigins };
      }
      const integration = checked(await service.from("title_integrations").select("config,status").eq("workspace_id", wid).eq("provider", "missive").maybeSingle());
      const routing = missiveRouting(integration?.config);
      const routingRevision = input.expectedRoutingRevision ?? input.expectedMappingVersion;
      const connectionStatus = credentialStatus(credential, fallback, wid);
      const setup = { status: connectionStatus.configured ? "ready" : "token_required", importEnabled: connectionStatus.configured };
      if (pathname === "/integrations/missive" && req.method === "GET") return response({ ...setup, routing, mapping: routing.mappings.length === 1 ? routing.mappings[0] : null,
        attachmentDownloadEnabled: setup.importEnabled && missiveAttachmentsEnabled({ attachmentOrigins }) });
      if (pathname === "/integrations/missive/check" && req.method === "POST") return response(await checkMissiveConnection(await providerConfig(), wid, a));
      if (pathname === "/integrations/missive/mapping" && req.method === "POST") {
        requireRoutingRevision(routing, routingRevision);
        if (input.enabled !== undefined && typeof input.enabled !== "boolean") error("Invalid route status.");
        const companyId = ident(input.companyId), teamId = providerId(input.teamId);
        const previous = routing.mappings.find(m => m.companyId === companyId && m.teamId === teamId && m.id === input.mappingId);
        let team: { id: string; name: string; organizationId: string } | undefined;
        if (input.enabled === false) {
          if (!previous) error("Choose an existing route to pause.", 409);
          team = { id: previous.teamId, name: previous.teamName, organizationId: previous.organizationId };
        } else {
          const discovery = await checkMissiveConnection(await providerConfig(), wid, a);
          team = discovery.teamInboxes.find(t => t.id === teamId);
          if (!team || !discovery.organizations.some(o => o.id === team.organizationId)) error("Choose a verified team inbox.", 409);
        }
        const saved = checked(await service.rpc("title_save_missive_route", {
          p_workspace: wid, p_actor: user.id, p_email: user.email, p_access_version: a.version,
          p_expected: routingRevision, p_mapping: { companyId, teamId, teamName: team.name, organizationId: team.organizationId, enabled: input.enabled !== false },
        }));
        return response({ routing: missiveRouting(saved) });
      }
      requireRoutingRevision(routing, routingRevision);
      const w = await workspace(wid);
      if (pathname === "/integrations/missive/events" && req.method === "POST") {
        const offset = input.offset ?? 0;
        if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000) error("Invalid event page.");
        const jobs = checked(await service.rpc("title_pending_missive_events", { p_workspace: wid, p_offset: offset }));
        return response({ events: jobs.slice(0, 100).map((j: any) => ({ id: j.id, messageId: j.payload.messageId,
            conversationId: j.payload.conversationId, subject: j.payload.subject, receivedAt: j.payload.receivedAt,
            mappingVersion: j.payload.mappingVersion, status: j.status, companyId: j.payload.companyId,
            organizationId: j.payload.organizationId, teamId: j.payload.teamId,
            candidateRouteIds: missiveEventRoutes(routing, j.payload).map(m => m.id),
            originallyShared: Array.isArray(j.payload.candidateRoutes) && j.payload.candidateRoutes.length > 1 })),
          nextOffset: jobs.length > 100 ? offset + 100 : null,
          webhookConfigured: Deno.env.get("MISSIVE_WORKSPACE_ID") === wid && webhookConfigured({ workspaceId: Deno.env.get("MISSIVE_WORKSPACE_ID"),
            secret: Deno.env.get("MISSIVE_WEBHOOK_SECRET"), validationOnly: Deno.env.get("MISSIVE_WEBHOOK_VALIDATION_ONLY") === "true",
            ruleIds: (Deno.env.get("MISSIVE_WEBHOOK_RULE_IDS") || "").split(",").map(v => v.trim()).filter(Boolean) }) });
      }
      if (!routing.mappings.length || integration?.status === "disabled") error("Review an inbox-to-company mapping first.", 409);
      const legacyRouteId = integration?.config?.schemaVersion !== 2 && routing.mappings.length === 1 ? routing.mappings[0].id : undefined;
      const mapping = selectMissiveRoute(routing, routingRevision, input.mappingId ?? legacyRouteId);
      requireMissiveDestination(w.state, mapping);
      if (pathname === "/integrations/missive/attachments/import" && req.method === "POST") {
        const requestId = uuid(input.requestId), messageId = providerId(input.messageId), attachmentId = providerId(input.attachmentId);
        const hash = await digest(new TextEncoder().encode(JSON.stringify({ action: "importMissiveAttachment", messageId, attachmentId,
          expectedRevision: input.expectedRevision, expectedRoutingRevision: routingRevision, mappingId: mapping.id })));
        const receipt = checked(await service.from("title_command_receipts").select("actor_id,payload_hash").eq("workspace_id", wid).eq("request_id", requestId).maybeSingle());
        if (receipt) {
          if (receipt.actor_id !== user.id || receipt.payload_hash !== hash) error("This request ID already represents a different change.", 409);
          return response({ ...(await stateResponse(wid, a)), replayed: true });
        }
        if (existingMissiveAttachment(w.state, a, mapping, messageId, attachmentId))
          return response({ ...(await stateResponse(wid, a)), alreadyImported: true });
        if (w.revision !== input.expectedRevision) error("Someone saved a newer version. Refresh before importing.", 409);
        const artifact = await downloadMissiveAttachment(await providerConfig(), wid, a, mapping, w.state, messageId, attachmentId);
        let asset = checked(await service.from("title_assets").select("*").eq("workspace_id", wid).eq("id", artifact.assetId).maybeSingle());
        if (!asset) {
          const objectPath = `${wid}/${crypto.randomUUID()}`;
          checked(await service.storage.from("title-documents").upload(objectPath, artifact.bytes, { contentType: artifact.mime, upsert: false }));
          const inserted = await service.from("title_assets").insert({ workspace_id: wid, id: artifact.assetId,
            company_id: artifact.companyId, document_id: artifact.documentId, object_path: objectPath, mime: artifact.mime,
            filename: artifact.filename, byte_size: artifact.bytes.length, sha256: artifact.sha256, uploaded_by: user.id });
          if (inserted.error) {
            await service.storage.from("title-documents").remove([objectPath]);
            if (inserted.error.code !== "23505") checked(inserted);
          }
          asset = checked(await service.from("title_assets").select("*").eq("workspace_id", wid).eq("id", artifact.assetId).single());
        }
        if (asset.sha256 !== artifact.sha256 || asset.company_id !== artifact.companyId || asset.document_id !== artifact.documentId ||
            asset.byte_size !== artifact.bytes.length || asset.filename !== artifact.filename || asset.mime !== artifact.mime)
          error("This attachment's saved bytes no longer match its source. Review before continuing.", 409);
        const next = await attachMissiveAttachment(w.state, a, mapping, artifact, requestId);
        await checkAssets(next, wid);
        checked(await service.rpc("title_import_missive_routed", { p_workspace: wid, p_actor: user.id, p_email: user.email,
          p_access_version: a.version, p_expected: input.expectedRevision, p_request: requestId, p_hash: hash, p_state: next,
          p_mapping_version: mapping.version, p_company: mapping.companyId, p_routing_revision: routingRevision, p_mapping_id: mapping.id,
          p_action: "importMissiveAttachment" }));
        return response({ ...(await stateResponse(wid, a)), imported: true });
      }
      if (pathname === "/integrations/missive/conversations" && req.method === "POST")
        return response(await listMissiveConversations(await providerConfig(), wid, a, mapping, input.until));
      if (pathname === "/integrations/missive/messages" && req.method === "POST")
        return response(await listMissiveMessages(await providerConfig(), wid, a, mapping, input.conversationId, input.until));
      if (pathname === "/integrations/missive/preview" && req.method === "POST")
        return response(await previewMissiveMessage(await readMissiveMessage(await providerConfig(), wid, a, mapping, input.messageId)));
      if (pathname === "/integrations/missive/import" && req.method === "POST") {
        const requestId = uuid(input.requestId), messageId = providerId(input.messageId), orderId = ident(input.orderId);
        const hash = await digest(new TextEncoder().encode(JSON.stringify({
          action: "importMissiveText", messageId, orderId, kind: input.kind, fingerprint: input.fingerprint,
          expectedRevision: input.expectedRevision, expectedRoutingRevision: routingRevision, mappingId: mapping.id,
        })));
        const receipt = checked(await service.from("title_command_receipts").select("actor_id,payload_hash").eq("workspace_id", wid).eq("request_id", requestId).maybeSingle());
        if (receipt) {
          if (receipt.actor_id !== user.id || receipt.payload_hash !== hash) error("This request ID already represents a different change.", 409);
          return response({ ...(await stateResponse(wid, a)), replayed: true });
        }
        const existing = existingMissiveImport(w.state, mapping.organizationId, messageId, mapping.companyId, orderId);
        if (existing) {
          return response({ ...(await stateResponse(wid, a)), alreadyImported: true });
        }
        if (w.revision !== input.expectedRevision) error("Someone saved a newer version. Refresh and review before importing.", 409);
        requireMissiveDestination(w.state, mapping, orderId);
        const message = await readMissiveMessage(await providerConfig(), wid, a, mapping, messageId);
        const next = await importMissiveText(w.state, a, mapping, message, orderId, input.kind, input.fingerprint, requestId);
        await checkAssets(next, wid);
        checked(await service.rpc("title_import_missive_routed", {
          p_workspace: wid, p_actor: user.id, p_email: user.email, p_access_version: a.version,
          p_expected: input.expectedRevision, p_request: requestId, p_hash: hash, p_state: next,
          p_mapping_version: mapping.version, p_company: mapping.companyId, p_routing_revision: routingRevision, p_mapping_id: mapping.id,
          p_action: "importMissiveText",
        }));
        return response({ ...(await stateResponse(wid, a)), imported: true });
      }
    }
    if (pathname === "/integrations" && req.method === "GET") {
      administrator(a);
      return response({
        integrations: checked(
          await service
            .from("title_integrations")
            .select("provider,status,last_checked_at,last_error")
            .eq("workspace_id", wid),
        ),
      });
    }
    if (pathname === "/backups" && req.method === "GET") {
      administrator(a);
      return response({
        backups: checked(
          await service
            .from("title_backups")
            .select("id,revision,created_at")
            .eq("workspace_id", wid)
            .order("created_at", { ascending: false })
            .limit(50),
        ),
      });
    }
    if (pathname === "/backups" && req.method === "POST") {
      administrator(a);
      const w = await workspace(wid);
      const assets = checked(
        await service.from("title_assets").select("*").eq("workspace_id", wid),
      );
      const b = checked(
        await service
          .from("title_backups")
          .insert({
            workspace_id: wid,
            revision: w.revision,
            state: w.state,
            asset_manifest: assets,
            created_by: user.id,
          })
          .select("id,revision,created_at")
          .single(),
      );
      return response(b);
    }
    if (pathname === "/backups/restore" && req.method === "POST") {
      if (a.role !== "owner")
        error("Only the owner may restore a server snapshot.", 403);
      const backup = checked(
        await service
          .from("title_backups")
          .select("*")
          .eq("id", uuid(input.backupId))
          .eq("workspace_id", wid)
          .single(),
      );
      // Reject unusable legacy/history data before the restore RPC changes live state.
      normalizeWorkspace(backup.state);
      await checkAssets(backup.state, wid);
      for (const d of backup.state.documents.filter((d: any) => d.assetId)) {
        const asset = backup.asset_manifest.find(
          (x: any) => x.id === d.assetId,
        );
        if (!asset) error("Backup is missing an asset manifest.");
        checked(
          await service.storage.from("title-documents").info(asset.object_path),
        );
      }
      checked(
        await service.rpc("title_restore_backup", {
          p_workspace: wid,
          p_actor: user.id,
          p_email: user.email,
          p_access_version: a.version,
          p_expected: input.expectedRevision,
          p_backup: backup.id,
        }),
      );
      return response(await stateResponse(wid, a));
    }
    error("Endpoint not found.", 404);
  } catch (e) {
    return response(
      { error: e instanceof Error ? e.message : "Request failed." },
      e instanceof ApiError || e instanceof RequestBodyError ? e.status : 500,
    );
  }
});
