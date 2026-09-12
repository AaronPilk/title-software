import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import { missiveSetup, checkMissiveConnection } from "../../../web/lib/backend/missive.ts";
import { listMissiveConversations, listMissiveMessages, readMissiveMessage, previewMissiveMessage,
  importMissiveText, existingMissiveImport, requireMissiveDestination, providerId,
  type MissiveMapping } from "../../../web/lib/backend/missive-import.ts";
import {
  ApiError,
  emptyWorkspace,
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
async function body(req: Request) {
  const raw = await req.text();
  if (raw.length > 8_000_000) error("Request exceeds 8 MB.", 413);
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    error("Invalid JSON.");
  }
  safePayload(value);
  return value;
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
  return { id: data.user.id, email: data.user.email! };
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
      .select("id,company_id,document_id")
      .eq("workspace_id", id),
  );
  for (const d of state.documents)
    if (
      d.assetId &&
      !assets.some(
        (a: any) =>
          a.id === d.assetId &&
          a.company_id === d.companyId &&
          a.document_id === d.id,
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
      return response({ user, workspaces: rows });
    }
    const input =
      req.method === "GET"
        ? Object.fromEntries(new URL(req.url).searchParams)
        : pathname === "/assets/upload"
          ? null
          : await body(req);
    if (pathname === "/assets/upload" && req.method === "POST") {
      const declared = Number(req.headers.get("Content-Length") || 0);
      if (declared > 52_500_000) error("Upload exceeds 50 MB.", 413);
      const form = await req.formData();
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
      const bytes = await file.arrayBuffer(),
        hash = await digest(bytes);
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
    if (pathname === "/state" && req.method === "GET")
      return response(await stateResponse(wid, a));
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
      const next = executeCommands(w.state, input.commands, a);
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
        ...(await stateResponse(wid, a)),
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
      return response({
        members: checked(
          await service
            .from("title_memberships")
            .select(
              "user_id,role,company_ids,all_companies,restricted_access,partner_members,active,version",
            )
            .eq("workspace_id", wid),
        ),
        invitations: checked(
          await service
            .from("title_invitations")
            .select(
              "id,email,role,company_ids,all_companies,restricted_access,partner_members,accepted_at,revoked_at,expires_at",
            )
            .eq("workspace_id", wid),
        ),
      });
    }
    if (pathname === "/members/invite" && req.method === "POST") {
      administrator(a);
      if (
        typeof input.email !== "string" ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)
      )
        error("Enter an email address.");
      if (
        ![
          "admin",
          "operations",
          "onboarding",
          "finance",
          "viewer",
          "partner",
        ].includes(input.role)
      )
        error("Choose a role.");
      if (
        a.role !== "owner" &&
        (input.role === "admin" || input.restricted || input.allCompanies)
      )
        error("Only the owner may grant elevated access.", 403);
      const w = await workspace(wid),
        companies = input.companyIds || [];
      if (
        !Array.isArray(companies) ||
        companies.some(
          (id: any) =>
            !canCompany(a, id) ||
            !w.state.companies.some((c: any) => c.id === id),
        )
      )
        error("Choose existing companies.");
      const partners = (input.partnerMembers || []).map((m: any) => {
        const c = w.state.companies.find((c: any) => c.id === m.companyId);
        if (
          !companies.includes(m.companyId) ||
          !c?.members.some((x: any) => x.name === m.memberName)
        )
          error("Choose an existing company member.");
        return {
          id: crypto.randomUUID(),
          companyId: m.companyId,
          memberName: m.memberName,
        };
      });
      if (
        input.role === "partner" &&
        (!partners.length || input.allCompanies || input.restricted)
      )
        error(
          "Partners need explicit member assignments and restricted company access.",
        );
      const existing = checked(
        await service
          .from("title_invitations")
          .select("id")
          .eq("workspace_id", wid)
          .eq("email", input.email.trim().toLowerCase())
          .is("accepted_at", null)
          .is("revoked_at", null)
          .gt("expires_at", new Date().toISOString())
          .maybeSingle(),
      );
      if (existing)
        return response({
          id: existing.id,
          status: "Access invitation already prepared; no email sent",
        });
      const row = checked(
        await service
          .from("title_invitations")
          .insert({
            workspace_id: wid,
            email: input.email.trim().toLowerCase(),
            role: input.role,
            company_ids: companies,
            all_companies: !!input.allCompanies,
            restricted_access: !!input.restricted,
            partner_members: partners,
            created_by: user.id,
          })
          .select("id")
          .single(),
      );
      checked(
        await service
          .from("title_audit")
          .insert({
            workspace_id: wid,
            actor_id: user.id,
            actor_email: user.email,
            action: "member.invitation_prepared",
            company_ids: companies,
            detail: { invitationId: row.id, role: input.role },
          }),
      );
      return response({
        ...row,
        status: "Access invitation prepared; no email sent",
      });
    }
    if (pathname === "/members/revoke" && req.method === "POST") {
      administrator(a);
      const target = uuid(input.userId);
      if (target === user.id) error("You cannot revoke your current account.");
      const m = checked(
        await service
          .from("title_memberships")
          .select("role,version")
          .eq("workspace_id", wid)
          .eq("user_id", target)
          .single(),
      );
      if (m.role === "owner" || (m.role === "admin" && a.role !== "owner"))
        error("Owner access is required.", 403);
      checked(
        await service
          .from("title_memberships")
          .update({ active: false, version: m.version + 1 })
          .eq("workspace_id", wid)
          .eq("user_id", target),
      );
      checked(
        await service
          .from("title_audit")
          .insert({
            workspace_id: wid,
            actor_id: user.id,
            actor_email: user.email,
            action: "member.revoked",
            detail: { userId: target },
          }),
      );
      return response({ revoked: true });
    }
    if (pathname.startsWith("/integrations/missive")) {
      administrator(a);
      // The single explicitly bootstrapped workspace is the default token owner.
      // A server override can bind a different workspace during a reviewed move.
      const bootstrap = checked(await service.from("title_bootstrap").select("workspace_id").eq("singleton", true).maybeSingle());
      const config = { token: Deno.env.get("MISSIVE_API_TOKEN"), workspaceId: Deno.env.get("MISSIVE_WORKSPACE_ID") || bootstrap?.workspace_id };
      const integration = checked(await service.from("title_integrations").select("config,status").eq("workspace_id", wid).eq("provider", "missive").maybeSingle());
      const mapping = integration?.config?.mapping as MissiveMapping | undefined;
      const setup = missiveSetup(config, wid, a);
      if (pathname === "/integrations/missive" && req.method === "GET") return response({ ...setup, mapping: mapping || null });
      if (pathname === "/integrations/missive/check" && req.method === "POST") return response(await checkMissiveConnection(config, wid, a));
      if (pathname === "/integrations/missive/mapping" && req.method === "POST") {
        if (!Number.isSafeInteger(input.expectedMappingVersion) || input.expectedMappingVersion < 0) error("Invalid mapping version.");
        const companyId = ident(input.companyId), teamId = providerId(input.teamId);
        const discovery = await checkMissiveConnection(config, wid, a);
        const team = discovery.teamInboxes.find(t => t.id === teamId);
        if (!team || !discovery.organizations.some(o => o.id === team.organizationId)) error("Choose a verified team inbox.", 409);
        const saved = checked(await service.rpc("title_save_missive_mapping", {
          p_workspace: wid, p_actor: user.id, p_email: user.email, p_access_version: a.version,
          p_expected: input.expectedMappingVersion, p_mapping: { companyId, teamId, teamName: team.name, organizationId: team.organizationId },
        }));
        return response({ mapping: saved });
      }
      if (!mapping || integration.status === "disabled") error("Review an inbox-to-company mapping first.", 409);
      if (mapping.version !== input.expectedMappingVersion) error("Inbox mapping changed. Refresh and review it again.", 409);
      const w = await workspace(wid);
      requireMissiveDestination(w.state, mapping);
      if (pathname === "/integrations/missive/conversations" && req.method === "POST")
        return response(await listMissiveConversations(config, wid, a, mapping, input.until));
      if (pathname === "/integrations/missive/messages" && req.method === "POST")
        return response(await listMissiveMessages(config, wid, a, mapping, input.conversationId, input.until));
      if (pathname === "/integrations/missive/preview" && req.method === "POST")
        return response(await previewMissiveMessage(await readMissiveMessage(config, wid, a, mapping, input.messageId)));
      if (pathname === "/integrations/missive/import" && req.method === "POST") {
        const requestId = uuid(input.requestId), messageId = providerId(input.messageId), orderId = ident(input.orderId);
        const hash = await digest(new TextEncoder().encode(JSON.stringify({
          action: "importMissiveText", messageId, orderId, kind: input.kind, fingerprint: input.fingerprint,
          expectedRevision: input.expectedRevision, expectedMappingVersion: input.expectedMappingVersion,
        })));
        const receipt = checked(await service.from("title_command_receipts").select("actor_id,payload_hash").eq("workspace_id", wid).eq("request_id", requestId).maybeSingle());
        if (receipt) {
          if (receipt.actor_id !== user.id || receipt.payload_hash !== hash) error("This request ID already represents a different change.", 409);
          return response({ ...(await stateResponse(wid, a)), replayed: true });
        }
        const existing = existingMissiveImport(w.state, mapping.organizationId, messageId, mapping.companyId, orderId);
        if (existing) return response({ ...(await stateResponse(wid, a)), alreadyImported: true });
        if (w.revision !== input.expectedRevision) error("Someone saved a newer version. Refresh and review before importing.", 409);
        requireMissiveDestination(w.state, mapping, orderId);
        const message = await readMissiveMessage(config, wid, a, mapping, messageId);
        const next = await importMissiveText(w.state, a, mapping, message, orderId, input.kind, input.fingerprint, requestId);
        await checkAssets(next, wid);
        checked(await service.rpc("title_import_missive", {
          p_workspace: wid, p_actor: user.id, p_email: user.email, p_access_version: a.version,
          p_expected: input.expectedRevision, p_request: requestId, p_hash: hash, p_state: next,
          p_mapping_version: mapping.version, p_company: mapping.companyId,
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
      e instanceof ApiError ? e.status : 500,
    );
  }
});
