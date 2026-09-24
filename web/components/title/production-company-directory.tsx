"use client";

import { useState } from "react";
import { ArrowRight, ChevronRight, Files, Mail, MapPin, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/lib/title/store";
import type { Order, Page } from "@/lib/title/model";
import { CompanyAvatar, Empty, Heading, SearchBox, Segments, Status } from "./shared";
import styles from "./production-company-directory.module.css";

const isOpen = (order: Order) => !["Issued", "Rejected"].includes(order.status);

export function ProductionCompanyDirectory({
  openOrder,
  navigate,
  initialCompanyId = "",
}: {
  openOrder: (id: string) => void;
  navigate: (page: Page) => void;
  initialCompanyId?: string;
}) {
  const { s, connection } = useWorkspace();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(initialCompanyId);
  const [fileFilter, setFileFilter] = useState("Open files");
  const access = connection?.access;
  const assignedIds = access && !access.allCompanies ? new Set(access.companyIds) : null;
  const companies = s.companies.filter(company => !assignedIds || assignedIds.has(company.id));
  const filesByCompany = new Map(companies.map(company => [company.id, [] as Order[]]));
  // Count only files attached to a company this account can see. An orphaned or
  // stale out-of-scope file must not appear in the directory or its totals.
  for (const order of s.orders) filesByCompany.get(order.companyId)?.push(order);
  const search = query.trim().toLowerCase();
  const rows = companies.filter(company =>
    [company.name, company.contact, company.email, company.location, company.jurisdiction].filter(Boolean).join(" ")
      .toLowerCase().includes(search),
  );
  const selected = rows.find(company => company.id === selectedId) || rows[0];
  const files = selected ? filesByCompany.get(selected.id) || [] : [];
  const openFiles = files.filter(isOpen);
  const reviewFiles = files.filter(order => order.status === "Needs review");
  const visibleFiles = fileFilter === "Open files" ? openFiles : files;
  const allOpenFiles = [...filesByCompany.values()].reduce((total, orders) => total + orders.filter(isOpen).length, 0);

  return (
    <div className={styles.directory}>
      <Heading title="Companies" description="Company contacts and the title files you work on.">
        <Button variant="outline" onClick={() => navigate("Orders")}>
          All orders <ArrowRight size={16} />
        </Button>
      </Heading>
      <div className={styles.summary} aria-label="Production company totals">
        <span><strong>{companies.length}</strong> {companies.length === 1 ? "company" : "companies"} available</span>
        <span><strong>{allOpenFiles}</strong> open {allOpenFiles === 1 ? "file" : "files"}</span>
        <p>{assignedIds ? "Showing your assigned companies." : "Showing companies available to your account."} Counts include the title files you can access.</p>
      </div>
      {companies.length === 0 ? (
        <section className={styles.surface}>
          <Empty title="No companies available" text="Your workspace administrator can assign the companies you work with. Their title files will appear here when available." />
        </section>
      ) : (
        <div className={styles.layout}>
          <aside className={`${styles.surface} ${styles.companyPanel}`} aria-label="Production companies">
            <div className={styles.search}>
              <SearchBox value={query} onChange={setQuery} placeholder="Search companies or contacts…" />
            </div>
            <div className={styles.companyList}>
              {rows.map(company => {
                const orders = filesByCompany.get(company.id) || [];
                const openCount = orders.filter(isOpen).length;
                return (
                  <button
                    type="button"
                    key={company.id}
                    className={styles.companyRow}
                    aria-pressed={company.id === selected?.id}
                    onClick={() => setSelectedId(company.id)}
                  >
                    <CompanyAvatar company={company} />
                    <span className={styles.companyCopy}>
                      <strong>{company.name}</strong>
                      <small>{[company.location, company.jurisdiction].filter(Boolean).join(" · ") || "Location not provided"}</small>
                      <span>{openCount} open · {orders.length} total {orders.length === 1 ? "file" : "files"}</span>
                    </span>
                    <ChevronRight size={16} aria-hidden="true" />
                  </button>
                );
              })}
              {rows.length === 0 && <Empty title="No matching companies" text="Search by company name, contact, email or state." action={<Button variant="outline" onClick={() => setQuery("")}>Clear search</Button>} />}
            </div>
          </aside>
          {selected ? (
            <section className={`${styles.surface} ${styles.filePanel}`} aria-label={`${selected.name} title files`}>
              <div className={styles.companyHeader}>
                <CompanyAvatar company={selected} large />
                <div>
                  <p className={styles.eyebrow}>Company directory</p>
                  <h2>{selected.name}</h2>
                  <p className={styles.location}><MapPin size={14} aria-hidden="true" />{[selected.location, selected.jurisdiction].filter(Boolean).join(" · ") || "Location not provided"}</p>
                </div>
              </div>
              {(selected.contact || selected.email) && <dl className={styles.contactDetails}>
                {selected.contact && <div><dt><UserRound size={14} aria-hidden="true" /> Primary contact</dt><dd>{selected.contact}</dd></div>}
                {selected.email && <div><dt><Mail size={14} aria-hidden="true" /> Contact email</dt><dd><a href={`mailto:${selected.email}`}>{selected.email}</a></dd></div>}
              </dl>}
              <dl className={styles.fileCounts} aria-label="Selected company file totals">
                <div><dd>{openFiles.length}</dd><dt>Open files</dt></div>
                <div><dd>{reviewFiles.length}</dd><dt>Needs review</dt></div>
                <div><dd>{files.length}</dd><dt>Total files</dt></div>
              </dl>
              <div className={styles.fileToolbar}>
                <h3>Title files</h3>
                <Segments value={fileFilter} onChange={setFileFilter} items={["Open files", "All files"]} />
              </div>
              <div className={styles.fileList}>
                {visibleFiles.map(order => (
                  <button type="button" className={styles.fileRow} key={order.id} onClick={() => openOrder(order.id)}>
                    <span className={styles.fileIcon}><Files size={19} aria-hidden="true" /></span>
                    <span className={styles.fileCopy}>
                      <strong>{order.address || "Property address not provided"}</strong>
                      <small>{[order.id, order.client, order.jurisdiction].filter(Boolean).join(" · ")}</small>
                    </span>
                    <Status value={order.status} />
                    <ChevronRight size={16} aria-hidden="true" />
                  </button>
                ))}
                {visibleFiles.length === 0 && <Empty
                  title={files.length === 0 ? "No title files yet" : "No open title files"}
                  text={files.length === 0 ? "Title files available to your account for this company will appear here." : "View all files to see issued and rejected orders for this company."}
                  action={files.length > 0 ? <Button variant="outline" onClick={() => setFileFilter("All files")}>View all files</Button> : undefined}
                />}
              </div>
            </section>
          ) : <section className={`${styles.surface} ${styles.noSelection}`}><Empty title="Choose a company" text="Clear or adjust your search to find a company and its title files." /></section>}
        </div>
      )}
    </div>
  );
}
