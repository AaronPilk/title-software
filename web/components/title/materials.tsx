"use client";
import { useState } from "react";
import {
  Plus,
  Upload,
  CheckCheck,
  FileText,
  History,
  Palette,
  ListChecks,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useWorkspace } from "@/lib/title/store";
import type { VaultDoc } from "@/lib/title/model";
import {
  materials,
  materialKinds,
  setupMaterials,
  createMaterial,
  updateMaterial,
  approveMaterial,
  materialCurrent,
  latestDocument,
  type CompanyMaterial,
  type MaterialKind,
} from "@/lib/title/materials";
import { PublicationManager } from "./publications";
import { UploadDocument } from "./documents";
import { FieldLabel, Picker, Status, Empty } from "./shared";

export function CompanyMaterials({
  companyId,
  onDoc,
}: {
  companyId: string;
  onDoc: (doc: VaultDoc) => void;
}) {
  const { s, update } = useWorkspace();
  const [selected, setSelected] = useState(""),
    [adding, setAdding] = useState(false),
    [uploading, setUploading] = useState(false);
  const items = materials(s).items.filter((i) => i.companyId === companyId),
    item = items.find((i) => i.id === selected) || items[0];
  const approved = items.filter((i) => materialCurrent(s, i)).length;
  return (
    <div className="company-materials">
      <div className="section-heading">
        <div>
          <p className="eyebrow">COMPANY MATERIALS</p>
          <h3>Ready for the next request</h3>
        </div>
        <Palette size={22} />
      </div>
      <p className="subtle">
        Keep the requested wording, owner, approved file and publication history
        together.
      </p>
      <div className="materials-summary">
        <span>
          <strong>{items.length}</strong> materials
        </span>
        <span>
          <strong>{approved}</strong> current approvals
        </span>
        <span>
          <strong>
            {
              items.filter(
                (i) => i.status !== "Not needed" && !materialCurrent(s, i),
              ).length
            }
          </strong>{" "}
          need attention
        </span>
      </div>
      <div className="source-actions">
        <Button variant="outline" onClick={() => setAdding(true)}>
          <Plus />
          Request material
        </Button>
        <Button variant="outline" onClick={() => setUploading(true)}>
          <Upload />
          Upload company file
        </Button>
        <Button
          variant="ghost"
          onClick={async () =>
            await update((d) => {
              setupMaterials(d, companyId);
            }, "Materials checklist prepared")
          }
        >
          <ListChecks />
          Set up standard checklist
        </Button>
      </div>
      {items.length > 0 ? (
        <>
          <FieldLabel label="Company material">
            <Picker
              label="Company material"
              value={item.id}
              onChange={setSelected}
              options={items.map((i) => ({
                value: i.id,
                label: `${i.title} · ${i.status === "Approved" && !materialCurrent(s, i) ? "New review needed" : i.status}`,
              }))}
            />
          </FieldLabel>
          <MaterialEditor
            key={`${item.id}-${item.revision}-${item.status}`}
            item={item}
            onDoc={onDoc}
          />
        </>
      ) : (
        <Empty
          title="Build this company's materials checklist"
          text="Start with the logo, disclosure template, title preference form and business card, or request another company asset."
        />
      )}
      {adding && (
        <NewMaterial
          companyId={companyId}
          onClose={() => setAdding(false)}
          onCreated={setSelected}
        />
      )}
      {uploading && (
        <UploadDocument
          companyId={companyId}
          onClose={() => setUploading(false)}
        />
      )}
    </div>
  );
}
function MaterialEditor({
  item,
  onDoc,
}: {
  item: CompanyMaterial;
  onDoc: (doc: VaultDoc) => void;
}) {
  const { s, update } = useWorkspace();
  const [title, setTitle] = useState(item.title),
    [owner, setOwner] = useState(item.owner),
    [brief, setBrief] = useState(item.brief),
    [documentId, setDocument] = useState(item.documentId || "none"),
    [status, setStatus] = useState<string>(
      item.status === "Approved" ? "Awaiting review" : item.status,
    ),
    [note, setNote] = useState(""),
    [review, setReview] = useState(""),
    [checked, setChecked] = useState(false);
  const current = materialCurrent(s, item),
    doc = s.documents.find((d) => d.id === item.documentId);
  const docs = s.documents.filter(
    (d) =>
      d.companyId === item.companyId &&
      !d.orderId &&
      d.category !== "Applications" &&
      latestDocument(s, d),
  );
  const dirty =
    title !== item.title ||
    owner !== item.owner ||
    brief !== item.brief ||
    (documentId === "none" ? "" : documentId) !== item.documentId ||
    (item.status !== "Approved" && status !== item.status);
  return (
    <section className="material-editor">
      <div className="section-heading">
        <div>
          <p className="eyebrow">
            {item.kind} · REVISION {item.revision}
          </p>
          <h3>{item.title}</h3>
        </div>
        <Status
          value={
            item.status === "Approved" && !current
              ? "New review needed"
              : item.status
          }
        />
      </div>
      {item.kind === "Affiliated-business disclosure" && (
        <p className="notice">
          This reviews a company template. It does not record
          transaction-specific disclosure delivery or determine legal
          sufficiency.
        </p>
      )}
      <div className="form-grid">
        <FieldLabel label="Material title">
          <Input
            value={title}
            maxLength={140}
            onChange={(e) => setTitle(e.target.value)}
          />
        </FieldLabel>
        <FieldLabel label="Responsible person">
          <Input value={owner} onChange={(e) => setOwner(e.target.value)} />
        </FieldLabel>
      </div>
      <FieldLabel label="Requested content and branding">
        <Textarea
          value={brief}
          rows={3}
          onChange={(e) => setBrief(e.target.value)}
        />
      </FieldLabel>
      <FieldLabel label="Working document">
        <Picker
          label="Working material document"
          value={documentId}
          onChange={setDocument}
          options={[
            { value: "none", label: "No document attached" },
            ...docs.map((d) => ({
              value: d.id,
              label: `${d.name} · v${d.version}`,
            })),
            ...(doc && !docs.some((d) => d.id === doc.id)
              ? [
                  {
                    value: doc.id,
                    label: `${doc.name} · v${doc.version} (earlier version)`,
                  },
                ]
              : []),
          ]}
        />
      </FieldLabel>
      <div className="form-grid">
        <FieldLabel label="Preparation status">
          <Picker
            label="Material preparation status"
            value={status}
            onChange={setStatus}
            options={[
              "Requested",
              "In progress",
              "Awaiting review",
              "Not needed",
            ]}
          />
        </FieldLabel>
        <FieldLabel label="Change / not-needed note">
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </FieldLabel>
      </div>
      <div className="source-actions">
        <Button
          variant="outline"
          onClick={async () =>
            await update(
              (d) =>
                updateMaterial(d, item.id, {
                  title,
                  owner,
                  brief,
                  documentId: documentId === "none" ? "" : documentId,
                  status: status as CompanyMaterial["status"],
                  note,
                  revision: item.revision,
                }),
              "Material preparation saved",
              title,
            )
          }
        >
          {item.status === "Approved"
            ? "Save a new material revision"
            : "Save preparation"}
        </Button>
        {doc && (
          <Button variant="ghost" onClick={() => onDoc(doc)}>
            <FileText />
            Preview attached v{doc.version}
          </Button>
        )}
      </div>
      {item.status === "Awaiting review" && (
        <div className="material-approval form-stack">
          <FieldLabel label="Material approval note">
            <Textarea
              value={review}
              onChange={(e) => {
                setReview(e.target.value);
                setChecked(false);
              }}
              placeholder="Record the company, wording, branding and document review."
            />
          </FieldLabel>
          <label className="publication-attestation">
            <Checkbox
              checked={checked}
              onCheckedChange={(v) => setChecked(v === true)}
            />
            I checked the saved material and attached document.
          </label>
          <Button
            disabled={dirty || !checked || !review.trim()}
            onClick={async () =>
              await update(
                (d) => approveMaterial(d, item.id, item.revision, review),
                "Material approval recorded",
                item.title,
              )
            }
          >
            <CheckCheck />
            Approve material
          </Button>
          {dirty && (
            <p className="form-note">Save your changes before approving.</p>
          )}
        </div>
      )}
      {current && (
        <p className="publication-live">
          Approved by {item.reviewedBy} on{" "}
          {new Date(item.reviewedAt).toLocaleString()} · {doc?.name} v
          {doc?.version}
        </p>
      )}
      {doc && current && (
        <PublicationManager
          key={`${item.id}-${doc.id}`}
          documentId={doc.id}
          materialId={item.id}
        />
      )}
      <details className="material-history">
        <summary>
          <History size={14} />
          Material history
        </summary>
        {item.history.map((e, i) => (
          <div key={i}>
            <strong>{e.action}</strong>
            <span>
              {e.actor} · {new Date(e.at).toLocaleString()}
            </span>
            <p>{e.note}</p>
            {e.approval && (
              <p>
                Approved revision {e.approval.revision} ·{" "}
                {e.approval.documentName} v{e.approval.documentVersion}
              </p>
            )}
          </div>
        ))}
      </details>
      <p className="form-note">
        Material approval and partner publication are separate from the
        company's onboarding launch review.
      </p>
    </section>
  );
}
function NewMaterial({
  companyId,
  onClose,
  onCreated,
}: {
  companyId: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { update } = useWorkspace();
  const [kind, setKind] = useState<MaterialKind>("Other material"),
    [title, setTitle] = useState(""),
    [owner, setOwner] = useState("Stephenie"),
    [brief, setBrief] = useState("");
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="modal">
        <DialogHeader>
          <DialogTitle>Request company material</DialogTitle>
          <DialogDescription>
            Capture what the company needs and who will prepare it.
          </DialogDescription>
        </DialogHeader>
        <form
          className="form-stack"
          onSubmit={async (e) => {
            e.preventDefault();
            let id = "";
            if (
              await update(
                (d) => {
                  id = createMaterial(d, {
                    companyId,
                    kind,
                    title,
                    owner,
                    brief,
                  });
                },
                "Company material requested",
                title,
              )
            ) {
              onCreated(id);
              onClose();
            }
          }}
        >
          <FieldLabel label="Material type">
            <Picker
              label="Material type"
              value={kind}
              onChange={(v) => setKind(v as MaterialKind)}
              options={[...materialKinds]}
            />
          </FieldLabel>
          <FieldLabel label="Material title">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              maxLength={140}
            />
          </FieldLabel>
          <FieldLabel label="Responsible person">
            <Input
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              required
            />
          </FieldLabel>
          <FieldLabel label="Requested content and branding">
            <Textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              required
              rows={4}
            />
          </FieldLabel>
          <Button type="submit">Create material request</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
