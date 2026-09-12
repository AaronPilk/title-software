"use client";
import { useState } from "react";
import { CheckCheck, Send, Archive, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldLabel, Picker, Status } from "./shared";
import { useWorkspace } from "@/lib/title/store";
import { sameDocumentFamily } from "@/lib/title/production";
import {
  materials,
  createPublication,
  reviewPublication,
  publishDocument,
  withdrawPublication,
  publicationEligible,
  publicationReady,
  replacementPublications,
  latestDocument,
  type DocumentPublication,
} from "@/lib/title/materials";

export function PublicationManager({
  documentId,
  materialId = "",
}: {
  documentId: string;
  materialId?: string;
}) {
  const { s, update } = useWorkspace();
  const doc = s.documents.find((d) => d.id === documentId)!;
  const c = s.companies.find((c) => c.id === doc.companyId)!;
  const [title, setTitle] = useState(doc.name),
    [audience, setAudience] = useState<DocumentPublication["audience"]>(
      "All company partners",
    ),
    [members, setMembers] = useState<string[]>([]);
  const publications = materials(s).publications.filter(
    (p) =>
      p.companyId === doc.companyId &&
      (p.documentId === documentId ||
        (materialId && p.materialId === materialId) ||
        s.documents.some(
          (d) => d.id === p.documentId && sameDocumentFamily(doc, d),
        )),
  );
  const pending = publications.some(
    (p) =>
      ["Draft", "Reviewed"].includes(p.status) &&
      (p.documentId === doc.id || (materialId && p.materialId === materialId)),
  );
  const eligible = publicationEligible(doc) && latestDocument(s, doc);
  return (
    <section className="publication-manager">
      <div className="section-heading">
        <div>
          <p className="eyebrow">PARTNER DOCUMENTS</p>
          <h3>Publish a reviewed version</h3>
        </div>
        <Send size={19} />
      </div>
      <p className="subtle">
        Publication selects this document version and its audience. A later
        upload stays private until reviewed and published.
      </p>
      {!eligible ? (
        <p className="notice warning">
          {!publicationEligible(doc)
            ? "This source is restricted from partner sharing. Prepare a separate redacted copy if a partner version is needed."
            : "This is an earlier version. Open the latest file to prepare a replacement; its existing publication remains available."}
        </p>
      ) : (
        !pending && (
          <div className="form-stack publication-draft">
            <FieldLabel label="Partner document title">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={140}
              />
            </FieldLabel>
            <FieldLabel label="Document audience">
              <Picker
                label="Document audience"
                value={audience}
                onChange={(v) => {
                  setAudience(v as DocumentPublication["audience"]);
                  setMembers([]);
                }}
                options={["All company partners", "Selected members"]}
              />
            </FieldLabel>
            {audience === "Selected members" && (
              <div className="publication-members">
                {c.members.map((m) => (
                  <label key={m.name}>
                    <Checkbox
                      checked={members.includes(m.name)}
                      onCheckedChange={(v) =>
                        setMembers((names) =>
                          v === true
                            ? [...names, m.name]
                            : names.filter((n) => n !== m.name),
                        )
                      }
                    />
                    {m.name}
                  </label>
                ))}
                {!c.members.length && (
                  <p className="subtle">
                    Record the company's members before preparing a
                    selected-member audience.
                  </p>
                )}
              </div>
            )}
            <Button
              variant="outline"
              onClick={async () =>
                await update(
                  (d) => {
                    createPublication(d, {
                      documentId,
                      materialId,
                      title,
                      audience,
                      memberNames: members,
                    });
                  },
                  "Publication draft prepared",
                  doc.name,
                )
              }
            >
              Prepare publication draft
            </Button>
          </div>
        )
      )}
      {publications.map((p) => (
        <PublicationCard key={`${p.id}-${p.status}`} publication={p} />
      ))}
      <p className="form-note">
        This controls a local partner preview. It does not create accounts,
        grant software access, send documents or record transaction-specific
        disclosure delivery.
      </p>
    </section>
  );
}
function PublicationCard({
  publication: p,
}: {
  publication: DocumentPublication;
}) {
  const { s, update } = useWorkspace();
  const [note, setNote] = useState(""),
    [checked, setChecked] = useState(false),
    [replace, setReplace] = useState(false),
    [withdraw, setWithdraw] = useState(false),
    [reason, setReason] = useState("");
  const ready = publicationReady(s, p),
    prior = replacementPublications(s, p);
  return (
    <section className="publication-card">
      <div className="section-heading">
        <strong>{p.title}</strong>
        <Status value={p.status} />
      </div>
      <p className="subtle">
        {p.documentName} · v{p.documentVersion} ·{" "}
        {p.audience === "Selected members"
          ? p.memberNames.join(", ")
          : p.audience}
      </p>
      {["Draft", "Reviewed"].includes(p.status) && !ready && (
        <p className="notice warning">
          The selected source, material approval or audience changed. Withdraw
          this draft and prepare the current version.
        </p>
      )}
      {p.status === "Draft" && ready && (
        <div className="form-stack">
          <FieldLabel label="Publication review note">
            <Textarea
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                setChecked(false);
              }}
              placeholder="Record the document, wording and audience review."
            />
          </FieldLabel>
          <label className="publication-attestation">
            <Checkbox
              checked={checked}
              onCheckedChange={(v) => setChecked(v === true)}
            />
            I reviewed this exact version and its intended audience.
          </label>
          <Button
            disabled={!checked || !note.trim()}
            onClick={async () =>
              await update(
                (d) => reviewPublication(d, p.id, note),
                "Publication review recorded",
                p.title,
              )
            }
          >
            <CheckCheck />
            Approve publication review
          </Button>
        </div>
      )}
      {p.status === "Reviewed" && ready && (
        <div className="form-stack">
          <p className="subtle">
            Reviewed by {p.reviewedBy} ·{" "}
            {new Date(p.reviewedAt).toLocaleString()}
          </p>
          {prior.length > 0 && (
            <label className="publication-attestation">
              <Checkbox
                checked={replace}
                onCheckedChange={(v) => setReplace(v === true)}
              />
              Replace{" "}
              {prior
                .map(
                  (x) =>
                    `${x.title} v${x.documentVersion} (${x.audience === "Selected members" ? x.memberNames.join(", ") : x.audience})`,
                )
                .join("; ")}{" "}
              with this release for{" "}
              {p.audience === "Selected members"
                ? p.memberNames.join(", ")
                : "all company partners"}
              . Partners outside the new audience will lose access to the
              previous release.
            </label>
          )}
          <Button
            disabled={prior.length > 0 && !replace}
            onClick={async () =>
              await update(
                (d) =>
                  publishDocument(
                    d,
                    p.id,
                    prior.map((x) => x.id),
                  ),
                "Reviewed document published locally",
                p.title,
              )
            }
          >
            <Send />
            {prior.length
              ? "Replace published version"
              : "Publish to partner preview"}
          </Button>
        </div>
      )}
      {p.status === "Published" && (
        <p className="publication-live">
          Published by {p.publishedBy} on{" "}
          {new Date(p.publishedAt).toLocaleString()} · v{p.documentVersion}{" "}
          remains selected until replaced or withdrawn.
        </p>
      )}
      {["Draft", "Reviewed", "Published"].includes(p.status) && (
        <div className="publication-withdraw">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setWithdraw((v) => !v)}
          >
            <Archive />
            {p.status === "Published"
              ? "Withdraw publication"
              : "Withdraw draft"}
          </Button>
          {withdraw && (
            <div className="form-stack">
              <FieldLabel label="Withdrawal reason">
                <Textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </FieldLabel>
              <Button
                variant="outline"
                disabled={!reason.trim()}
                onClick={async () =>
                  await update(
                    (d) => withdrawPublication(d, p.id, reason),
                    "Publication withdrawn",
                    p.title,
                  )
                }
              >
                Confirm withdrawal
              </Button>
            </div>
          )}
        </div>
      )}
      <details className="material-history">
        <summary>
          <History size={14} />
          Publication history
        </summary>
        {p.history.map((e, i) => (
          <div key={i}>
            <strong>{e.action}</strong>
            <span>
              {e.actor} · {new Date(e.at).toLocaleString()}
            </span>
            <p>{e.note}</p>
          </div>
        ))}
      </details>
    </section>
  );
}
