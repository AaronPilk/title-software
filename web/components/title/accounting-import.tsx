"use client";
import { useRef, useState } from "react";
import { Upload, FileSpreadsheet, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TableRow, TableCell } from "@/components/ui/table";
import { useWorkspace } from "@/lib/title/store";
import { importTargetFields, type ImportTargetField } from "@/lib/title/model";
import { previewCsv, type CsvPreview } from "@/lib/title/csv";
import { saveImportTemplate, deleteImportTemplate } from "@/lib/title/business";
import { canConfirmWorkspaceFinance } from "@/lib/title/workspace-capabilities";
import { Picker, FieldLabel, Empty, DataTable } from "./shared";

/**
 * A first guess at a column's target field from its header text, so a
 * freshly-uploaded file with no matching saved template isn't presented
 * with every column defaulted to "Ignore". Purely a starting point — every
 * column stays a normal, immediately-editable Picker either way.
 */
function guessTarget(header: string): ImportTargetField {
  const h = header.toLowerCase();
  if (/date/.test(h)) return "Date";
  if (/amount|amt|debit|credit|total/.test(h)) return "Amount";
  if (/desc|memo|payee|narrative/.test(h)) return "Description";
  if (/categor|type|class/.test(h)) return "Category";
  return "Ignore";
}

/**
 * Local-only "upload -> preview -> map columns" scaffold for the accounting
 * CSV import gap (J06-J07). Deliberately stops at preview and reusable
 * column mapping: it never posts anything to a close, ledger or remittance
 * record, since the actual reconciliation rules depend on John's real books
 * and a confirmed accounting vendor/export format — both still open per
 * docs/implementation-coverage.md.
 */
export function AccountingImport() {
  const { s, update, connection } = useWorkspace();
  const canManageTemplates = canConfirmWorkspaceFinance(connection);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [map, setMap] = useState<Record<string, ImportTargetField>>({});
  const [templateName, setTemplateName] = useState("");
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const readId = useRef(0);
  const templates = s.importTemplates || [];
  function savedTarget(
    columnMap: Record<string, ImportTargetField>,
    header: string,
  ): ImportTargetField {
    return Object.hasOwn(columnMap, header) &&
      importTargetFields.includes(columnMap[header])
      ? columnMap[header]
      : "Ignore";
  }

  function applyTemplate(columnMap: Record<string, ImportTargetField>) {
    if (!preview) return;
    setMap(
      Object.fromEntries(
        preview.headers.map((h) => [h, savedTarget(columnMap, h)]),
      ) as Record<string, ImportTargetField>,
    );
  }

  async function onFile(file: File) {
    const request = ++readId.current;
    setFileName(file.name);
    setPreview(null);
    setMap({});
    setError("");
    setReading(true);
    setTemplateName("");
    try {
      if (file.size > 10 * 1024 * 1024)
        throw new Error("Choose a CSV file up to 10 MB.");
      const p = previewCsv(await file.text(), 15);
      if (request !== readId.current) return;
      setPreview(p);
      const matching = templates.find(
        (t) =>
          p.headers.length > 0 &&
          p.headers.every((h) => Object.hasOwn(t.columnMap, h)),
      );
      setMap(
        Object.fromEntries(
          p.headers.map((h) => [
            h,
            matching ? savedTarget(matching.columnMap, h) : guessTarget(h),
          ]),
        ) as Record<string, ImportTargetField>,
      );
    } catch (cause) {
      if (request === readId.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "This file could not be read. Choose it again.",
        );
    } finally {
      if (request === readId.current) setReading(false);
    }
  }

  return (
    <>
      <div className="notice">
        <FileSpreadsheet size={18} />
        <p>
          Preview and column mapping only — nothing here posts to a close,
          ledger or remittance. Confirm the actual accounting vendor, export
          format and reconciliation rules with John before relying on these
          numbers.
        </p>
      </div>
      <section className="panel">
        <div className="import-upload-row">
          <label className="file-drop">
            <Upload size={16} />
            <span>{fileName || "Choose a CSV file to preview"}</span>
            <input
              type="file"
              accept=".csv,text/csv"
              aria-label="Choose a CSV file to preview"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onFile(file);
                e.target.value = "";
              }}
            />
          </label>
          {preview && !!templates.length && (
            <div className="template-chip-row">
              {templates.map((t) => (
                <Button
                  key={t.id}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => applyTemplate(t.columnMap)}
                >
                  Load &quot;{t.name}&quot;
                </Button>
              ))}
            </div>
          )}
        </div>
        {error && (
          <div className="notice warning" role="alert">
            <p>{error}</p>
          </div>
        )}
        {reading && (
          <p role="status" className="inline-note">
            Reading CSV…
          </p>
        )}
        {!preview && !error && !reading && (
          <Empty
            title="No file previewed yet"
            text="Choose a CSV export from your bank or accounting software to preview its columns."
          />
        )}
        {preview && (
          <>
            <p className="inline-note" style={{ padding: "0 17px" }}>
              {preview.headers.length} column
              {preview.headers.length === 1 ? "" : "s"} detected ·{" "}
              {preview.totalDataRows} data row
              {preview.totalDataRows === 1 ? "" : "s"} found
              {preview.totalDataRows > preview.rows.length
                ? ` (showing the first ${preview.rows.length})`
                : ""}
              .
            </p>
            <div className="import-column-map">
              {preview.headers.map((h) => (
                <FieldLabel label={h} key={h}>
                  <Picker
                    value={map[h] || "Ignore"}
                    label={`Map column ${h}`}
                    onChange={(v) =>
                      setMap((prev) => ({
                        ...prev,
                        [h]: v as ImportTargetField,
                      }))
                    }
                    options={[...importTargetFields]}
                  />
                </FieldLabel>
              ))}
            </div>
            <DataTable
              headers={preview.headers.map(
                (h) => `${h} → ${map[h] || "Ignore"}`,
              )}
            >
              {preview.rows.map((row, i) => (
                <TableRow key={i}>
                  {row.map((cell, j) => (
                    <TableCell
                      key={j}
                      className={
                        map[preview.headers[j]] === "Ignore" ? "muted-cell" : ""
                      }
                    >
                      {cell}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </DataTable>
            <div className="inline-form" style={{ padding: "0 17px 17px" }}>
              <FieldLabel label="Save this mapping as">
                <Input
                  aria-label="Mapping template name"
                  disabled={!canManageTemplates}
                  placeholder="e.g. Chase checking export"
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                />
              </FieldLabel>
              <Button
                variant="outline"
                disabled={!canManageTemplates || !templateName.trim()}
                onClick={async () => {
                  if (
                    await update((d) =>
                      saveImportTemplate(d, templateName, map),
                    )
                  )
                    setTemplateName("");
                }}
              >
                Save mapping
              </Button>
            </div>
            {!canManageTemplates && <p className="inline-note">An organization-wide finance account manages shared column mappings. You can still preview and map this file.</p>}
          </>
        )}
      </section>
      {!!templates.length && (
        <section className="panel">
          {templates.map((t) => (
            <div className="template-row" key={t.id}>
              <div>
                <strong>{t.name}</strong>
                <small>
                  {Object.entries(t.columnMap)
                    .filter(([, v]) => v !== "Ignore")
                    .map(([k, v]) => `${k} → ${v}`)
                    .join(" · ") || "No columns mapped"}
                </small>
              </div>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Delete mapping ${t.name}`}
                disabled={!canManageTemplates}
                onClick={async () =>
                  await update(
                    (d) => deleteImportTemplate(d, t.id),
                    "Import mapping deleted",
                    t.name,
                  )
                }
              >
                <Trash2 size={14} />
              </Button>
            </div>
          ))}
        </section>
      )}
    </>
  );
}
