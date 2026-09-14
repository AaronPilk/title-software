"use client";
import { DeliveryManager } from "./deliveries";
import { DocumentTextReview } from "./document-text-review";
import {
  sourceRoles,
  outputRoles,
  sameDocumentFamily,
  neededFields,
  fieldDefinitions,
  titleFile,
  type SourceRole,
} from "@/lib/title/production";
import { getCommitment } from "@/lib/title/business";
import { useEffect, useRef, useState } from "react";
import { materials, partnerPublications } from "@/lib/title/materials";
import { PublicationManager } from "./publications";
import {
  Download,
  Upload,
  FileText,
  Shield,
  Eye,
  FolderClosed,
  LockKeyhole,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TableRow, TableCell } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useWorkspace, download, saveAsset, getAsset } from "@/lib/title/store";
import { uid, companyById, type VaultDoc } from "@/lib/title/model";
import {
  Heading,
  SearchBox,
  Picker,
  Segments,
  Status,
  DataTable,
  Empty,
  FieldLabel,
} from "./shared";
import { toast } from "sonner";
export function Documents({
  onDoc,
  onUpload,
}: {
  onDoc: (d: VaultDoc) => void;
  onUpload: () => void;
}) {
  const { s } = useWorkspace();
  const [q, setQ] = useState("");
  const [company, setCompany] = useState("all");
  const [category, setCategory] = useState("All documents");
  const rows = s.documents.filter(
    (d) =>
      (company === "all" || d.companyId === company) &&
      (category === "All documents" || d.visibility === category) &&
      `${d.name} ${d.category} ${companyById(s, d.companyId).name}`
        .toLowerCase()
        .includes(q.toLowerCase()),
  );
  return (
    <>
      <Heading
        title="Document vault"
        description="The right document. Exactly where you expect it."
      >
        <Button onClick={onUpload}>
          <Upload />
          Upload document
        </Button>
      </Heading>
      <div className="vault-categories">
        {[
          { name: "Company records", icon: FolderClosed },
          { name: "Policy documents", icon: FileText },
          { name: "Applications", icon: LockKeyhole },
        ].map(({ name, icon: Icon }) => (
          <button
            key={name}
            className="vault-category"
            onClick={() => setQ(q === name ? "" : name)}
          >
            <span className="folder-art">
              <Icon size={25} />
            </span>
            <div>
              <strong>{name}</strong>
              <small>
                {s.documents.filter((d) => d.category === name).length}{" "}
                documents
              </small>
            </div>
          </button>
        ))}
      </div>
      <div className="toolbar">
        <Segments
          value={category}
          onChange={setCategory}
          items={["All documents", "Internal", "Restricted", "Partner"]}
        />
        <div className="toolbar-right">
          <SearchBox
            value={q}
            onChange={setQ}
            placeholder="Search documents…"
          />
          <Picker
            value={company}
            onChange={setCompany}
            label="Document company"
            options={[
              { value: "all", label: "All companies" },
              ...s.companies.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
        </div>
      </div>
      {s.documents.some(
        (d) =>
          d.visibility === "Partner" &&
          !materials(s).publications.some((p) => p.documentId === d.id),
      ) && (
        <p className="inline-note">
          Previously marked Partner documents need an explicit publication
          review. Open a document to choose its version and audience.
        </p>
      )}
      <section className="panel">
        <DataTable
          headers={[
            "Document",
            "Company",
            "Category",
            "Visibility",
            "Modified",
            "Version",
            "",
          ]}
        >
          {rows.map((d) => (
            <TableRow key={d.id}>
              <TableCell>
                <button className="document-name" onClick={() => onDoc(d)}>
                  <span className="file-icon">
                    <FileText size={19} />
                  </span>
                  <strong>{d.name}</strong>
                </button>
              </TableCell>
              <TableCell>{companyById(s, d.companyId).name}</TableCell>
              <TableCell>{d.category}</TableCell>
              <TableCell>
                <Status
                  value={
                    materials(s).publications.some(
                      (p) => p.documentId === d.id && p.status === "Published",
                    )
                      ? "Published"
                      : d.visibility === "Partner"
                        ? "Sharing review needed"
                        : d.visibility
                  }
                />
              </TableCell>
              <TableCell>{d.date}</TableCell>
              <TableCell>v{d.version}</TableCell>
              <TableCell>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Preview ${d.name} ${companyById(s, d.companyId).name}`}
                  onClick={() => onDoc(d)}
                >
                  <Eye />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </DataTable>
        {!rows.length && <Empty />}
        <div className="table-foot">
          {rows.length} documents
          <span>Uploaded files stay in this browser</span>
        </div>
      </section>
    </>
  );
}
export function UploadDocument({
  companyId,
  orderId,
  initialRole,
  policyId,
  commitmentVersion,
  cplId,
  cplVersion,
  correctionId,
  onClose,
}: {
  companyId: string | null;
  orderId?: string;
  initialRole?: SourceRole;
  policyId?: string;
  commitmentVersion?: number;
  cplId?: string;
  cplVersion?: number;
  correctionId?: string;
  onClose: () => void;
}) {
  const { s, update } = useWorkspace();
  const [company, setCompany] = useState(
    s.orders.find((o) => o.id === orderId)?.companyId ||
      companyId ||
      s.companies[0]?.id ||
      "",
  );
  const [linkedOrder, setLinkedOrder] = useState(orderId || "none");
  const [role, setRole] = useState<SourceRole>(initialRole || "Other");
  const [category, setCategory] = useState(
    orderId ? "Policy documents" : "Company records",
  );
  const [visibility, setVisibility] = useState("Internal");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!files.length) return;
    if (
      files.length > 10 ||
      files.some((f) => f.size > 25 * 1024 * 1024) ||
      files.reduce((n, f) => n + f.size, 0) > 100 * 1024 * 1024
    ) {
      toast.error("Use up to 10 files, 25 MB each and 100 MB per batch.");
      return;
    }
    if (
      files.some(
        (f) =>
          ![
            "application/pdf",
            "text/plain",
            "image/png",
            "image/jpeg",
            "text/csv",
          ].includes(f.type),
      )
    ) {
      toast.error("Use PDF, TXT, CSV, PNG, or JPG files.");
      return;
    }
    setBusy(true);
    try {
      const uploaded: VaultDoc[] = [];
      for (const file of files) {
        const id = uid("doc");
        await saveAsset(id, file, { companyId: company, documentId: id });
        const version =
          Math.max(
            0,
            ...[...s.documents, ...uploaded]
              .filter((d) =>
                sameDocumentFamily(d, {
                  companyId: company,
                  orderId: linkedOrder === "none" ? undefined : linkedOrder,
                  name: file.name,
                  sourceRole: linkedOrder === "none" ? undefined : role,
                  policyId,
                  cplId,
                } as VaultDoc),
              )
              .map((d) => d.version),
          ) + 1;
        uploaded.push({
          id,
          companyId: company,
          orderId: linkedOrder === "none" ? undefined : linkedOrder,
          sourceRole: linkedOrder === "none" ? undefined : role,
          policyId,
          correctionId,
          preparationFingerprint:
            linkedOrder !== "none" && role === "Commitment output"
              ? getCommitment(
                  s,
                  s.orders.find((o) => o.id === linkedOrder)!,
                ).snapshot
              : role === "Final policy"
                ? s.business?.policies.find((p) => p.id === policyId)
                    ?.preparedSnapshot
                : role === "CPL"
                  ? s.business?.cpls.find((c) => c.id === cplId)?.snapshot
                  : role === "Correction output"
                    ? s.business?.corrections.find((c) => c.id === correctionId)
                        ?.reviewSnapshot
                    : undefined,
          commitmentVersion,
          cplId,
          cplVersion,
          policyVersion: policyId
            ? s.business?.policies.find((p) => p.id === policyId)?.version
            : undefined,
          productionVersion:
            linkedOrder !== "none" && outputRoles.includes(role)
              ? titleFile(s.orders.find((o) => o.id === linkedOrder)!).version
              : undefined,
          name: file.name,
          category,
          visibility: visibility as VaultDoc["visibility"],
          date: new Date().toISOString().slice(0, 10),
          size: `${Math.max(1, Math.round(file.size / 1024))} KB`,
          version,
          assetId: id,
          mime: file.type,
        });
      }
      const saved = await update(
        (d) => {
          if (
            outputRoles.includes(role) &&
            uploaded.some((file) =>
              d.documents.some(
                (existing) =>
                  existing.companyId === file.companyId &&
                  existing.orderId === file.orderId &&
                  existing.name === file.name &&
                  !outputRoles.includes(existing.sourceRole!),
              ),
            )
          )
            throw new Error(
              "Use a distinct filename for the revised commitment so it cannot replace a final-source document.",
            );
          d.documents.unshift(...uploaded);
          const o = d.orders.find((o) => o.id === linkedOrder);
          if (o && o.status !== "Issued" && !outputRoles.includes(role)) {
            o.production = {
              ...titleFile(o),
              commitmentReview: undefined,
              version: titleFile(o).version + 1,
            };
            o.fields.forEach((f) => {
              if (neededFields(o).find((x) => x.id === f.id)?.role === role)
                f.reviewed = false;
            });
            if (o.status === "Ready for jacket") o.status = "Needs review";
          }
        },
        "Documents saved locally",
        `${uploaded.length} files · ${companyById(s, company).name}`,
      );
      if (saved) onClose();
    } catch {
      toast.error(
        "The file could not be stored in this browser. Try a smaller file.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="modal">
        <DialogHeader>
          <DialogTitle>Upload documents</DialogTitle>
          <DialogDescription>
            Use sample or redacted files. This demo has no production access
            controls.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="form-stack">
          <label className="upload-drop">
            <Upload size={26} />
            <strong>
              {files.length
                ? `${files.length} files selected`
                : "Choose documents"}
            </strong>
            <span>Up to 10 files · 25 MB each · 100 MB per batch</span>
            <Input
              aria-label="Select sample document"
              type="file"
              multiple
              accept=".pdf,.txt,.csv,.png,.jpg,.jpeg"
              onChange={(e) => setFiles(Array.from(e.target.files || []))}
              required
            />
          </label>
          <FieldLabel label="Company">
            <Picker
              value={company}
              onChange={(v) => {
                setCompany(v);
                setLinkedOrder("none");
              }}
              label="Upload company"
              options={s.companies
                .filter((c) => !orderId || c.id === company)
                .map((c) => ({ value: c.id, label: c.name }))}
            />
          </FieldLabel>
          <FieldLabel label="Linked order">
            <Picker
              label="Link upload to order"
              value={linkedOrder}
              onChange={(v) => {
                setLinkedOrder(v);
                if (v !== "none") setCategory("Policy documents");
              }}
              options={[
                ...(!orderId
                  ? [{ value: "none", label: "Company documents only" }]
                  : []),
                ...s.orders
                  .filter(
                    (o) =>
                      o.companyId === company && (!orderId || o.id === orderId),
                  )
                  .map((o) => ({
                    value: o.id,
                    label: `${o.id} · ${o.address}`,
                  })),
              ]}
            />
          </FieldLabel>
          {linkedOrder !== "none" && (
            <FieldLabel label="Source type">
              <Picker
                label="Uploaded source type"
                value={role}
                onChange={(v) => setRole(v as SourceRole)}
                options={sourceRoles}
              />
            </FieldLabel>
          )}
          <div className="form-grid">
            <FieldLabel label="Category">
              <Picker
                value={category}
                onChange={(v) => {
                  setCategory(v);
                  if (v === "Applications") setVisibility("Restricted");
                }}
                label="Document category"
                options={[
                  "Company records",
                  "Formation",
                  "Applications",
                  "Policy documents",
                  "Branding",
                  "Disclosures",
                  "Agreements",
                ]}
              />
            </FieldLabel>
            <FieldLabel label="Visibility label">
              <Picker
                value={visibility}
                onChange={setVisibility}
                label="Document visibility"
                options={
                  category === "Applications"
                    ? ["Restricted"]
                    : ["Internal", "Restricted"]
                }
              />
            </FieldLabel>
          </div>
          <p className="form-note">
            Uploading the same filename to the same company creates a new
            version. Nothing is sent to an external service.
          </p>
          <div className="form-actions">
            <Button
              variant="outline"
              type="button"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button disabled={!files.length || busy} type="submit">
              {busy ? "Saving…" : "Save documents"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
export function DocumentPreview({
  doc,
  onClose,
  partner = false,
  publicationId,
  partnerMember = "",
}: {
  doc: VaultDoc;
  onClose: () => void;
  partner?: boolean;
  publicationId?: string;
  partnerMember?: string;
}) {
  const { s, update, connection } = useWorkspace();
  const [url, setUrl] = useState("");
  const [text, setText] = useState(doc.text || "");
  const [error, setError] = useState("");
  const allowed =
    !partner ||
    (connection?.access.role === "partner" &&
      s.materials?.publications.some(
        (p) => p.id === publicationId && p.documentId === doc.id,
      )) ||
    partnerPublications(s, doc.companyId, partnerMember).some(
      (p) => p.id === publicationId && p.documentId === doc.id,
    );
  const permission = useRef(allowed);
  permission.current = allowed;
  useEffect(() => {
    let alive = true,
      blobUrl = "";
    setError("");
    setUrl("");
    setText(doc.text || "");
    if (!allowed) return;
    if (doc.assetId)
      getAsset(doc.assetId)
        .then(async (blob) => {
          if (!alive) return;
          if (doc.mime?.startsWith("text/")) {
            const value = await blob.text();
            if (alive) setText(value);
          } else {
            blobUrl = URL.createObjectURL(blob);
            setUrl(blobUrl);
          }
        })
        .catch(() => {
          if (alive)
            setError(
              "This file is no longer available in this browser. Upload it again.",
            );
        });
    return () => {
      alive = false;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [doc, allowed]);
  async function downloadDoc() {
    try {
      if (!permission.current) throw new Error("Publication unavailable");
      const content = doc.assetId
        ? await getAsset(doc.assetId)
        : doc.text || "Demo document";
      if (!permission.current) throw new Error("Publication unavailable");
      download(doc.name, content);
    } catch {
      toast.error("File is not available.");
    }
  }
  if (!allowed)
    return (
      <Dialog open onOpenChange={(v) => !v && onClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Publication unavailable</DialogTitle>
            <DialogDescription>
              This document is no longer published to the selected audience.
            </DialogDescription>
          </DialogHeader>
          <Button onClick={onClose}>Close</Button>
        </DialogContent>
      </Dialog>
    );
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="document-modal">
        <DialogHeader>
          <DialogTitle>{doc.name}</DialogTitle>
          <DialogDescription>
            {companyById(s, doc.companyId).name} · {doc.category} · Version{" "}
            {doc.version}
          </DialogDescription>
        </DialogHeader>
        <div className="document-modal-tools">
          <Status value={partner ? "Published" : doc.visibility} />
          <span>{doc.size}</span>
          <Button variant="outline" size="sm" onClick={downloadDoc}>
            <Download />
            Download
          </Button>
        </div>
        {error ? (
          <Empty title="File unavailable" text={error} />
        ) : text ? (
          <pre className="text-preview">{text}</pre>
        ) : url ? (
          doc.mime === "application/pdf" ? (
            <iframe title={doc.name} src={url} className="file-preview" />
          ) : (
            <img className="image-preview" alt={doc.name} src={url} />
          )
        ) : (
          <div className="empty-state">Loading local file…</div>
        )}
        {!partner && (
          <div className="document-sharing">
            <span>
              <Shield size={15} />
              Visibility label
            </span>
            <Picker
              value={doc.visibility === "Partner" ? "Internal" : doc.visibility}
              label="Change visibility label"
              options={["Internal", "Restricted"]}
              onChange={async (v) =>
                await update(
                  (d) => {
                    d.documents.find((x) => x.id === doc.id)!.visibility =
                      v as VaultDoc["visibility"];
                  },
                  "Document visibility label updated",
                  doc.name,
                )
              }
            />
            <small>
              Partner sharing requires the separate publication review below.
            </small>
          </div>
        )}
        {!partner && <DocumentTextReview key={`${doc.id}:${doc.version}:${doc.assetId}:text`} doc={doc} />}
        {!partner && <PublicationManager key={doc.id} documentId={doc.id} />}
        {!partner && doc.orderId && (
          <DeliveryManager key={`${doc.id}:delivery`} documentId={doc.id} />
        )}
      </DialogContent>
    </Dialog>
  );
}
