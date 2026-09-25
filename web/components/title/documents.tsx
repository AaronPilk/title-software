"use client";
import { DeliveryManager } from "./deliveries";
import { canFillCompanyApplication } from "@/lib/title/application-document";
import { DocumentTextReview } from "./document-text-review";
import { safeDocumentMime } from "@/lib/title/backup-assets";
import { PdfPreview } from "./pdf-preview";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { TableRow, TableCell } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useWorkspace, download, getAsset } from "@/lib/title/store";
import { companyById, type VaultDoc } from "@/lib/title/model";
import {
  Heading,
  SearchBox,
  Picker,
  Segments,
  Status,
  DataTable,
  Empty,
} from "./shared";
import { toast } from "sonner";
export function Documents({
  onDoc,
  onUpload,
}: {
  onDoc: (d: VaultDoc) => void;
  onUpload: (companyId?: string, destination?: "company" | "title") => void;
}) {
  const { s, connection } = useWorkspace();
  const [q, setQ] = useState("");
  const [company, setCompany] = useState("all");
  const [category, setCategory] = useState("All documents");
  const [filing, setFiling] = useState("All documents");
  const companyRows = s.documents.filter(d => company === "all" || d.companyId === company);
  const rows = s.documents.filter(
    (d) =>
      (company === "all" || d.companyId === company) &&
      (category === "All documents" || d.visibility === category) &&
      (filing === "All documents" || (filing === "Company documents" ? !d.orderId : !!d.orderId)) &&
      `${d.name} ${d.category} ${companyById(s, d.companyId).name}`
        .toLowerCase()
        .includes(q.toLowerCase()),
  );
  return (
    <>
      <Heading
        title="Document vault"
        description="Company records and property files, with a clear place for every original."
      >
        <Button onClick={() => onUpload(company === "all" ? undefined : company, filing === "Title-file documents" ? "title" : "company")}>
          <Upload />
          Upload document
        </Button>
      </Heading>
      <div className="vault-categories document-filing-categories">
        {[
          { name: "Company documents", icon: FolderClosed, detail: "Formation, applications, agreements and logos", count: companyRows.filter(d => !d.orderId).length },
          { name: "Title-file documents", icon: FileText, detail: "Searches, deeds, finals and policies for a property", count: companyRows.filter(d => !!d.orderId).length },
        ].map(({ name, icon: Icon, detail, count }) => (
          <button
            key={name}
            className="vault-category"
            aria-pressed={filing === name}
            onClick={() => setFiling(filing === name ? "All documents" : name)}
          >
            <span className="folder-art">
              <Icon size={25} />
            </span>
            <div>
              <strong>{name}</strong>
              <small>
                {count} files · {detail}
              </small>
            </div>
          </button>
        ))}
      </div>
      <div className="toolbar document-filing-toolbar">
        <Segments
          value={filing}
          onChange={setFiling}
          items={["All documents", "Company documents", "Title-file documents"]}
        />
        <div className="toolbar-right">
          <SearchBox
            value={q}
            onChange={setQ}
            placeholder="Search documents…"
          />
          <Picker
            value={category}
            onChange={setCategory}
            label="Document access filter"
            options={[{value:"All documents", label:"All access levels"}, "Internal", "Restricted", "Partner"]}
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
            "Filed under",
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
              <TableCell>{d.orderId ? <><strong>{d.orderId}</strong><small className="block subtle">{s.orders.find(order => order.id === d.orderId)?.address || "Title file"}</small></> : "Company documents"}</TableCell>
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
          <span>
            {connection
              ? "Files are stored in your private workspace"
              : "Uploaded files stay in this browser"}
          </span>
        </div>
      </section>
    </>
  );
}
export { UploadDocument } from "./document-upload";
export function DocumentPreview({
  doc,
  onClose,
  partner = false,
  publicationId,
  partnerMember = "",
  initialPage = 1,
  onFillApplication,
}: {
  doc: VaultDoc;
  onClose: () => void;
  partner?: boolean;
  publicationId?: string;
  partnerMember?: string;
  initialPage?: number;
  onFillApplication?: (doc: VaultDoc) => void;
}) {
  const { s, update, connection } = useWorkspace();
  const connected = !!connection;
  const applicationFill = !partner && !!onFillApplication && canFillCompanyApplication(s, doc, connection);
  const [loaded, setLoaded] = useState<{ doc: VaultDoc; url?: string; text?: string; pdf?: Blob; error?: string } | null>(null);
  const current = loaded?.doc === doc ? loaded : null;
  const url = current?.url || "";
  const text = current?.text ?? doc.text ?? "";
  const error = current?.error || "";
  const allowed =
    s.documents.some(d => d.id === doc.id && d.assetId === doc.assetId && d.mime === doc.mime) && (
    !partner ||
    (connection?.access.role === "partner" &&
      s.materials?.publications.some(
        (p) => p.id === publicationId && p.documentId === doc.id,
      )) ||
    partnerPublications(s, doc.companyId, partnerMember).some(
      (p) => p.id === publicationId && p.documentId === doc.id,
    ));
  const permission = useRef(allowed);
  useEffect(() => {
    let alive = true,
      blobUrl = "";
    permission.current = allowed;
    if (!allowed) return;
    if (doc.assetId)
      getAsset(doc.assetId)
        .then(async (blob) => {
          if (!alive) return;
          const mime = doc.mime || "application/octet-stream";
          if (!safeDocumentMime(mime) || (blob.type || "application/octet-stream") !== mime)
            throw new Error("Document type mismatch");
          if (doc.mime?.startsWith("text/")) {
            const value = await blob.text();
            if (alive) setLoaded({ doc, text: value });
          } else if (mime === "application/pdf") {
            setLoaded({ doc, pdf: new Blob([blob], { type: mime }) });
          } else {
            // The preview type is fixed by validated metadata, never by a restored Blob.
            blobUrl = URL.createObjectURL(new Blob([blob], { type: mime }));
            setLoaded({ doc, url: blobUrl });
          }
        })
        .catch(() => {
          if (alive)
            setLoaded({ doc, error:
              connected
                ? "This document could not be loaded from your workspace. Check your connection and document access, then reopen it."
                : "This file is no longer available in this browser. Upload it again.",
            });
        });
    return () => {
      alive = false;
      permission.current = false;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [doc, allowed, connected]);
  async function downloadDoc() {
    try {
      if (!allowed || !permission.current) throw new Error("Publication unavailable");
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
        {applicationFill && <section className="panel application-document-action" aria-label="Fill company application">
          <div><h3>Fill application details</h3><p className="form-note">Read this completed application into {companyById(s, doc.companyId).name}’s private form. Check the suggested details, then save. No re-upload needed.</p></div>
          <Button onClick={() => onFillApplication?.(doc)}><FileText size={17} />Fill application from this document</Button>
        </section>}
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
        ) : current?.pdf ? <PdfPreview file={current.pdf} name={doc.name} initialPage={initialPage} /> : url ? (
          doc.mime?.startsWith("image/") ? (
            // Private browser blob URLs must not be sent through an image optimizer.
            // eslint-disable-next-line @next/next/no-img-element
            <img className="image-preview" alt={doc.name} src={url} />
          ) : <Empty title="Download to view this document" text="Use your approved document viewer for this file type." />
        ) : (
          <div className="empty-state">Loading document…</div>
        )}
        {!partner && (
          <div className="document-sharing">
            <span>
              <Shield size={15} />
              {connection ? "Document access" : "Visibility label"}
            </span>
            <Picker
              value={doc.visibility === "Partner" ? "Internal" : doc.visibility}
              label={connection ? "Change document access" : "Change visibility label"}
              options={["Internal", "Restricted"]}
              onChange={async (v) =>
                await update(
                  (d) => {
                    d.documents.find((x) => x.id === doc.id)!.visibility =
                      v as VaultDoc["visibility"];
                  },
                  connection ? "Document access updated" : "Document visibility label updated",
                  doc.name,
                )
              }
            />
            <small>
              Partner sharing requires the separate publication review below.
            </small>
          </div>
        )}
        {!partner && (applicationFill ? <details><summary>Read or copy document text</summary><DocumentTextReview key={`${doc.id}:${doc.version}:${doc.assetId}:text`} doc={doc} /></details> : <DocumentTextReview key={`${doc.id}:${doc.version}:${doc.assetId}:text`} doc={doc} />)}
        {!partner && <PublicationManager key={doc.id} documentId={doc.id} />}
        {!partner && doc.orderId && (
          <DeliveryManager key={`${doc.id}:delivery`} documentId={doc.id} />
        )}
      </DialogContent>
    </Dialog>
  );
}
