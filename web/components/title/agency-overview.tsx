"use client";

import { ArrowRight, Building2, ChevronRight, FileText, Plus, CalendarClock, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/lib/title/store";
import { type Page } from "@/lib/title/model";
import { companyDisplayStage } from "@/lib/title/company-operating-status";
import { agencySetupReadiness } from "@/lib/title/agency-setup";
import { upcomingMaintenance } from "@/lib/title/agency-maintenance";
import { businessDay } from "@/lib/title/business-date";
import { Empty, Heading, Metric, SectionTitle, Status } from "./shared";
import { CompanyLogo } from "./company-logo";
import styles from "./agency-overview.module.css";

const setupAttentionLabels: Record<string, string> = {
  "license-submitted": "license submission outstanding",
  "license-approved": "license approval pending",
  "license-original": "license document outstanding",
  "license-renewal": "license renewal schedule needs confirmation",
  "underwriter-submitted": "application submission outstanding",
  "underwriter-approved": "approval pending",
  "underwriter-original": "approval document outstanding",
};

export function AgencyOverview({ navigate, newCompany, openCompany }: {
  navigate: (page: Page) => void;
  newCompany?: () => void;
  openCompany?: (id: string, tab?: "Overview" | "Application" | "Setup" | "Documents") => void;
}) {
  const { s, connection } = useWorkspace();
  const access = connection?.access;
  const canAdd = !access || access.allCompanies && ["owner", "admin", "onboarding"].includes(access.role);
  const date = businessDay();
  const active = s.companies.filter(c => companyDisplayStage(c) === "Active");
  const setup = s.companies.filter(c => companyDisplayStage(c) === "Onboarding");
  const tasks = s.tasks.filter(t => t.scope !== "production" && (!t.companyId || s.companies.some(c => c.id === t.companyId)) && !t.done && t.phaseOne?.applicable !== false)
    .sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999") || a.id.localeCompare(b.id));
  const visibleMaintenance = s.agencyMaintenance?.records.filter(record => !record.companyId || s.companies.some(company => company.id === record.companyId)) || [];
  const renewals = upcomingMaintenance(s, date).filter(record => !record.companyId || s.companies.some(company => company.id === record.companyId));
  const overdue = tasks.filter(t => t.due && t.due < date);
  const attention = new Map<string, { name: string; reasons: Set<string>; actions: Set<"setup" | "tasks" | "maintenance"> }>();
  const addAttention = (companyId: string, reason: string, action: "setup" | "tasks" | "maintenance") => {
    const company = s.companies.find(company => company.id === companyId);
    if (companyId && !company) return;
    const entry = attention.get(companyId) || { name: company?.name || "Agency", reasons: new Set<string>(), actions: new Set<"setup" | "tasks" | "maintenance">() };
    entry.reasons.add(reason); entry.actions.add(action); attention.set(companyId, entry);
  };
  for (const task of overdue) addAttention(task.companyId, `${task.title} · overdue since ${task.due}`, task.phaseOne?.kind === "maintenance" ? "maintenance" : "tasks");
  for (const renewal of renewals.filter(record => record.overdue)) addAttention(renewal.companyId, `${renewal.title} · overdue since ${renewal.nextDueOn}`, "maintenance");
  for (const task of tasks) if (task.phaseOne?.kind === "setup" && task.phaseOne.applicable && task.phaseOne.required && /^(license|underwriter)-/.test(task.phaseOne.itemId || "")) {
    const label = setupAttentionLabels[task.phaseOne.itemId || ""];
    addAttention(task.companyId, label ? `${task.phaseOne.subject || "Company"} ${label}` : `${task.title} · incomplete`, "setup");
  }
  for (const record of visibleMaintenance) if (["Delinquent", "Inactive", "Dissolved", "Suspended"].includes(record.standing))
    addAttention(record.companyId, `${record.title} · ${record.standing}`, "maintenance");
  const attentionCompanies = [...attention.keys()].filter(Boolean).length;
  const open = (id: string, tab: "Overview" | "Application" | "Setup" | "Documents" = "Overview") => openCompany ? openCompany(id, tab) : navigate("Companies");
  return <>
    <Heading title="Agency overview" eyebrow="Company management" description="Your companies, their setup, and what needs attention next.">
      {canAdd && <Button onClick={() => newCompany ? newCompany() : navigate("Companies")}><Plus /> Add company</Button>}
    </Heading>
    <section className={`panel ${styles.welcome}`} aria-label="Agency workspace">
      <div className={styles.welcomeIcon}><Building2 size={27} aria-hidden="true" /></div>
      <div className={styles.welcomeCopy}><h2>Every company, in one place.</h2><p>Open a company to upload its documents, update its details, or work through setup. Existing active companies keep their active status.</p></div>
      <Button variant="outline" onClick={() => navigate("Companies")}>Open companies <ArrowRight /></Button>
    </section>
    <div className="metrics">
      <Metric label="Active companies" value={active.length} detail={`${s.companies.length} companies in your portfolio`} />
      <Metric label="Companies in setup" value={setup.length} detail="New ventures being prepared" />
      <Metric label="Open company tasks" value={tasks.length} detail={`${overdue.length} past their due date`} />
      <Metric label="Upcoming renewals" value={renewals.length} detail="Due within 14 days, including overdue" />
      <Metric label="Companies needing attention" value={attentionCompanies} detail="Approvals, status flags or overdue work" />
    </div>
    {attention.size > 0 && <section className={`panel ${styles.attention}`} aria-label="Needs attention">
      <SectionTitle title="Needs attention" action="All tasks" onClick={() => navigate("Tasks")} />
      {[...attention].slice(0, 5).map(([companyId, entry]) => {
        const reasons = [...entry.reasons];
        return <div key={companyId || "agency"} className={styles.attentionRow}>
          <div className={styles.attentionCopy}><strong>{entry.name}</strong><ul>{reasons.slice(0, 2).map(reason => <li key={reason}>{reason}</li>)}</ul>{reasons.length > 2 && <details><summary>{reasons.length - 2} more items</summary><ul>{reasons.slice(2).map(reason => <li key={reason}>{reason}</li>)}</ul></details>}</div>
          <div className={styles.attentionActions}>{entry.actions.has("setup") && companyId && <Button size="sm" variant="outline" aria-label={`Review ${entry.name} setup`} onClick={() => open(companyId, "Setup")}>Review setup</Button>}{entry.actions.has("maintenance") && <Button size="sm" variant="outline" aria-label={`Review ${entry.name} maintenance`} onClick={() => navigate("Tasks")}>Review maintenance</Button>}{entry.actions.has("tasks") && <Button size="sm" variant="outline" aria-label={`Review ${entry.name} tasks`} onClick={() => navigate("Tasks")}>Review tasks</Button>}</div>
        </div>;
      })}
      {attention.size > 5 && <div className={styles.panelFooter}>{attention.size - 5} more companies or agency items need attention. Open All tasks to review their work.</div>}
    </section>}
    <div className={styles.mainGrid}>
      <section className="panel" aria-labelledby="agency-next-steps">
        <SectionTitle title="Company setup" action="All companies" onClick={() => navigate("Companies")} />
        <p className={styles.sectionNote}>One checklist for each new venture. Completed applications stay in its document cabinet.</p>
        {setup.slice(0, 5).map(company => {
          const canReadSetup = !access || access.restricted;
          const readiness = agencySetupReadiness(s, company.id);
          const applicable = readiness.tasks.filter(t => t.phaseOne?.applicable);
          return <button className={styles.caseRow} key={company.id} onClick={() => open(company.id, "Setup")}>
            <CompanyLogo company={company} /><span className={styles.rowCopy}><strong>{company.name}</strong><span>{!canReadSetup ? "Open the company setup available to your account" : company.agencySetup ? `${applicable.filter(t => t.done).length} of ${applicable.length} steps complete` : "Choose the setup steps that apply"}</span><small>{canReadSetup && readiness.ready ? "Ready for activation review" : "Open setup & approvals"}</small></span><ChevronRight size={17} aria-hidden="true" />
          </button>;
        })}
        {!setup.length && <Empty title="No new companies in setup" text="Active companies can add their existing records at any time. Their documents do not need to be re-entered as a new application." />}
        {setup.length > 5 && <div className={styles.panelFooter}>{setup.length - 5} more companies in setup</div>}
      </section>
      <section className="panel" aria-label="Upcoming agency renewals">
        <SectionTitle title="Renewals & maintenance" action="Manage" onClick={() => navigate("Tasks")} />
        {renewals.slice(0, 5).map(record => <button key={record.id} className={styles.taskRow} onClick={() => navigate("Tasks")}><CalendarClock size={19} /><span className={styles.rowCopy}><strong>{record.title}</strong><small>{record.nextDueOn} · {record.overdue ? "Overdue" : `In ${record.daysUntilDue} days`}</small></span><ChevronRight size={17} /></button>)}
        {!renewals.length && <Empty title="No renewals due in the next 14 days" text="Track company, ownership-entity and agency renewals in Tasks. Confirm dates from the renewal notices." />}
        <button className={styles.readinessRow} onClick={() => navigate("Tasks")}><ListChecks size={19} /><span><strong>Manage maintenance schedules</strong><small>Licenses, annual reports, services and agency coverage</small></span><ChevronRight size={16} /></button>
      </section>
    </div>
    <div className={styles.mainGrid}>
      <section className="panel" aria-label="Company portfolio records">
        <SectionTitle title="Your company portfolio" action="View all" onClick={() => navigate("Companies")} />
        {s.companies.slice(0, 5).map(company => <button key={company.id} className={styles.portfolioRow} onClick={() => open(company.id)}><CompanyLogo company={company} /><span className={styles.rowCopy}><strong>{company.name}</strong><small>{(company.operatingStates || [company.jurisdiction]).filter(Boolean).join(" · ") || "Operating state not entered"}</small></span><Status value={companyDisplayStage(company)} /><ChevronRight size={16} /></button>)}
        {!s.companies.length && <Empty title="No companies available" text="Your administrator can add companies or assign access to existing ones." />}
        <button className={styles.readinessRow} onClick={() => navigate("Documents")}><FileText size={19} /><span><strong>Company documents</strong><small>Applications, agreements, formation records and more</small></span><ChevronRight size={16} /></button>
      </section>
      <section className="panel" aria-label="Company team follow-ups">
        <SectionTitle title="Team follow-ups" action="All tasks" onClick={() => navigate("Tasks")} />
        {tasks.slice(0, 5).map(task => <button key={task.id} className={styles.taskRow} onClick={() => navigate("Tasks")}><span className={styles.rowCopy}><strong>{task.title}</strong><small>{s.companies.find(c => c.id === task.companyId)?.name || "Agency"} · {task.owner || "Unassigned"}</small><small>{task.due ? `Due ${task.due}` : "No due date"}</small></span><Status value={task.due && task.due < date ? "Overdue" : task.status || "Open"} /></button>)}
        {!tasks.length && <Empty title="No open company tasks" text="Setup and maintenance follow-ups appear here as work is added." />}
      </section>
    </div>
  </>;
}
