"use client";
/* eslint-disable @next/next/no-img-element -- Private blob URLs must stay in the authenticated browser, outside a public optimizer. */
import {useEffect,useState} from "react";
import {useWorkspace,getAssetForDocument} from "@/lib/title/store";
import type {Company} from "@/lib/title/model";
export function CompanyLogo({
  company,
  large = false,
}: {
  company: Company;
  large?: boolean;
}) {
  const store = useWorkspace();
  const doc = store?.s.documents.find(d => d.id === company.desk?.logoDocumentId && d.companyId === company.id && !d.orderId && d.category === "Branding" && d.visibility === "Internal");
  const scope = JSON.stringify([store?.connection?.workspaceId, store?.connection?.access, doc?.id, doc?.assetId, doc?.version]);
  const [image, setImage] = useState<{ scope: string; url: string } | null>(null);
  const workspaceId = store?.connection?.workspaceId || "", userId = store?.connection?.access.userId;
  useEffect(() => {
    if (!doc?.assetId) return;
    let cancelled = false, url = "";
    void getAssetForDocument(doc, { expectedWorkspaceId: workspaceId, expectedUserId: userId }).then(blob => {
      if (cancelled || !["image/png", "image/jpeg"].includes(blob.type)) return;
      url = URL.createObjectURL(blob); setImage({ scope, url });
    }).catch(() => {});
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [scope, doc, workspaceId, userId]);
  return (
    <span className={`company-avatar ${company.color} ${large ? "large" : ""}`}>
      {image?.scope === scope && doc ? <img src={image.url} alt={`${company.name} logo`} style={{ width: "100%", height: "100%", objectFit: "contain", borderRadius: "inherit" }} /> : company.initials}
    </span>
  );
}
