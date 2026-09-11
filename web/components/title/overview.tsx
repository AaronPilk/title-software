"use client";
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
import {
  Heading,
  Metric,
  CompanyAvatar,
  Status,
  SectionTitle,
  Empty,
} from "./shared";
export function Overview({
  navigate,
  newOrder,
  openOrder,
  openCompany,
}: {
  navigate: (p: Page) => void;
  newOrder: () => void;
  openOrder: (id: string) => void;
  openCompany: (id: string) => void;
}) {
  const { s } = useWorkspace();
  const attention = s.orders.filter((o) =>
    ["Needs review", "Ready for jacket"].includes(o.status),
  );
  const open = s.orders.filter(
    (o) => !["Issued", "Rejected"].includes(o.status),
  );
  const issued = s.orders.filter(
    (o) => o.month === "2026-09" && o.status === "Issued",
  );
  return (
    <>
      <Heading
        title={`Good afternoon, ${s.user}.`}
        eyebrow="FRIDAY, SEPTEMBER 11"
        description="Here’s what’s happening across your title companies."
      >
        <Button onClick={newOrder}>
          <Plus />
          New order
        </Button>
      </Heading>
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
          value={s.companies.filter((c) => c.stage === "Active").length}
          detail={`${s.companies.filter((c) => c.stage === "Onboarding").length} companies onboarding`}
        />
        <Metric
          label="September premium"
          value={money(issued.reduce((n, o) => n + o.premium, 0))}
          detail="Issued policies · demo figures"
        />
      </div>
      <div className="dashboard-grid">
        <section className="panel attention">
          <div className="section-heading">
            <div>
              <ScanLine size={19} color="#4389e9" />
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
              title="You’re all caught up"
              text="New policy requests will appear here."
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
            <strong>11</strong>
            <span>
              September
              <br />
              Friday
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
                  {c.contact} · {c.jurisdiction}
                </small>
              </div>
              <Status value={c.stage} />
              <ChevronRight size={16} />
            </button>
          ))}
        </section>
        <section className="panel">
          <SectionTitle
            title="Workspace activity"
            action="View all"
            onClick={() => navigate("Settings")}
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
          </div>
        </section>
      </div>
    </>
  );
}
