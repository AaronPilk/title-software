"use client";
import { useEffect, useState } from "react";
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
                <Status value={d.visibility} />
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
  onClose,
}: {
  companyId: string | null;
  onClose: () => void;
}) {
  const { s, update } = useWorkspace();
  const [company, setCompany] = useState(companyId || s.companies[0].id);
  const [category, setCategory] = useState("Company records");
  const [visibility, setVisibility] = useState("Internal");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Choose a file smaller than 10 MB.");
      return;
    }
    if (
      ![
        "application/pdf",
        "text/plain",
        "image/png",
        "image/jpeg",
        "text/csv",
      ].includes(file.type)
    ) {
      toast.error("Use a PDF, TXT, CSV, PNG, or JPG file.");
      return;
    }
    setBusy(true);
    try {
      const id = uid("doc");
      await saveAsset(id, file);
      const version =
        Math.max(
          0,
          ...s.documents
            .filter((d) => d.companyId === company && d.name === file.name)
            .map((d) => d.version),
        ) + 1;
      update(
        (d) =>
          d.documents.unshift({
            id,
            companyId: company,
            name: file.name,
            category,
            visibility: visibility as VaultDoc["visibility"],
            date: new Date().toISOString().slice(0, 10),
            size: `${Math.max(1, Math.round(file.size / 1024))} KB`,
            version,
            assetId: id,
            mime: file.type,
          }),
        "Document saved locally",
        `${file.name} · ${companyById(s, company).name}`,
      );
      onClose();
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
          <DialogTitle>Upload a document</DialogTitle>
          <DialogDescription>
            Use sample or redacted files. This demo has no production access
            controls.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="form-stack">
          <label className="upload-drop">
            <Upload size={26} />
            <strong>{file ? file.name : "Choose a document"}</strong>
            <span>PDF, TXT, CSV, PNG or JPG · up to 10 MB</span>
            <Input
              aria-label="Select sample document"
              type="file"
              accept=".pdf,.txt,.csv,.png,.jpg,.jpeg"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              required
            />
          </label>
          <FieldLabel label="Company">
            <Picker
              value={company}
              onChange={setCompany}
              label="Upload company"
              options={s.companies.map((c) => ({ value: c.id, label: c.name }))}
            />
          </FieldLabel>
          <div className="form-grid">
            <FieldLabel label="Category">
              <Picker
                value={category}
                onChange={setCategory}
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
                options={["Internal", "Restricted", "Partner"]}
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
            <Button disabled={!file || busy} type="submit">
              {busy ? "Saving…" : "Save document"}
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
}: {
  doc: VaultDoc;
  onClose: () => void;
  partner?: boolean;
}) {
  const { s, update } = useWorkspace();
  const [url, setUrl] = useState("");
  const [text, setText] = useState(doc.text || "");
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true,
      blobUrl = "";
    setError("");
    setText(doc.text || "");
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
  }, [doc]);
  async function downloadDoc() {
    try {
      download(
        doc.name,
        doc.assetId ? await getAsset(doc.assetId) : doc.text || "Demo document",
      );
    } catch {
      toast.error("File is not available.");
    }
  }
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
          <Status value={doc.visibility} />
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
              value={doc.visibility}
              label="Change visibility label"
              options={["Internal", "Restricted", "Partner"]}
              onChange={(v) =>
                update(
                  (d) => {
                    d.documents.find((x) => x.id === doc.id)!.visibility =
                      v as VaultDoc["visibility"];
                  },
                  "Document visibility label updated",
                  doc.name,
                )
              }
            />
            <small>Demo labels control the partner preview only.</small>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
