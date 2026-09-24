import type { Workspace } from "../title/model";
import { ApiError, canCompany, type Access } from "./workspace";
import {
  jvIntakeFingerprint,
  jvReadiness,
  newJVApplication,
  validateJVApplication,
  type JVApplication,
  type JVRecord,
} from "../title/jv-application";

export type JVIntakeContext = {
  workspaceId: string;
  access: Access;
  state: Workspace;
  rpc: (args: Record<string, unknown>) => Promise<unknown>;
};
const actions = ["load", "save", "submit", "review", "reopen"];
const statuses = ["Draft", "Ready for review", "Reviewed"];
function fail(message: string, status = 400): never { throw new ApiError(message, status); }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const owns = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
function payload(value: unknown): JVApplication {
  // Validation never echoes field values, including unrecognized property names.
  try { return validateJVApplication(value); }
  catch { return fail("The private application contains invalid or unsupported fields."); }
}
function blank(companyId: string): JVRecord {
  return { companyId, version: 0, payload: newJVApplication(), status: "Draft", reviewNote: "",
    updatedAt: null, updatedBy: null, reviewedAt: null, reviewedBy: null, sourceChanged: false };
}
function record(raw: unknown, companyId: string): JVRecord {
  if (raw === null) return blank(companyId);
  if (!object(raw) || raw.companyId !== companyId || !Number.isSafeInteger(raw.version) || (raw.version as number) < 1 ||
      !statuses.includes(String(raw.status)) || typeof raw.reviewNote !== "string" || raw.reviewNote.length > 4000 ||
      ["updatedAt", "updatedBy", "reviewedAt", "reviewedBy"].some(key => raw[key] !== null && typeof raw[key] !== "string"))
    return fail("The private application is unavailable. Reload and try again.", 503);
  let validated: JVApplication;
  try { validated = validateJVApplication(raw.payload); }
  catch { return fail("The private application is unavailable. Reload and try again.", 503); }
  // Explicit projection prevents accidental database internals from reaching clients.
  return { companyId, version: raw.version as number, payload: validated, status: raw.status as JVRecord["status"],
    reviewNote: raw.reviewNote, updatedAt: raw.updatedAt as string | null, updatedBy: raw.updatedBy as string | null,
    reviewedAt: raw.reviewedAt as string | null, reviewedBy: raw.reviewedBy as string | null, sourceChanged: raw.sourceChanged === true };
}
function verifySources(application: JVApplication, companyId: string, context: JVIntakeContext) {
  for (const id of application.sourceDocumentIds) {
    const doc = context.state.documents.find(item => item.id === id);
    if (!doc || doc.companyId !== companyId || doc.orderId || doc.visibility !== "Restricted" ||
        doc.category !== "Applications" || !Number.isSafeInteger(doc.version) || doc.version < 1 || typeof doc.assetId !== "string" || !doc.assetId)
      fail("Choose an available restricted application original for this company.", 403);
  }
}
/** Private intake never enters Workspace commands, activity, assistant context, or backups. */
export async function jvIntakeRequest(action: string, input: Record<string, unknown>, context: JVIntakeContext): Promise<JVRecord> {
  if (!object(input) || !actions.includes(action) || input.workspaceId !== context.workspaceId ||
      typeof input.companyId !== "string" || !/^[-A-Za-z0-9_ .:@]{1,180}$/.test(input.companyId))
    fail("Invalid private application request.");
  const companyId = input.companyId;
  if (!["owner", "admin", "onboarding"].includes(context.access.role) || !context.access.restricted ||
      !canCompany(context.access, companyId) || !context.state.companies.some(item => item.id === companyId))
    fail("Your current access does not permit this private application.", 403);
  const allowed = action === "load" ? ["workspaceId", "companyId"] :
    ["workspaceId", "companyId", "expectedVersion", ...(action === "reopen" ? [] : ["payload"]), ...(action === "review" ? ["reviewNote"] : [])];
  if (Object.keys(input).some(key => !allowed.includes(key)) || action !== "load" &&
      (!Number.isSafeInteger(input.expectedVersion) || (input.expectedVersion as number) < 0))
    fail("Invalid private application request.");
  const invoke = async (operation: "load" | "save", details: Record<string, unknown>): Promise<JVRecord> => {
    let raw: unknown;
    try {
      raw = await context.rpc({ p_workspace: context.workspaceId, p_actor: context.access.userId,
        p_access_version: context.access.version, p_company: companyId, p_action: operation, p_input: details });
    } catch (error) {
      // Never pass database details, constraint values, or Vault errors into a response.
      const status = object(error) ? error.status : undefined;
      const code = object(error) ? error.code : undefined;
      if (status === 403 || code === "42501") fail("Your private application access changed. Refresh and try again.", 403);
      if (status === 409 || code === "PT409" || code === "40001") fail("The private application changed. Reload before continuing.", 409);
      if (status === 400 || code === "22023") fail("The private application request could not be accepted.");
      fail("The private application could not be accessed. Try again.", 503);
    }
    return record(raw, companyId);
  };
  const saved = await invoke("load", {});
  if (action === "load") return saved;
  if (saved.version !== input.expectedVersion) fail("The private application changed. Reload before continuing.", 409);
  const application = owns(input, "payload") ? payload(input.payload) : saved.payload;
  if (action === "save" && !owns(input, "payload")) fail("Provide the private application to save.");
  verifySources(application, companyId, context);
  const changed = jvIntakeFingerprint(application) !== jvIntakeFingerprint(saved.payload);
  let status = saved.status, reviewNote = saved.reviewNote;
  if (action === "save" && changed || action === "reopen") { status = "Draft"; reviewNote = ""; }
  if (action === "submit" || action === "review") {
    if (jvReadiness(application).length) fail("Complete the application review requirements before continuing.");
    if (action === "submit") {
      if (saved.status === "Reviewed") fail("Reopen the reviewed application before submitting it again.", 409);
      status = "Ready for review"; reviewNote = "";
    } else {
      if (saved.status !== "Ready for review" || changed) fail("Submit the current application for review before marking it reviewed.", 409);
      if (typeof input.reviewNote !== "string" || !input.reviewNote.trim() || input.reviewNote.length > 4000)
        fail("Enter a review note of up to 4,000 characters.");
      status = "Reviewed"; reviewNote = input.reviewNote.trim();
    }
  }
  const sourceManifest = application.sourceDocumentIds.map(documentId => {
    const doc = context.state.documents.find(item => item.id === documentId)!;
    return { documentId, assetId: doc.assetId, version: doc.version };
  });
  return invoke("save", { expectedVersion: saved.version, payload: application, status, reviewNote, sourceManifest });
}
