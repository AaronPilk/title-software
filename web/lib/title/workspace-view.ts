import type { Page } from "./model";
import { productionOnlyRole } from "./production-access";

export type WorkspaceView = "agency" | "production";
export type ViewIdentity = { userId: string; email: string; role: string; workspaceId: string };
export type WorkspaceLocation = { view: WorkspaceView; page: Page };

export const workspaceViewPages: Record<WorkspaceView, Page[]> = {
  agency: ["Overview", "Companies", "Onboarding", "Handoffs", "Financials", "Partner portal", "Documents", "Tasks", "Inbox", "Assistant", "Automations", "Connections"],
  production: ["Overview", "Inbox", "Orders", "Commitments", "Policy workbench", "Policy products", "Revisions", "Documents", "Tasks", "Companies", "Assistant"],
};
export const workspacePages: Page[] = [...new Set([...workspaceViewPages.agency, ...workspaceViewPages.production, "Settings" as Page])];
const slug = (page: Page) => page.toLowerCase().replaceAll(" ", "-");

// These are the team's requested starting screens, never access grants.
// An explicit view choice takes precedence and is stored per workspace/account.
export function defaultWorkspaceView(identity?: ViewIdentity, demoUser = "Stephenie"): WorkspaceView {
  if (!identity) return demoUser === "Tyler" ? "production" : "agency";
  if (productionOnlyRole(identity.role)) return "production";
  const email = identity.email.trim().toLowerCase();
  if (["s.tocado@rtocado.com", "john@ballantynetitle.com"].includes(email)) return "agency";
  if (email === "tyler@ballantyne-title.com") return "production";
  return ["owner", "admin", "onboarding", "finance", "partner"].includes(identity.role) ? "agency" : "production";
}

export function viewPreferenceKey(identity?: ViewIdentity, demoUser = "Stephenie") {
  return identity
    ? `title:workspace-view:v1:${encodeURIComponent(identity.workspaceId)}:${encodeURIComponent(identity.userId)}`
    : `title:workspace-view:v1:demo:${encodeURIComponent(demoUser)}`;
}

export function validWorkspaceView(value: unknown): value is WorkspaceView {
  return value === "agency" || value === "production";
}

export function pageVisibleInWorkspace(page: Page, role?: string) {
  if (role === "partner") return page === "Partner portal" || page === "Settings";
  if (productionOnlyRole(role)) return page === "Settings" || workspaceViewPages.production.includes(page);
  if (page === "Financials" && role) return ["owner", "admin", "finance"].includes(role);
  return true;
}

/** Apply account capabilities to navigation independently of URL or saved view. */
export function accessibleWorkspaceLocation(location: WorkspaceLocation, role?: string): WorkspaceLocation {
  if (productionOnlyRole(role)) return {
    view: "production",
    page: pageVisibleInWorkspace(location.page, role) ? location.page : "Overview",
  };
  return pageVisibleInWorkspace(location.page, role) ? location : { view: location.view, page: "Overview" };
}

export function viewForPage(page: Page, current: WorkspaceView): WorkspaceView {
  if (page === "Settings" || workspaceViewPages[current].includes(page)) return current;
  return workspaceViewPages.agency.includes(page) ? "agency" : "production";
}

export function workspaceHash(location: WorkspaceLocation) {
  return `#${location.view}/${slug(location.page)}`;
}

export function readWorkspaceLocation(hash: string, fallback: WorkspaceView, partner = false): WorkspaceLocation {
  const parts = hash.replace(/^#/, "").split("/");
  const explicit = validWorkspaceView(parts[0]);
  const preferred = explicit ? parts[0] as WorkspaceView : fallback;
  const pageSlug = explicit ? parts[1] || "overview" : parts[0];
  const page = workspacePages.find(p => slug(p) === pageSlug) || "Overview";
  if (partner) return { view: "agency", page: page === "Settings" ? "Settings" : "Partner portal" };
  return { view: viewForPage(page, preferred), page };
}
