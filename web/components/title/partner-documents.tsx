"use client";
import { useState } from "react";
import { FileText, ChevronRight } from "lucide-react";
import { useWorkspace } from "@/lib/title/store";
import { partnerPublications } from "@/lib/title/materials";
import { DocumentPreview } from "./documents";
import { Empty, Picker, FieldLabel } from "./shared";

export function PartnerDocuments({ companyId }: { companyId: string }) {
  const { s, connection } = useWorkspace();
  const isPartner = connection?.access.role === "partner";
  const [member, setMember] = useState("all"),
    [selected, setSelected] = useState("");
  const c = s.companies.find((c) => c.id === companyId)!;
  const audience = c.members.some((m) => m.name === member) ? member : "";
  const publications = isPartner
    ? (s.materials?.publications || []).filter((p) => p.companyId === companyId)
    : partnerPublications(s, companyId, audience);
  const active = publications.find((p) => p.id === selected),
    doc = active && s.documents.find((d) => d.id === active.documentId);
  return (
    <section className="panel partner-panel">
      <div className="section-heading">
        <div>
          <h2>Published company documents</h2>
          <p className="subtle">
            The exact versions your team has reviewed for sharing.
          </p>
        </div>
      </div>
      {!isPartner && (
        <FieldLabel label="Preview document audience">
          <Picker
            label="Preview document audience"
            value={audience || "all"}
            onChange={(v) => {
              setMember(v);
              setSelected("");
            }}
            options={[
              { value: "all", label: "All-company audience only" },
              ...c.members.map((m) => ({ value: m.name, label: m.name })),
            ]}
          />
        </FieldLabel>
      )}
      {publications.map((p) => (
        <button
          key={p.id}
          className="doc-list-row"
          onClick={() => setSelected(p.id)}
        >
          <FileText size={22} />
          <div className="grow">
            <strong>{p.title}</strong>
            <small>
              {p.documentName} · Version {p.documentVersion} · Published{" "}
              {new Date(p.publishedAt).toLocaleDateString()}
            </small>
          </div>
          <ChevronRight size={15} />
        </button>
      ))}
      {!publications.length && (
        <Empty
          title="No documents published to this audience"
          text="Reviewed versions appear here after the team explicitly publishes them."
        />
      )}
      {doc && active && (
        <DocumentPreview
          doc={doc}
          partner
          publicationId={active.id}
          partnerMember={audience}
          onClose={() => setSelected("")}
        />
      )}
      <p className="form-note">
        {isPartner
          ? "Access is checked against your assigned membership."
          : "Audience selection is an administrator preview."}
      </p>
    </section>
  );
}
