import { ApiError, type Access } from "./workspace";

export type MissiveConfig = { token?: string; workspaceId?: string };
export type MissiveSetup = {
  status: "workspace_required" | "token_required" | "ready";
  importEnabled: boolean;
};
export type MissiveCheck = {
  status: "verified";
  checkedAt: string;
  importEnabled: boolean;
  organizations: { id: string; name: string }[];
  teamInboxes: { id: string; name: string; organizationId: string }[];
  moreOrganizations: boolean;
  moreTeams: boolean;
};

export function missiveSetup(config: MissiveConfig, workspaceId: string, access: Access): MissiveSetup {
  if (access.role !== "owner" && !(access.role === "admin" && access.allCompanies))
    throw new ApiError("Organization-wide administrator access is required.", 403);
  // A project secret is global. Never let another workspace use it merely
  // because its caller is an administrator of that other workspace.
  if (!config.workspaceId || config.workspaceId !== workspaceId)
    return { status: "workspace_required", importEnabled: false };
  if (!config.token?.trim()) return { status: "token_required", importEnabled: false };
  return { status: "ready", importEnabled: true };
}

const LIMIT = 200;
const MAX_BYTES = 1_000_000;
function invalidResponse(): never {
  throw new ApiError("Missive returned an unexpected response. Try the connection check again later.", 502);
}
function text(value: unknown, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) invalidResponse();
  return value;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalidResponse();
  return value as Record<string, unknown>;
}

export function missiveReader(
  config: MissiveConfig,
  workspaceId: string,
  access: Access,
  fetcher: typeof fetch = fetch,
) {
  const setup = missiveSetup(config, workspaceId, access);
  if (setup.status !== "ready")
    throw new ApiError(setup.status === "workspace_required"
      ? "Assign the Missive connection to this workspace before checking it."
      : "Connect your Missive account in Settings first.", 409);
  const token = config.token!.trim();
  if (!/^[\x21-\x7e]{1,4096}$/.test(token))
    throw new ApiError("The saved Missive token has an invalid format. Replace it in the server's secret settings.", 409);
  const signal = AbortSignal.timeout(20_000);

  return async (path: string) => {
    if (!/^\/v1\/[a-zA-Z0-9_/?=&.-]+$/.test(path)) throw new ApiError("Invalid Missive request.");
    let result: Response;
    try {
      result = await fetcher(`https://public.missiveapp.com${path}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        redirect: "error",
        signal,
      });
    } catch {
      throw new ApiError("Missive could not be reached. Try the connection check again later.", 502);
    }
    if (!result.ok) {
      await result.body?.cancel();
      if ([401, 403].includes(result.status))
        throw new ApiError("Missive did not accept the connection. Check the token owner's access and API plan.", 502);
      if (result.status === 429) {
        const retryAfter = Number(result.headers.get("Retry-After"));
        const minutes = Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.ceil(Math.min(retryAfter, 86400) / 60) : 15;
        throw new ApiError(`Missive's request limit was reached. Wait ${minutes} minute${minutes === 1 ? "" : "s"} before checking again.`, 429);
      }
      throw new ApiError("Missive is temporarily unavailable. Try the connection check again later.", 502);
    }
    // Read only a bounded metadata response. Do not echo vendor errors or
    // return arbitrary vendor properties to the browser.
    const reader = result.body?.getReader();
    if (!reader) invalidResponse();
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) { await reader.cancel(); invalidResponse(); }
        chunks.push(value);
      }
    } catch {
      invalidResponse();
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let payload: unknown;
    try { payload = JSON.parse(new TextDecoder().decode(bytes)); } catch { invalidResponse(); }
    return record(payload);
  };
}

export async function checkMissiveConnection(config: MissiveConfig, workspaceId: string, access: Access, fetcher: typeof fetch = fetch): Promise<MissiveCheck> {
  const read = missiveReader(config, workspaceId, access, fetcher);
  async function get(collection: "organizations" | "teams") {
    const rows = (await read(`/v1/${collection}?limit=${LIMIT}&offset=0`))[collection];
    if (!Array.isArray(rows) || rows.length > LIMIT) invalidResponse();
    return rows.map(record);
  }
  // Two fixed GET requests. No message bodies, contacts, drafts or mutations.
  const organizations = await get("organizations");
  const teams = await get("teams");
  const result: MissiveCheck = {
    status: "verified",
    checkedAt: new Date().toISOString(),
    importEnabled: true,
    organizations: organizations.map(row => ({ id: text(row.id, 100), name: text(row.name, 500) })),
    teamInboxes: teams.map(row => {
      if (typeof row.team_inbox_enabled !== "boolean") invalidResponse();
      return {
        id: text(row.id, 100), name: text(row.name, 500),
        organizationId: text(row.organization, 100), enabled: row.team_inbox_enabled,
      };
    }).filter(row => row.enabled).map(({ enabled: _enabled, ...row }) => row),
    // This is bounded discovery, not a complete mailbox directory or sync.
    moreOrganizations: organizations.length === LIMIT,
    moreTeams: teams.length === LIMIT,
  };
  return result;
}
