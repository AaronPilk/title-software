"use client";
import { canManageFinance } from "@/lib/title/workspace-capabilities";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  LayoutGrid,
  Inbox,
  Files,
  ScanLine,
  FilePenLine,
  Building2,
  ListChecks,
  FolderClosed,
  CheckSquare2,
  ChartNoAxesCombined,
  UsersRound,
  Workflow,
  Settings2,
  Search,
  Bell,
  ChevronRight,
  ArrowRight,
  Activity,
  Sparkles,
} from "lucide-react";
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { WorkspaceProvider, useWorkspace } from "@/lib/title/store";
import type { Page, VaultDoc } from "@/lib/title/model";
import { Overview } from "@/components/title/overview";
import { AgencyOverview } from "@/components/title/agency-overview";
import { WorkspaceSwitcher } from "@/components/title/workspace-switcher";
import { useWorkspaceView } from "@/components/title/use-workspace-view";
import { pageVisibleInWorkspace, workspaceViewPages, type WorkspaceView } from "@/lib/title/workspace-view";
import {
  Orders,
  NewOrder,
  OrderDetail,
  PolicyWorkbench,
} from "@/components/title/policies";
import {
  Companies,
  NewCompany,
  CompanyDetail,
} from "@/components/title/companies";
import {
  Documents,
  DocumentPreview,
  UploadDocument,
} from "@/components/title/documents";
import { InboxView, Tasks, Automations } from "@/components/title/operations";
import { OrchestrationWorkspace } from "@/components/title/orchestration";
import { Revisions } from "@/components/title/revisions";
import { Financials } from "@/components/title/financials";
import { Handoffs } from "@/components/title/handoffs";
import { OnboardingHub } from "@/components/title/onboarding-suite";
import { ProductionSuite } from "@/components/title/production-suite";
import { PartnerPortal, Settings } from "@/components/title/workspace";
import { Assistant } from "@/components/title/assistant";
import { activeWorkspace, hostedPilot } from "@/lib/backend/client";
const navigation: { label: Page; icon: typeof LayoutGrid }[] = [
  { label: "Overview", icon: LayoutGrid },
  { label: "Assistant", icon: Sparkles },
  { label: "Inbox", icon: Inbox },
  { label: "Orders", icon: Files },
  { label: "Commitments", icon: FilePenLine },
  { label: "Policy workbench", icon: ScanLine },
  { label: "Policy products", icon: Files },
  { label: "Revisions", icon: FilePenLine },
  { label: "Companies", icon: Building2 },
  { label: "Onboarding", icon: ListChecks },
  { label: "Documents", icon: FolderClosed },
  { label: "Tasks", icon: CheckSquare2 },
  { label: "Financials", icon: ChartNoAxesCombined },
  { label: "Partner portal", icon: UsersRound },
  { label: "Handoffs", icon: ArrowRight },
  { label: "Automations", icon: Workflow },
  { label: "Connections", icon: Workflow },
];
const pageNames: Page[] = [...navigation.map((n) => n.label), "Settings"];
export default function Home() {
  return (
    <WorkspaceProvider>
      <SidebarProvider style={{ "--sidebar-width": "248px" } as CSSProperties}>
        <Workspace />
      </SidebarProvider>
      <Toaster richColors theme="light" position="bottom-right" />
    </WorkspaceProvider>
  );
}
function Workspace() {
  const { s, ready, connection } = useWorkspace();
  const { setOpenMobile } = useSidebar();
  const workspaceLocation = useWorkspaceView(connection ? {
    userId: connection.access.userId,
    email: connection.access.email,
    role: connection.access.role,
    workspaceId: activeWorkspace(),
  } : undefined, s.user, ready);
  const { page, view } = workspaceLocation;
  const [search, setSearch] = useState(false);
  const [notifications, setNotifications] = useState(false);
  const [orderId, setOrderId] = useState("");
  const [revisionMessage, setRevisionMessage] = useState("");
  const [policyId, setPolicyId] = useState("T-2026-1048");
  const [companyId, setCompanyId] = useState("");
  const [docId, setDocId] = useState("");
  const [newOrder, setNewOrder] = useState(false);
  const [newCompany, setNewCompany] = useState(false);
  const [uploadCompany, setUploadCompany] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const storeRef = useRef(s);
  useEffect(() => {
    const closeDrawer = () => setOpenMobile(false);
    window.addEventListener("hashchange", closeDrawer);
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearch((v) => !v);
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("hashchange", closeDrawer);
      window.removeEventListener("keydown", key);
    };
  }, [setOpenMobile]);
  function navigate(p: Page) {
    setOpenMobile(false);
    workspaceLocation.navigate(p);
    setSearch(false);
    setNotifications(false);
    setOrderId("");
    setCompanyId("");
    setDocId("");
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  function switchView(next: WorkspaceView) {
    setOpenMobile(false);
    workspaceLocation.switchView(next);
    setSearch(false);
    setNotifications(false);
    setOrderId("");
    setCompanyId("");
    setDocId("");
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  const navRef = useRef(navigate);
  useEffect(() => {
    storeRef.current = s;
    navRef.current = navigate;
  });
  useEffect(() => {
    if (connection || hostedPilot) return;
    type Tool = {
      name: string;
      description: string;
      inputSchema: object;
      annotations: { readOnlyHint: boolean };
      execute: (input: unknown) => unknown;
    };
    const context = (
      document as Document & {
        modelContext?: {
          registerTool: (
            t: Tool,
            o: { signal: AbortSignal },
          ) => void | Promise<void>;
        };
      }
    ).modelContext;
    if (!context?.registerTool) return;
    const controller = new AbortController();
    const tools: Tool[] = [
      {
        name: "search_title_workspace",
        description:
          "Search local demo company and order titles. No external data is fetched.",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true },
        execute(input) {
          if (
            !input ||
            typeof input !== "object" ||
            !("query" in input) ||
            typeof input.query !== "string"
          )
            throw new Error("query must be a string");
          const q = input.query.toLowerCase();
          return {
            demo: true,
            companies: storeRef.current.companies
              .filter((c) => c.name.toLowerCase().includes(q))
              .map((c) => ({ id: c.id, name: c.name })),
            orders: storeRef.current.orders
              .filter((o) => `${o.id} ${o.address}`.toLowerCase().includes(q))
              .map((o) => ({ id: o.id, address: o.address, status: o.status })),
          };
        },
      },
      {
        name: "navigate_title_workspace",
        description:
          "Open a section of the local Ballantyne Title workspace. This does not create or submit a record.",
        inputSchema: {
          type: "object",
          properties: { page: { type: "string", enum: pageNames } },
          required: ["page"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false },
        execute(input) {
          if (
            !input ||
            typeof input !== "object" ||
            !("page" in input) ||
            !pageNames.includes(input.page as Page)
          )
            throw new Error("Unknown workspace page");
          navRef.current(input.page as Page);
          return { opened: input.page };
        },
      },
    ];
    for (const tool of tools) {
      try {
        void Promise.resolve(
          context.registerTool(tool, { signal: controller.signal }),
        ).catch(() => {});
      } catch {
        /* WebMCP is optional. */
      }
    }
    return () => controller.abort();
  }, [connection]);
  function openReview(id: string) {
    setPolicyId(id);
    navigate("Policy workbench");
  }
  function upload(id?: string) {
    setUploadCompany(id || null);
    setCompanyId("");
    setUploadOpen(true);
  }
  const doc = s.documents.find((d) => d.id === docId);
  const openDoc = (d: VaultDoc) => setDocId(d.id);
  const initials = connection
    ? connection.access.email.split("@")[0].split(/[. _-]+/).map(part => part[0]).slice(0,2).join("").toUpperCase()
    : s.user === "Stephenie" ? "ST" : s.user === "Tyler" ? "TY" : "JO";
  const titles = {
    Stephenie: "Company administrator",
    Tyler: "Policy operations",
    John: "Operations lead",
  };
  let content;
  switch (page) {
    case "Overview":
      content = view === "agency" ? (
        <AgencyOverview navigate={navigate} newCompany={() => setNewCompany(true)} openCompany={setCompanyId} />
      ) : (
        <Overview
          title="Production overview"
          navigate={navigate}
          newOrder={() => setNewOrder(true)}
          newCompany={() => setNewCompany(true)}
          openOrder={setOrderId}
          openCompany={setCompanyId}
        />
      );
      break;
    case "Assistant":
      content = <Assistant navigate={navigate} />;
      break;
    case "Orders":
      content = <Orders onOpen={setOrderId} onNew={() => setNewOrder(true)} />;
      break;
    case "Policy workbench":
      content = (
        <PolicyWorkbench selectedId={policyId} onSelect={setPolicyId} />
      );
      break;
    case "Commitments":
    case "Policy products":
      content = (
        <ProductionSuite
          mode={page}
          key={page}
          onReview={openReview}
          initialOrderId={policyId}
        />
      );
      break;
    case "Revisions":
      content = (
        <Revisions
          key={revisionMessage}
          messageId={revisionMessage}
          onOpen={openReview}
        />
      );
      break;
    case "Companies":
      content = (
        <Companies onOpen={setCompanyId} onNew={() => setNewCompany(true)} />
      );
      break;
    case "Onboarding":
      content = (
        <OnboardingHub
          onOpen={setCompanyId}
          onNew={() => setNewCompany(true)}
        />
      );
      break;
    case "Documents":
      content = <Documents onDoc={openDoc} onUpload={() => upload()} />;
      break;
    case "Inbox":
      content = (
        <InboxView
          onReview={openReview}
          onCommitment={(id) => {
            setPolicyId(id);
            navigate("Commitments");
          }}
          onRevision={(id) => {
            setRevisionMessage(id);
            navigate("Revisions");
          }}
        />
      );
      break;
    case "Tasks":
      content = <Tasks />;
      break;
    case "Financials":
      content = canManageFinance(connection) ? <Financials /> : <section className="panel"><h1>Financials access required</h1><p>Your account does not have financial access. Ask the workspace owner to review your role.</p></section>;
      break;
    case "Partner portal":
      content = <PartnerPortal />;
      break;
    case "Handoffs":
      content = <Handoffs />;
      break;
    case "Automations":
      content = <Automations />;
      break;
    case "Connections":
      content = <OrchestrationWorkspace />;
      break;
    case "Settings":
      content = <Settings />;
  }
  return (
    <>
      <a
        href="#main-content"
        className="skip-link"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("main-content")?.focus();
        }}
      >
        Skip to workspace
      </a>
      <Sidebar className="app-sidebar">
        <SidebarHeader>
          <button
            className="brand"
            onClick={() => navigate("Overview")}
            aria-label="Ballantyne Title overview"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- This small bundled logo is served directly from the same origin. */}
            <img
              className="brand-logo"
              src="/brand/ballantyne-title-logo.png"
              alt=""
              width={52}
              height={52}
            />
            <span className="brand-wordmark">
              <span className="brand-name">Ballantyne</span>
              <span className="brand-company">Title Company</span>
            </span>
          </button>
          {connection?.access.role !== "partner" ? <WorkspaceSwitcher view={view} onChange={switchView} /> : <div className="workspace-switch">
            <span className="workspace-symbol">
              <Building2 size={17} />
            </span>
            <div>
              <strong>Partner workspace</strong>
              <small>Your company statements &amp; documents</small>
            </div>
          </div>}
        </SidebarHeader>
        <SidebarContent>
          <p className="nav-caption">{connection?.access.role === "partner" ? "PARTNER" : view.toUpperCase()}</p>
          <SidebarMenu>
            {(connection?.access.role === "partner" ? navigation : workspaceViewPages[view].map(label => navigation.find(n => n.label === label)!))
              .filter(
                (n) =>
                  pageVisibleInWorkspace(n.label, connection?.access.role),
              )
              .map(({ label, icon: Icon }) => (
                <SidebarMenuItem
                  key={label}
                  className={
                    label === "Companies" || label === "Financials"
                      ? "nav-section-break"
                      : ""
                  }
                >
                  <SidebarMenuButton
                    onClick={() => navigate(label)}
                    isActive={label === page}
                    className="nav-button"
                    aria-current={label === page ? "page" : undefined}
                  >
                    <Icon />
                    <span>{label}</span>
                    {label === "Inbox" &&
                      s.inbox.some((m) => m.status === "New") && (
                        <b className="nav-count">
                          {s.inbox.filter((m) => m.status === "New").length}
                        </b>
                      )}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
          </SidebarMenu>
        </SidebarContent>
        <SidebarFooter>
          <div className="local-card">
            <span className="local-dot" />
            <span>
              {connection ? "Shared workspace" : "Local demo workspace"}
              <small>
                {connection
                  ? connection.access.role + " · saved to Supabase"
                  : ready
                    ? "Fictional data · saved in this browser"
                    : "loading records"}
              </small>
            </span>
          </div>
          <SidebarMenuButton
            onClick={() => navigate("Settings")}
            isActive={page === "Settings"}
            className="nav-button"
          >
            <Settings2 />
            Settings
          </SidebarMenuButton>
          <button className="user" onClick={() => navigate("Settings")}>
            <span className="avatar">{initials}</span>
            <div>
              <strong>
                {s.user}
                {s.user === "Stephenie" ? " Tocado" : ""}
              </strong>
              <small>
                {connection ? ({owner:"Workspace owner",admin:"Administrator",operations:"Title operations",onboarding:"Company onboarding",finance:"Finance",viewer:"Read-only access",partner:"Company partner"})[connection.access.role] : titles[s.user as keyof typeof titles] || "Team member"}
              </small>
            </div>
            <ChevronRight size={13} />
          </button>
        </SidebarFooter>
      </Sidebar>
      <main className="app-main" id="main-content" tabIndex={-1}>
        <header className="topbar">
          <span>
            <SidebarTrigger className="mobile-menu" />
            {connection?.access.role === "partner" ? "Partner" : view === "agency" ? "Agency" : "Production"} <ChevronRight size={13} />
            <strong>{page}</strong>
          </span>
          <div>
            <button className="search-global" onClick={() => setSearch(true)}>
              <Search size={16} />
              Search anything…<kbd>⌘ K</kbd>
            </button>
            <button
              aria-label="Workspace activity"
              className="icon-button"
              onClick={() => setNotifications(true)}
            >
              <Bell size={19} />
            </button>
            <button
              aria-label="Workspace settings"
              className="avatar small"
              onClick={() => navigate("Settings")}
            >
              {initials}
            </button>
          </div>
        </header>
        <div
          className={`page-content ${page === "Policy workbench" ? "workbench-page" : ""}`}
        >
          {content}
          <footer className="page-footer">
            Ballantyne Title Company
            <span>
              {connection
                ? "Shared company operations"
                : "Local preview · September 2026 demo workspace"}
            </span>
          </footer>
        </div>
      </main>
      <Dialog open={search} onOpenChange={setSearch}>
        <DialogContent className="command-modal" showCloseButton={false}>
          <DialogHeader className="sr-only">
            <DialogTitle>Search workspace</DialogTitle>
            <DialogDescription>
              Find companies, orders, documents, or workspace pages.
            </DialogDescription>
          </DialogHeader>
          <Command>
            <CommandInput placeholder="Search companies, orders, documents…" />
            <CommandList>
              <CommandEmpty>No matching records found.</CommandEmpty>
              <CommandGroup heading="Workspace">
                {pageNames.filter(p => pageVisibleInWorkspace(p, connection?.access.role)).map((p) => (
                  <CommandItem key={p} onSelect={() => navigate(p)}>
                    {p}
                    <ChevronRight size={14} />
                  </CommandItem>
                ))}
              </CommandGroup>
              {connection?.access.role !== "partner" && <CommandGroup heading="Companies">
                {s.companies.map((c) => (
                  <CommandItem
                    key={c.id}
                    onSelect={() => {
                      navigate("Companies");
                      setCompanyId(c.id);
                    }}
                  >
                    <Building2 />
                    {c.name}
                    <small>{c.jurisdiction}</small>
                  </CommandItem>
                ))}
              </CommandGroup>}
              {connection?.access.role !== "partner" && <CommandGroup heading="Orders">
                {s.orders.map((o) => (
                  <CommandItem
                    key={o.id}
                    onSelect={() => {
                      navigate("Orders");
                      setOrderId(o.id);
                    }}
                  >
                    <Files />
                    {o.address}
                    <small>{o.id}</small>
                  </CommandItem>
                ))}
              </CommandGroup>}
              <CommandGroup heading="Documents">
                {s.documents.map((d) => (
                  <CommandItem
                    key={d.id}
                    value={`${d.name} ${d.companyId} ${d.id}`}
                    onSelect={() => {
                      navigate("Documents");
                      setDocId(d.id);
                    }}
                  >
                    <FileTextIcon />
                    {d.name}
                    <small>
                      {s.companies.find((c) => c.id === d.companyId)?.name}
                    </small>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
      <Sheet open={notifications} onOpenChange={setNotifications}>
        <SheetContent className="detail-sheet">
          <SheetHeader>
            <SheetTitle>Workspace activity</SheetTitle>
            <SheetDescription>
              Recent changes across the local demo.
            </SheetDescription>
          </SheetHeader>
          <div className="sheet-body">
            {s.activity.slice(0, 12).map((a) => (
              <div className="notification-row" key={a.id}>
                <Activity size={17} />
                <div>
                  <strong>{a.title}</strong>
                  <p>{a.detail}</p>
                  <small>
                    {a.actor} · {new Date(a.at).toLocaleDateString()}
                  </small>
                </div>
              </div>
            ))}
            <Button variant="outline" onClick={() => navigate("Settings")}>
              Open workspace settings
              <ArrowRight />
            </Button>
          </div>
        </SheetContent>
      </Sheet>
      {newOrder && <NewOrder open onClose={() => setNewOrder(false)} />}{" "}
      {newCompany && <NewCompany open onClose={() => setNewCompany(false)} />}{" "}
      {orderId && (
        <OrderDetail
          id={orderId}
          onClose={() => setOrderId("")}
          onReview={openReview}
        />
      )}{" "}
      {companyId && (
        <CompanyDetail
          key={companyId}
          id={companyId}
          onClose={() => setCompanyId("")}
          onDoc={openDoc}
          onUpload={upload}
        />
      )}{" "}
      {doc && (
        <DocumentPreview
          key={doc.id}
          doc={doc}
          partner={page === "Partner portal"}
          onClose={() => setDocId("")}
        />
      )}{" "}
      {uploadOpen && (
        <UploadDocument
          key={uploadCompany || "general"}
          companyId={uploadCompany}
          onClose={() => setUploadOpen(false)}
        />
      )}
    </>
  );
}
function FileTextIcon() {
  return <Files size={15} />;
}
