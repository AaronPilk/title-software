"use client";
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
  Onboarding,
} from "@/components/title/companies";
import {
  Documents,
  DocumentPreview,
  UploadDocument,
} from "@/components/title/documents";
import { InboxView, Tasks, Automations } from "@/components/title/operations";
import { Revisions } from "@/components/title/revisions";
import { Financials } from "@/components/title/financials";
import { Handoffs } from "@/components/title/handoffs";
import { OnboardingHub } from "@/components/title/onboarding-suite";
import { ProductionSuite } from "@/components/title/production-suite";
import { PartnerPortal, Settings } from "@/components/title/workspace";
const navigation: { label: Page; icon: typeof LayoutGrid }[] = [
  { label: "Overview", icon: LayoutGrid },
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
];
const pageNames: Page[] = [...navigation.map((n) => n.label), "Settings"];
const slug = (p: string) => p.toLowerCase().replaceAll(" ", "-");
export default function Home() {
  return (
    <WorkspaceProvider>
      <Workspace />
      <Toaster richColors theme="light" position="bottom-right" />
    </WorkspaceProvider>
  );
}
function Workspace() {
  const { s, ready } = useWorkspace();
  const [page, setPage] = useState<Page>("Overview");
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
  storeRef.current = s;
  useEffect(() => {
    const read = () => {
      const found = pageNames.find(
        (p) => slug(p) === window.location.hash.slice(1),
      );
      setPage(found || "Overview");
    };
    read();
    window.addEventListener("hashchange", read);
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearch((v) => !v);
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("hashchange", read);
      window.removeEventListener("keydown", key);
    };
  }, []);
  function navigate(p: Page) {
    setPage(p);
    window.location.hash = slug(p);
    setSearch(false);
    setNotifications(false);
    setOrderId("");
    setCompanyId("");
    setDocId("");
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  const navRef = useRef(navigate);
  navRef.current = navigate;
  useEffect(() => {
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
  }, []);
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
  const initials =
    s.user === "Stephenie" ? "ST" : s.user === "Tyler" ? "TY" : "JO";
  const titles = {
    Stephenie: "Company administrator",
    Tyler: "Policy operations",
    John: "Operations lead",
  };
  let content;
  switch (page) {
    case "Overview":
      content = (
        <Overview
          navigate={navigate}
          newOrder={() => setNewOrder(true)}
          openOrder={setOrderId}
          openCompany={setCompanyId}
        />
      );
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
      content = <Financials />;
      break;
    case "Partner portal":
      content = <PartnerPortal onDoc={openDoc} />;
      break;
    case "Handoffs":
      content = <Handoffs />;
      break;
    case "Automations":
      content = <Automations />;
      break;
    case "Settings":
      content = <Settings />;
  }
  return (
    <SidebarProvider style={{ "--sidebar-width": "248px" } as CSSProperties}>
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
          <div className="workspace-switch">
            <span className="workspace-symbol">
              <Building2 size={17} />
            </span>
            <div>
              <strong>Company operations</strong>
              <small>North &amp; South Carolina</small>
            </div>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <p className="nav-caption">WORKSPACE</p>
          <SidebarMenu>
            {navigation.map(({ label, icon: Icon }, i) => (
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
              Local demo workspace
              <small>
                Fictional data ·{" "}
                {ready ? "saved in this browser" : "loading records"}
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
                {titles[s.user as keyof typeof titles] || "Team member"}
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
            Workspace <ChevronRight size={13} />
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
            <span>Local preview · September 2026 demo workspace</span>
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
                {pageNames.map((p) => (
                  <CommandItem key={p} onSelect={() => navigate(p)}>
                    {p}
                    <ChevronRight size={14} />
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandGroup heading="Companies">
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
              </CommandGroup>
              <CommandGroup heading="Orders">
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
              </CommandGroup>
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
    </SidebarProvider>
  );
}
function FileTextIcon() {
  return <Files size={15} />;
}
