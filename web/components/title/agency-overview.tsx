"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Building2, ChevronRight, FileText, Landmark, Plus, ShieldCheck, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/lib/title/store";
import { onboardingSteps, type Page } from "@/lib/title/model";
import { business, companyProblems, credentialCurrent, evidenceCurrent, getOnboarding } from "@/lib/title/business";
import { businessDay } from "@/lib/title/business-date";
import { taskClock } from "@/lib/title/task-clock";
import { canManageOnboardingEvidence } from "@/lib/title/workspace-capabilities";
import { companyDisplayStage } from "@/lib/title/company-operating-status";
import { Empty, Heading, Metric, SectionTitle, Status } from "./shared";
import { CompanyLogo } from "./company-logo";
import styles from "./agency-overview.module.css";

export function AgencyOverview({ navigate, newCompany, openCompany }: {
  navigate: (page: Page) => void;
  newCompany?: () => void;
  openCompany?: (id: string, tab?: "Overview" | "Application") => void;
}) {
  const { s, connection } = useWorkspace();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const access = connection?.access;
  const canAddCompany = !access || (access.allCompanies && ["owner", "admin", "onboarding"].includes(access.role));
  const canViewFinancials = !access || ["owner", "admin", "finance"].includes(access.role);
  const canViewApplicationEvidence = !access || access.restricted;
  const canEditApplication = canManageOnboardingEvidence(connection);
  const date = businessDay(now);
  const activeCompanies = s.companies.filter((company) => companyDisplayStage(company) === "Active").length;
  const newCompanies = s.companies.filter((company) => companyDisplayStage(company) === "Onboarding").length;
  const companyIds = new Set(s.companies.map((company) => company.id));
  // The server omits application cases without restricted-record access.
  // Their absence must not become a made-up missing-evidence diagnosis.
  const cases = canViewApplicationEvidence ? s.companies.map((company) => {
    const application = getOnboarding(s, company);
    const current = onboardingSteps.map((_, step) => evidenceCurrent(s, company.id, application.evidence.find((e) => e.step === step)));
    const problems = companyProblems(s, company, date);
    const nextStep = application.applicationStatus !== "Reviewed"
      ? "Review application"
      : current.some((reviewed) => !reviewed)
        ? onboardingSteps[current.indexOf(false)]
        : problems[0] || (!application.launchedAt ? companyDisplayStage(company) === "Active" ? "Complete workspace setup review" : "Record launch review" : "Workspace evidence current");
    return { company, application, current, problems, nextStep };
  }) : [];
  const openCases = cases.filter(({ company, application, current, problems }) => companyDisplayStage(company) === "Active" || company.stage === "Onboarding" || !application.launchedAt || current.some((reviewed) => !reviewed) || problems.length > 0);
  const ownershipGaps = s.companies.filter((company) => !company.members.length || Math.abs(company.members.reduce((total, member) => total + member.share, 0) - 100) > 0.00001);
  const authorityGaps = cases.filter(({ problems }) => problems.some((problem) => /Agency license|Producer credential|authority|Licensing review|Underwriter approval/.test(problem)));
  const credentialReviews = business(s).credentials.filter((credential) => companyIds.has(credential.companyId) && !credentialCurrent(credential, date));
  // A task's owner is a display label, never an account identity or access rule.
  const tasks = s.tasks.filter((task) => !task.done && companyIds.has(task.companyId))
    .map((task) => ({ task, clock: taskClock(task, now) }))
    .sort((a, b) => (a.clock.dueInDays ?? Infinity) - (b.clock.dueInDays ?? Infinity) || a.task.id.localeCompare(b.task.id));
  const openProfile = (id: string) => openCompany ? openCompany(id) : navigate("Companies");
  const openApplication = (id: string) => openCompany ? openCompany(id, "Application") : navigate("Onboarding");
  const addCompany = () => newCompany ? newCompany() : navigate("Companies");

  return <>
    <Heading title="Agency overview" eyebrow="Company management" description="Your companies, joint ventures and the work that keeps them moving.">
      {canAddCompany && <Button onClick={addCompany}><Plus /> Add company</Button>}
    </Heading>
    <section className={`panel ${styles.welcome}`} aria-label="Agency workspace">
      <div className={styles.welcomeIcon}><Building2 size={27} aria-hidden="true" /></div>
      <div className={styles.welcomeCopy}>
        <h2>One place for every company.</h2>
        <p>For an existing company, upload the application you already have. For a new joint venture, send a private application link.</p>
      </div>
      <Button variant="outline" onClick={() => navigate("Companies")}>Company portfolio <ArrowRight /></Button>
    </section>
    <div className="metrics">
      <Metric label="Company portfolio" value={s.companies.length} detail="Companies available to your account" />
      <Metric label="Active companies" value={activeCompanies} detail={`${newCompanies} new ${newCompanies === 1 ? "company" : "companies"} in setup`} />
      <Metric label="Authority records to review" value={credentialReviews.length} detail="Recorded credentials requiring review" />
      <Metric label="Open company tasks" value={tasks.length} detail={`${tasks.filter(({ clock }) => (clock.dueInDays ?? 0) < 0).length} past their due date`} />
    </div>
    <div className={styles.mainGrid}>
      <section className="panel" aria-labelledby="agency-next-steps">
        <div className="section-heading"><h2 id="agency-next-steps">Applications</h2><Button variant="ghost" onClick={() => navigate("Onboarding")}>All applications <ArrowRight /></Button></div>
        <p className={styles.sectionNote}>{canViewApplicationEvidence ? "Choose a company. Upload its completed form, review the information found, then save." : "Application reviews are shown when your account can access their evidence."}</p>
        {openCases.slice(0, 4).map(({ company, application, current, nextStep }) => <button className={styles.caseRow} key={company.id} onClick={() => openApplication(company.id)}>
          <CompanyLogo company={company} />
          <span className={styles.rowCopy}><strong>{company.name}</strong>{companyDisplayStage(company) === "Active"
            ? <><span>{!canEditApplication ? "View company application access" : s.documents.some(doc => doc.companyId === company.id && !doc.orderId && doc.category === "Applications" && doc.visibility === "Restricted" && doc.assetId) ? "Open application & saved originals" : "Upload completed application"}</span><small>Existing company · already operating</small></>
            : <><span>Next: {nextStep}</span><small>{application.applicationStatus} · {current.filter(Boolean).length} / {onboardingSteps.length} evidence steps current</small></>}</span>
          <ChevronRight size={17} aria-hidden="true" />
        </button>)}
        {!canViewApplicationEvidence ? <Empty title="Application evidence requires additional access" text="Company profiles, recorded credentials and shared tasks remain available. An administrator can review your access for application work." /> : !openCases.length && <Empty title={s.companies.length ? "No company reviews outstanding" : "Start with a company"} text={s.companies.length ? "Current applications and evidence are recorded for your available companies." : canAddCompany ? "Add a company or joint venture, then collect its application and formation records." : "Your administrator can assign the companies you help manage."} action={!s.companies.length && canAddCompany ? <Button onClick={addCompany}>Add your first company</Button> : undefined} />}
        {openCases.length > 4 && <div className={styles.panelFooter}>{openCases.length - 4} more companies in Applications</div>}
      </section>
      <section className="panel" aria-labelledby="agency-readiness">
        <div className="section-heading"><h2 id="agency-readiness">Company readiness</h2><ShieldCheck size={19} aria-hidden="true" /></div>
        <p className={styles.sectionNote}>Review missing records alongside the existing ones.</p>
        <button className={styles.readinessRow} onClick={() => navigate("Onboarding")}><ShieldCheck size={19} aria-hidden="true" /><span><strong>Licensing & authority</strong><small>{!s.companies.length ? "No companies available yet" : canViewApplicationEvidence ? `${authorityGaps.length} companies need evidence or credential review` : "Review the credential records available to your account"}</small></span><ChevronRight size={16} aria-hidden="true" /></button>
        <button className={styles.readinessRow} onClick={() => navigate("Companies")}><UsersRound size={19} aria-hidden="true" /><span><strong>Ownership records</strong><small>{s.companies.length ? `${ownershipGaps.length} companies need ownership totaling 100%` : "Add a company to record its ownership"}</small></span><ChevronRight size={16} aria-hidden="true" /></button>
        <button className={styles.readinessRow} onClick={() => navigate("Documents")}><FileText size={19} aria-hidden="true" /><span><strong>Company document vault</strong><small>Find formation records, agreements and materials</small></span><ChevronRight size={16} aria-hidden="true" /></button>
        {canViewFinancials && <button className={styles.readinessRow} onClick={() => navigate("Financials")}><Landmark size={19} aria-hidden="true" /><span><strong>Monthly close & member reports</strong><small>Review company books and prepare partner statements</small></span><ChevronRight size={16} aria-hidden="true" /></button>}
      </section>
    </div>
    <div className={styles.mainGrid}>
      <section className="panel" aria-label="Company portfolio records">
        <SectionTitle title="Your company portfolio" action="View all" onClick={() => navigate("Companies")} />
        {s.companies.slice(0, 5).map((company) => <button key={company.id} className={styles.portfolioRow} onClick={() => openProfile(company.id)}>
          <CompanyLogo company={company} />
          <span className={styles.rowCopy}><strong>{company.name}</strong><small>{(company.operatingStates || [company.jurisdiction]).join(" · ")} · {company.members.length ? `${company.members.length} ownership ${company.members.length === 1 ? "member" : "members"}` : "Ownership not entered"}</small></span>
          <Status value={companyDisplayStage(company)} /><ChevronRight size={16} aria-hidden="true" />
        </button>)}
        {!s.companies.length && <Empty title="No companies available" text="Each company keeps its own ownership, documents and onboarding case." />}
        {s.companies.length > 5 && <div className={styles.panelFooter}>{s.companies.length - 5} more companies in your portfolio</div>}
      </section>
      <section className="panel" aria-label="Company team follow-ups">
        <SectionTitle title="Team follow-ups" action="All tasks" onClick={() => navigate("Tasks")} />
        {tasks.slice(0, 4).map(({ task, clock }) => <button key={task.id} className={styles.taskRow} onClick={() => navigate("Tasks")}>
          <span className={styles.rowCopy}><strong>{task.title}</strong><small>{s.companies.find((company) => company.id === task.companyId)?.name}</small><small>{task.owner || "Unassigned"} · {task.due ? `Due ${task.due}` : "No due date"}</small></span>
          <Status value={clock.state} />
        </button>)}
        {!tasks.length && <Empty title="No open company tasks" text="Team follow-ups will appear here as work is assigned." />}
        {!!tasks.length && <div className={styles.panelFooter}>Shared company work, ordered by due date</div>}
      </section>
    </div>
  </>;
}
