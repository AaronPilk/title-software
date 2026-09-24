"use client";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  CalendarDays,
  ChevronRight,
  Files,
  Plus,
  ScanLine,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/lib/title/store";
import { companyById, money, type Page } from "@/lib/title/model";
import { companyDisplayStage } from "@/lib/title/company-operating-status";
import {
  Heading,
  Metric,
  CompanyAvatar,
  Status,
  SectionTitle,
  Empty,
} from "./shared";
import { overviewPremium, reportingDate } from "./overview-summary";
import styles from "./overview.module.css";
export function Overview({
  title = "Your title workspace",
  navigate,
  newOrder,
  openOrder,
  openCompany,
}: {
  title?: string;
  navigate: (p: Page) => void;
  newOrder: () => void;
  openOrder: (id: string) => void;
  openCompany: (id: string) => void;
}) {
  const { s, connection } = useWorkspace();
  const [date, setDate] = useState(() => reportingDate());
  useEffect(() => {
    const timer = setInterval(() => setDate(reportingDate()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const access = connection?.access;
  const canManageAccess = !!access && (access.role === "owner" || (access.role === "admin" && access.allCompanies));
  const canAddOrder = !access || ["owner", "admin", "operations"].includes(access.role);
  const firstRun = !!connection && !s.orders.length;
  const activeCompanies = s.companies.filter((company) => companyDisplayStage(company) === "Active").length;
  const newCompanies = s.companies.filter((company) => companyDisplayStage(company) === "Onboarding").length;
  const attention = s.orders.filter((o) =>
    ["Needs review", "Ready for jacket"].includes(o.status),
  );
  const open = s.orders.filter(
    (o) => !["Issued", "Rejected"].includes(o.status),
  );
  const issued = overviewPremium(s, date.period);
  return (
    <>
      <Heading
        title={title}
        eyebrow={date.label}
        description="Your incoming requests, open files and policy work."
      >
        {canAddOrder && s.companies.length > 0 && <Button onClick={newOrder}>
          <Plus />
          New order
        </Button>}
      </Heading>
      {firstRun && <section className={`panel ${styles.setup}`} aria-labelledby="workspace-setup-title">
        <h2 id="workspace-setup-title">{s.companies.length ? "Start your first title file" : "Company access needed"}</h2>
        <p>{s.companies.length
          ? "Choose the company, read the incoming request, then create its title file."
          : "No companies are available to your account yet. Your workspace administrator can review your company access."}</p>
        <div className={styles.steps}>
          <div className={styles.step}>
            <span className={styles.number}>1</span><h3>Choose a company</h3>
            <p>{s.companies.length ? `${s.companies.length} ${s.companies.length === 1 ? "company is" : "companies are"} available. Find the business receiving this work in the company directory.` : "Your assigned companies will appear in the company directory when access is available."}</p>
            <Button variant="outline" disabled={!s.companies.length} onClick={() => navigate("Companies")}>Company directory</Button>
          </div>
          <div className={styles.step}>
            <span className={styles.number}>2</span><h3>Read the request</h3>
            <p>Read incoming email or open a saved request to confirm the property and the work needed.</p>
            <Button variant="outline" disabled={!s.companies.length} onClick={() => navigate("Inbox")}>Open inbox</Button>
          </div>
          <div className={styles.step}>
            <span className={styles.number}>3</span><h3>Create the title file</h3>
            <p>{canAddOrder ? "Create an order for the selected company and property, then attach its source documents to the title file." : "Your operations team can create the first file and attach its source documents."}</p>
            <div className={styles.actions}>
              {canAddOrder && <Button disabled={!s.companies.length} onClick={newOrder}>New order</Button>}
            </div>
          </div>
        </div>
      </section>}
      <div className="metrics">
        <Metric
          label="Open orders"
          value={open.length}
          detail={`Across ${new Set(open.map((o) => o.companyId)).size} companies`}
        />
        <Metric
          label="Ready for review"
          value={s.orders.filter((o) => o.status === "Needs review").length}
          detail="Policy preparation queue"
        />
        <Metric
          label="Active companies"
          value={activeCompanies}
          detail={`${newCompanies} new ${newCompanies === 1 ? "company" : "companies"} in setup`}
        />
        <Metric
          label={`${date.month} premium`}
          value={money(issued.premium)}
          detail={`${issued.products} issued policy products · ${date.period}${connection ? "" : " · sample data"}`}
        />
      </div>
      {issued.legacyOrders > 0 && <p className={styles.ledgerNote}>{issued.legacyOrders} older issued {issued.legacyOrders === 1 ? "file has" : "files have"} only a file-level premium and {issued.legacyOrders === 1 ? "is" : "are"} excluded. This total uses the recorded issue period for each policy product.</p>}
      <div className="dashboard-grid">
        <section className="panel attention">
          <div className="section-heading">
            <div>
              <ScanLine size={19} color="var(--brand-accent)" />
              <h2>Needs your attention</h2>
            </div>
            <Button
              variant="ghost"
              onClick={() => navigate("Policy workbench")}
            >
              View workbench
              <ArrowRight />
            </Button>
          </div>
          {attention.slice(0, 3).map((o) => (
            <button
              className="attention-row row-button"
              key={o.id}
              onClick={() => openOrder(o.id)}
            >
              <span className={`order-icon ${o.exception ? "amber" : "blue"}`}>
                <Files size={21} />
              </span>
              <div className="grow">
                <strong>{o.address}</strong>
                <small>
                  {o.id} · {companyById(s, o.companyId).name}
                </small>
              </div>
              <Status value={o.exception ? "Needs attention" : o.status} />
              <ChevronRight size={17} />
            </button>
          ))}
          {!attention.length && (
            <Empty
              title={s.orders.length ? "No files awaiting review" : "No title files yet"}
              text={s.orders.length ? "Files marked for review will appear here." : "Create an order or capture a request to begin."}
            />
          )}
          <div className="panel-foot">
            <span className="tiny-dot" />
            Review proposed changes before preparing a policy.
          </div>
        </section>
        <section className="panel day-card">
          <div className="section-heading">
            <h2>Your day</h2>
            <CalendarDays size={18} />
          </div>
          <div className="date-large">
            <strong>{date.day}</strong>
            <span>
              {date.month}
              <br />
              {date.weekday}
            </span>
          </div>
          {s.tasks
            .filter((t) => !t.done)
            .slice(0, 2)
            .map((t) => (
              <button
                key={t.id}
                className="day-task row-button"
                onClick={() => navigate("Tasks")}
              >
                <span
                  className={`task-dot ${t.owner === "John" ? "violet" : "blue"}`}
                />
                <div>
                  <strong>{companyById(s, t.companyId).name}</strong>
                  <small>
                    {t.title} · {t.owner}
                  </small>
                </div>
              </button>
            ))}
          {!s.tasks.some((task) => !task.done) && <Empty title="No open tasks" text="Assigned work will appear here." />}
          <Button
            variant="ghost"
            className="full-width"
            onClick={() => navigate("Tasks")}
          >
            Open task list
            <ArrowRight />
          </Button>
        </section>
      </div>
      <div className="dashboard-grid bottom-grid">
        <section className="panel">
          <SectionTitle
            title="Company portfolio"
            action="All companies"
            onClick={() => navigate("Companies")}
          />
          {s.companies.slice(0, 4).map((c) => (
            <button
              className="company-line row-button"
              key={c.id}
              onClick={() => openCompany(c.id)}
            >
              <CompanyAvatar company={c} />
              <div className="grow">
                <strong>{c.name}</strong>
                <small>
                  {[c.contact, c.jurisdiction].filter(Boolean).join(" · ")}
                </small>
              </div>
              <Status value={companyDisplayStage(c)} />
              <ChevronRight size={16} />
            </button>
          ))}
          {!s.companies.length && <Empty title="No companies available" text="Your workspace administrator can review your company access." />}
        </section>
        <section className="panel">
          <SectionTitle
            title="Workspace activity"
            action={canManageAccess ? "View all" : undefined}
            onClick={canManageAccess ? () => navigate("Settings") : undefined}
          />
          <div className="activity-list">
            {s.activity.slice(0, 3).map((a, i) => (
              <div className="activity-item" key={a.id}>
                <span
                  className={`activity-dot ${i === 1 ? "violet" : "blue"}`}
                />
                <div>
                  <strong>{a.title}</strong>
                  <p>{a.detail}</p>
                  <small>
                    {new Date(a.at).toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </small>
                </div>
              </div>
            ))}
            {!s.activity.length && <Empty title="No recorded activity yet" text="Saved changes will appear here." />}
          </div>
        </section>
      </div>
    </>
  );
}
