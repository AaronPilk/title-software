"use client";
import { useState } from "react";
import { Download, CheckCheck, ArrowRight, Clock3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Heading, Picker, Status, Empty, Metric, FieldLabel } from "./shared";
import { useWorkspace, download } from "@/lib/title/store";
import {
  business,
  handoffCurrent,
  recordHandoff,
  type Handoff,
} from "@/lib/title/business";
export function Handoffs() {
  const { s } = useWorkspace();
  const [filter, setFilter] = useState("All handoffs");
  const jobs = business(s).handoffs.filter(
    (j) => filter === "All handoffs" || j.kind === filter,
  );
  return (
    <>
      <Heading
        title="Handoffs"
        description="Reviewed work waiting for the systems your team uses."
      >
        <Picker
          value={filter}
          label="Handoff kind"
          onChange={setFilter}
          options={[
            "All handoffs",
            "SoftPro commitment",
            "SoftPro final policy",
            "SoftPro CPL",
            "Missive reply",
            "Application packet",
          ]}
        />
      </Heading>
      <div className="metrics">
        <Metric
          label="Awaiting connection"
          value={
            business(s).handoffs.filter(
              (j) => j.status === "Awaiting connection" && handoffCurrent(s, j),
            ).length
          }
          detail="Current reviewed preparations"
        />
        <Metric
          label="Needs attention"
          value={
            business(s).handoffs.filter(
              (j) => j.status !== "Recorded locally" && !handoffCurrent(s, j),
            ).length
          }
          detail="Source changed or on hold"
        />
        <Metric
          label="Outcomes recorded"
          value={
            business(s).handoffs.filter((j) => j.status === "Recorded locally")
              .length
          }
          detail="Local evidence references"
        />
        <Metric
          label="Live connections"
          value="0"
          detail="APIs will be connected later"
        />
      </div>
      <div className="handoff-list">
        {jobs.map((j) => (
          <HandoffCard key={j.id} job={j} />
        ))}
        {!jobs.length && (
          <section className="panel">
            <Empty
              title="Reviewed work will appear here"
              text="Prepare a commitment, policy, application packet or approved revision reply to create its handoff."
            />
          </section>
        )}
      </div>
    </>
  );
}
function HandoffCard({ job }: { job: Handoff }) {
  const { s, update } = useWorkspace();
  const [reference, setReference] = useState(job.reference),
    [note, setNote] = useState(job.note);
  const current = handoffCurrent(s, job);
  return (
    <section className="panel business-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">
            {job.kind} · {s.companies.find((c) => c.id === job.companyId)?.name}
          </p>
          <h2>{job.subject}</h2>
        </div>
        <Status
          value={
            job.status === "Recorded locally"
              ? job.status
              : current
                ? job.status
                : "Source changed"
          }
        />
      </div>
      <p className="subtle">
        Created {new Date(job.createdAt).toLocaleString()} ·{" "}
        {job.orderId || "Company onboarding"}
      </p>
      {!current && job.status !== "Recorded locally" && (
        <p className="notice warning">
          The source is no longer current. Return to the preparation workspace
          and review a new version.
        </p>
      )}
      <div className="form-grid">
        <FieldLabel label="Outcome reference">
          <Input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="External workflow confirmation or review reference"
          />
        </FieldLabel>
        <FieldLabel label="Outcome note">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Record what was completed and where evidence is stored."
          />
        </FieldLabel>
      </div>
      <div className="source-actions">
        <Button
          disabled={!current || job.status === "Recorded locally"}
          onClick={async () =>
            await update(
              (d) => recordHandoff(d, job.id, reference, note),
              "Handoff outcome recorded locally",
              job.subject,
            )
          }
        >
          <CheckCheck />
          Record outcome
        </Button>
        <Button
          variant="outline"
          disabled={!current}
          onClick={() =>
            download(
              `${job.id}.json`,
              JSON.stringify(
                { demo: true, noExternalActionPerformed: true, job },
                null,
                2,
              ),
              "application/json",
            )
          }
        >
          <Download />
          Export current handoff
        </Button>
      </div>
      <p className="form-note">
        This records an operator-reported outcome. It does not run SoftPro, send
        email, submit applications or verify an external result.
      </p>
    </section>
  );
}
