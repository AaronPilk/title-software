"use client";
import { useState } from "react";
import { CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspace } from "@/lib/title/store";
import { FieldLabel, Status, Empty } from "./shared";
import {
  ownershipHistory,
  recordOwnership,
  ownershipDrift,
} from "@/lib/title/ownership-history";

/**
 * Effective-dated ownership for one company. The company's member editor
 * above holds ownership as it stands today; this records what it was, and
 * from when, so a close for an earlier month allocates on that month's shares.
 */
export function OwnershipHistoryPanel({ companyId }: { companyId: string }) {
  const { s, update } = useWorkspace();
  const [open, setOpen] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const company = s.companies.find((c) => c.id === companyId);
  const history = ownershipHistory(s, companyId);
  const drift = ownershipDrift(s).filter((d) => d.companyId === companyId);
  if (!company) return null;

  async function record(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const input = {
      effectiveFrom: String(f.get("effectiveFrom") || ""),
      // The interests as they stand in the member editor above.
      members: company!.members.map((m) => ({ name: m.name, share: m.share })),
      reason: String(f.get("reason") || ""),
    };
    if (
      !(await update(
        (d) => {
          recordOwnership(d, companyId, input);
        },
        history.length ? "Ownership change recorded" : "Opening ownership recorded",
        `${company!.name} · from ${input.effectiveFrom}`,
      ))
    )
      return;
    setOpen(false);
  }

  return (
    <section className="ownership-panel">
      <header className="ownership-head">
        <div>
          <strong>Ownership history</strong>
          <small>
            {history.length
              ? `${history.length} dated record${history.length === 1 ? "" : "s"} · a close allocates on the ownership in effect at the end of its month`
              : "No dated records yet — every close allocates on the interests above, whenever it is run"}
          </small>
        </div>
        <Button variant="outline" size="sm" onClick={() => setOpen((v) => !v)}>
          <CalendarClock size={15} />
          {open
            ? "Close"
            : history.length
              ? "Record a change"
              : "Record opening ownership"}
        </Button>
      </header>

      {open && (
        <form className="form-stack ownership-form" onSubmit={record}>
          <p className="form-note">
            This saves the member interests as currently <em>saved</em> above,
            dated from when they took effect. If this record should differ,
            change the interests and save them first.
          </p>
          <ul className="ownership-preview">
            {company.members.map((m) => (
              <li key={m.name}>
                <span>{m.name}</span>
                <strong>{m.share}%</strong>
              </li>
            ))}
          </ul>
          <FieldLabel label="Effective from">
            <Input
              name="effectiveFrom"
              type="date"
              required
              max={today}
              defaultValue={today}
            />
          </FieldLabel>
          <FieldLabel label="Why the ownership is what it is">
            <Textarea
              name="reason"
              required
              maxLength={300}
              placeholder="Operating agreement at formation; amended agreement admitting a member; interest purchased."
            />
          </FieldLabel>
          <Button type="submit">
            {history.length ? "Record change" : "Record opening ownership"}
          </Button>
        </form>
      )}

      {!!drift.length && (
        <div className="ownership-drift">
          <Status value="Needs attention" />
          <p>
            {drift.length} published close
            {drift.length === 1 ? "" : "s"} allocated on ownership other than
            the dated record now governing that month
            {drift.map((d) => ` (${d.month} rev ${d.revision})`).join(",")}.
            Published allocations stay frozen — correct one with a reviewed
            close revision if that is the right call.
          </p>
        </div>
      )}

      {!history.length ? (
        <Empty
          title="No dated ownership on file"
          text="Record the opening position once, then record each change as it happens."
        />
      ) : (
        <ol className="ownership-list">
          {[...history].reverse().map((r) => (
            <li key={r.id} className="ownership-row">
              <div className="ownership-row-head">
                <strong>From {r.effectiveFrom}</strong>
                <Status value={r.opening ? "Opening" : "Change"} />
              </div>
              <ul className="ownership-preview">
                {r.members.map((m) => (
                  <li key={m.name}>
                    <span>{m.name}</span>
                    <strong>{m.share}%</strong>
                  </li>
                ))}
              </ul>
              <p className="ownership-reason">{r.reason}</p>
              <small className="subtle">
                Recorded by {r.recordedBy} on {r.recordedAt.slice(0, 10)}
              </small>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
