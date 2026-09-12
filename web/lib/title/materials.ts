import { traceMutation, commandUuid } from "./command-log";
import type { Workspace, VaultDoc } from "./model";
import { sameDocumentFamily } from "./production";

export const materialKinds = [
  "Logo",
  "Affiliated-business disclosure",
  "Title preference form",
  "Business card",
  "Company agreement",
  "Other material",
] as const;
export type MaterialKind = (typeof materialKinds)[number];
export type MaterialEvent = {
  at: string;
  actor: string;
  action: string;
  note: string;
  approval?: {
    revision: number;
    documentId: string;
    documentName: string;
    documentVersion: number;
    documentIdentity: string;
    materialSnapshot: string;
  };
};
export type CompanyMaterial = {
  id: string;
  companyId: string;
  kind: MaterialKind;
  title: string;
  owner: string;
  brief: string;
  status:
    "Requested" | "In progress" | "Awaiting review" | "Approved" | "Not needed";
  documentId: string;
  revision: number;
  reviewNote: string;
  reviewedBy: string;
  reviewedAt: string;
  reviewSnapshot: string;
  history: MaterialEvent[];
};
export type DocumentPublication = {
  id: string;
  companyId: string;
  documentId: string;
  documentName: string;
  documentVersion: number;
  materialId: string;
  title: string;
  audience: "All company partners" | "Selected members";
  memberNames: string[];
  status: "Draft" | "Reviewed" | "Published" | "Withdrawn" | "Superseded";
  reviewNote: string;
  reviewedBy: string;
  reviewedAt: string;
  reviewSnapshot: string;
  publishedAt: string;
  publishedBy: string;
  supersededBy: string;
  history: MaterialEvent[];
};
export type MaterialsState = {
  version: 1;
  items: CompanyMaterial[];
  publications: DocumentPublication[];
};
const empty = (): MaterialsState => ({
  version: 1,
  items: [],
  publications: [],
});
export const materials = (s: Workspace) => s.materials || empty();
export function enrichMaterials(s: Workspace) {
  s.materials ??= empty();
  for (const d of s.documents)
    if (d.category === "Applications" || d.visibility === "Restricted")
      d.publicationBlocked = true;
  return s;
}
const ensure = (s: Workspace) => enrichMaterials(s).materials!;
const now = () => new Date().toISOString();
const event = (s: Workspace, action: string, note: string): MaterialEvent => ({
  at: now(),
  actor: s.user,
  action,
  note,
});
const id = (prefix: string) => `${prefix}-${commandUuid()}`;
function company(s: Workspace, companyId: string) {
  const c = s.companies.find((c) => c.id === companyId);
  if (!c) throw new Error("Choose an existing company.");
  return c;
}
export function documentIdentity(d: VaultDoc) {
  return JSON.stringify([
    d.id,
    d.companyId,
    d.orderId,
    d.name,
    d.version,
    d.assetId,
    d.mime,
    d.text,
    d.sourceRole,
    d.policyId,
    d.cplId,
    d.correctionId,
  ]);
}
export function latestDocument(s: Workspace, d: VaultDoc) {
  return !s.documents.some(
    (n) => sameDocumentFamily(d, n) && n.version > d.version,
  );
}
export function publicationEligible(d: VaultDoc) {
  return (
    !d.publicationBlocked &&
    d.visibility !== "Restricted" &&
    d.category !== "Applications"
  );
}
function materialDoc(s: Workspace, item: CompanyMaterial) {
  return s.documents.find(
    (d) =>
      d.id === item.documentId &&
      d.companyId === item.companyId &&
      !d.orderId &&
      d.category !== "Applications",
  );
}
function materialSnapshot(s: Workspace, item: CompanyMaterial) {
  const d = materialDoc(s, item);
  return JSON.stringify([
    item.companyId,
    item.kind,
    item.title,
    item.owner,
    item.brief,
    item.revision,
    d ? documentIdentity(d) : null,
  ]);
}
export function materialCurrent(s: Workspace, item: CompanyMaterial) {
  const d = materialDoc(s, item);
  return (
    item.status === "Approved" &&
    !!d &&
    latestDocument(s, d) &&
    item.reviewSnapshot === materialSnapshot(s, item)
  );
}
export function createMaterial(
  s: Workspace,
  input: Pick<
    CompanyMaterial,
    "companyId" | "kind" | "title" | "owner" | "brief"
  >,
) {
  return traceMutation(s, "createMaterial", [input], () => {
    company(s, input.companyId);
    if (
      !materialKinds.includes(input.kind) ||
      !input.title.trim() ||
      !input.owner.trim() ||
      !input.brief.trim()
    )
      throw new Error(
        "Enter the material, responsible person and requested content.",
      );
    const state = ensure(s);
    if (
      state.items.some(
        (i) =>
          i.companyId === input.companyId &&
          i.title.toLowerCase() === input.title.trim().toLowerCase(),
      )
    )
      throw new Error("This company already has a material with that title.");
    const item: CompanyMaterial = {
      ...input,
      title: input.title.trim(),
      owner: input.owner.trim(),
      brief: input.brief.trim(),
      id: id("material"),
      status: "Requested",
      documentId: "",
      revision: 1,
      reviewNote: "",
      reviewedBy: "",
      reviewedAt: "",
      reviewSnapshot: "",
      history: [event(s, "Requested", input.brief.trim())],
    };
    state.items.unshift(item);
    s.tasks.unshift({
      id: `task-${item.id}`,
      companyId: item.companyId,
      title: `Prepare ${item.title}`,
      owner: item.owner,
      due: now().slice(0, 10),
      done: false,
      priority: "Normal",
    });
    return item.id;
  });
}
export function setupMaterials(s: Workspace, companyId: string) {
  return traceMutation(s, "setupMaterials", [companyId], () => {
    company(s, companyId);
    let added = 0;
    const presets: [MaterialKind, string][] = [
      [
        "Logo",
        "Record the company name, business type, colors and approved logo format.",
      ],
      [
        "Affiliated-business disclosure",
        "Prepare the company disclosure template for professional review. Transaction delivery is recorded separately.",
      ],
      [
        "Title preference form",
        "Prepare the company-specific title preference form and confirm its wording.",
      ],
      [
        "Business card",
        "Confirm the company contact details and branding for the business card.",
      ],
    ];
    for (const [kind, brief] of presets)
      if (
        !materials(s).items.some(
          (i) => i.companyId === companyId && i.kind === kind,
        )
      ) {
        createMaterial(s, {
          companyId,
          kind,
          title: kind,
          brief,
          owner: "Stephenie",
        });
        added++;
      }
    return added;
  });
}
export function updateMaterial(
  s: Workspace,
  itemId: string,
  input: Pick<
    CompanyMaterial,
    "title" | "owner" | "brief" | "documentId" | "status"
  > & { note: string; revision: number },
) {
  return traceMutation(s, "updateMaterial", [itemId, input], () => {
    const item = ensure(s).items.find((i) => i.id === itemId);
    if (!item || item.revision !== input.revision)
      throw new Error("This material changed. Reload its current revision.");
    if (
      !input.title.trim() ||
      !input.owner.trim() ||
      !input.brief.trim() ||
      !["Requested", "In progress", "Awaiting review", "Not needed"].includes(
        input.status,
      )
    )
      throw new Error(
        "Complete the material details and choose a preparation status.",
      );
    if (
      input.documentId &&
      !s.documents.some(
        (d) =>
          d.id === input.documentId &&
          d.companyId === item.companyId &&
          !d.orderId &&
          d.category !== "Applications" &&
          latestDocument(s, d),
      )
    )
      throw new Error(
        "Choose a current company document; applications and transaction files cannot be company materials.",
      );
    if (input.status === "Awaiting review" && !input.documentId)
      throw new Error("Attach the material document before requesting review.");
    if (input.status === "Not needed" && !input.note.trim())
      throw new Error("Record why this material is not needed.");
    if (
      materials(s).items.some(
        (i) =>
          i.id !== item.id &&
          i.companyId === item.companyId &&
          i.title.toLowerCase() === input.title.trim().toLowerCase(),
      )
    )
      throw new Error("This company already has a material with that title.");
    Object.assign(item, {
      title: input.title.trim(),
      owner: input.owner.trim(),
      brief: input.brief.trim(),
      documentId: input.documentId,
      status: input.status,
      revision: item.revision + 1,
      reviewSnapshot: "",
      reviewNote: "",
      reviewedAt: "",
      reviewedBy: "",
    });
    item.history.push(
      event(
        s,
        input.status,
        input.note.trim() ||
          "Working details updated; approval requires a new review.",
      ),
    );
    const task = s.tasks.find((t) => t.id === `task-${item.id}`);
    if (task) {
      task.owner = item.owner;
      task.done = item.status === "Not needed";
    }
  });
}
export function approveMaterial(
  s: Workspace,
  itemId: string,
  revision: number,
  note: string,
) {
  return traceMutation(s, "approveMaterial", [itemId, revision, note], () => {
    const item = ensure(s).items.find((i) => i.id === itemId);
    if (
      !item ||
      item.revision !== revision ||
      item.status !== "Awaiting review" ||
      !note.trim()
    )
      throw new Error("Save the material for review and record a review note.");
    const d = materialDoc(s, item);
    if (!d || !latestDocument(s, d))
      throw new Error("Choose the current company document before approval.");
    Object.assign(item, {
      status: "Approved",
      reviewNote: note.trim(),
      reviewedBy: s.user,
      reviewedAt: now(),
      reviewSnapshot: materialSnapshot(s, item),
    });
    item.history.push({
      ...event(s, "Approved", note.trim()),
      approval: {
        revision: item.revision,
        documentId: d.id,
        documentName: d.name,
        documentVersion: d.version,
        documentIdentity: documentIdentity(d),
        materialSnapshot: item.reviewSnapshot,
      },
    });
    const task = s.tasks.find((t) => t.id === `task-${item.id}`);
    if (task) task.done = true;
  });
}
function releaseDoc(s: Workspace, p: DocumentPublication) {
  return s.documents.find(
    (d) => d.id === p.documentId && d.companyId === p.companyId,
  );
}
function releaseSnapshot(s: Workspace, p: DocumentPublication) {
  const d = releaseDoc(s, p),
    item = materials(s).items.find((i) => i.id === p.materialId);
  return JSON.stringify([
    p.companyId,
    p.title,
    p.audience,
    p.memberNames,
    p.documentId,
    p.documentName,
    p.documentVersion,
    d ? documentIdentity(d) : null,
    p.materialId,
    item?.reviewSnapshot,
  ]);
}
function audienceValid(s: Workspace, p: DocumentPublication) {
  const c = company(s, p.companyId);
  return p.audience === "All company partners"
    ? p.memberNames.length === 0
    : p.audience === "Selected members" &&
        p.memberNames.length > 0 &&
        new Set(p.memberNames).size === p.memberNames.length &&
        p.memberNames.every((name) => c.members.some((m) => m.name === name));
}
export function createPublication(
  s: Workspace,
  input: Pick<
    DocumentPublication,
    "documentId" | "materialId" | "title" | "audience" | "memberNames"
  >,
) {
  return traceMutation(s, "createPublication", [input], () => {
    const d = s.documents.find((d) => d.id === input.documentId);
    if (!d || !latestDocument(s, d) || !publicationEligible(d))
      throw new Error(
        "Choose a current, unrestricted document. Applications cannot be published.",
      );
    company(s, d.companyId);
    const item = materials(s).items.find((i) => i.id === input.materialId);
    if (
      input.materialId &&
      (!item ||
        item.companyId !== d.companyId ||
        item.documentId !== d.id ||
        !materialCurrent(s, item))
    )
      throw new Error(
        "Approve this company's current material before preparing its publication.",
      );
    if (!input.title.trim())
      throw new Error("Enter the title partners should see.");
    if (
      materials(s).publications.some(
        (p) =>
          ["Draft", "Reviewed"].includes(p.status) &&
          (p.documentId === d.id ||
            (input.materialId && p.materialId === input.materialId)),
      )
    )
      throw new Error(
        "Finish or withdraw the existing publication draft first.",
      );
    const p: DocumentPublication = {
      ...input,
      memberNames: [...new Set(input.memberNames)].sort(),
      title: input.title.trim(),
      companyId: d.companyId,
      id: id("publication"),
      documentName: d.name,
      documentVersion: d.version,
      status: "Draft",
      reviewNote: "",
      reviewedBy: "",
      reviewedAt: "",
      reviewSnapshot: "",
      publishedAt: "",
      publishedBy: "",
      supersededBy: "",
      history: [
        event(
          s,
          "Draft",
          "Prepared a document version and audience for review.",
        ),
      ],
    };
    if (!audienceValid(s, p))
      throw new Error("Select audience members from this company.");
    ensure(s).publications.unshift(p);
    return p.id;
  });
}
export function publicationReady(s: Workspace, p: DocumentPublication) {
  const d = releaseDoc(s, p),
    item = materials(s).items.find((i) => i.id === p.materialId);
  return (
    !!d &&
    latestDocument(s, d) &&
    publicationEligible(d) &&
    audienceValid(s, p) &&
    (!p.materialId ||
      (!!item && item.documentId === d.id && materialCurrent(s, item))) &&
    (p.status === "Draft" || p.reviewSnapshot === releaseSnapshot(s, p))
  );
}
export function reviewPublication(
  s: Workspace,
  publicationId: string,
  note: string,
) {
  return traceMutation(s, "reviewPublication", [publicationId, note], () => {
    const p = ensure(s).publications.find((p) => p.id === publicationId);
    if (!p || p.status !== "Draft" || !note.trim() || !publicationReady(s, p))
      throw new Error(
        "Review the current document and audience, then record a review note.",
      );
    Object.assign(p, {
      status: "Reviewed",
      reviewNote: note.trim(),
      reviewedBy: s.user,
      reviewedAt: now(),
      reviewSnapshot: releaseSnapshot(s, p),
    });
    p.history.push(event(s, "Reviewed", note.trim()));
  });
}
export function replacementPublications(s: Workspace, p: DocumentPublication) {
  const d = releaseDoc(s, p);
  return materials(s).publications.filter(
    (x) =>
      x.id !== p.id &&
      x.status === "Published" &&
      x.companyId === p.companyId &&
      ((p.materialId && x.materialId === p.materialId) ||
        (d && releaseDoc(s, x) && sameDocumentFamily(d, releaseDoc(s, x)!))),
  );
}
export function publishDocument(
  s: Workspace,
  publicationId: string,
  expectedReplacementIds: string[] = [],
) {
  return traceMutation(
    s,
    "publishDocument",
    [publicationId, expectedReplacementIds],
    () => {
      const p = ensure(s).publications.find((p) => p.id === publicationId);
      if (!p || p.status !== "Reviewed" || !publicationReady(s, p))
        throw new Error(
          "Review a current document and audience before publication.",
        );
      const prior = replacementPublications(s, p);
      if (
        JSON.stringify(prior.map((x) => x.id).sort()) !==
        JSON.stringify([...expectedReplacementIds].sort())
      )
        throw new Error(
          "Published versions changed. Review and explicitly confirm the replacement list.",
        );
      for (const x of prior) {
        x.status = "Superseded";
        x.supersededBy = p.id;
        x.history.push(event(s, "Superseded", `Replaced by ${p.id}.`));
      }
      Object.assign(p, {
        status: "Published",
        publishedAt: now(),
        publishedBy: s.user,
      });
      p.history.push(
        event(
          s,
          "Published",
          prior.length
            ? "Replaced the explicitly selected prior publication."
            : "Published this reviewed version and audience.",
        ),
      );
    },
  );
}
export function withdrawPublication(
  s: Workspace,
  publicationId: string,
  reason: string,
) {
  return traceMutation(
    s,
    "withdrawPublication",
    [publicationId, reason],
    () => {
      const p = ensure(s).publications.find((p) => p.id === publicationId);
      if (
        !p ||
        !["Draft", "Reviewed", "Published"].includes(p.status) ||
        !reason.trim()
      )
        throw new Error(
          "Choose an active publication and record a withdrawal reason.",
        );
      p.status = "Withdrawn";
      p.history.push(event(s, "Withdrawn", reason.trim()));
    },
  );
}
export function partnerPublications(
  s: Workspace,
  companyId: string,
  memberName = "",
) {
  const c = company(s, companyId);
  if (memberName && !c.members.some((m) => m.name === memberName)) return [];
  return materials(s).publications.filter((p) => {
    const d = releaseDoc(s, p);
    // Published v1 remains available when an internal v2 is uploaded. Publication selects a version, never the latest filename.
    return (
      p.companyId === companyId &&
      p.status === "Published" &&
      !!d &&
      publicationEligible(d) &&
      (p.audience === "All company partners" ||
        (!!memberName && p.memberNames.includes(memberName)))
    );
  });
}
export function validateMaterialsMutation(before: Workspace, after: Workspace) {
  for (const d of after.documents) {
    if (
      before.documents.find((x) => x.id === d.id)?.publicationBlocked &&
      !d.publicationBlocked
    )
      throw new Error(
        "Keep the restriction on this source document. Use a separately reviewed redacted copy for sharing.",
      );
    if (d.category === "Applications" || d.visibility === "Restricted")
      d.publicationBlocked = true;
  }
  for (const old of materials(before).publications) {
    const p = materials(after).publications.find((p) => p.id === old.id);
    if (!p)
      throw new Error(
        "Keep publication history; withdraw a release instead of deleting it.",
      );
    if (old.reviewedAt) {
      const immutable = (x: DocumentPublication) => [
        x.id,
        x.companyId,
        x.documentId,
        x.documentName,
        x.documentVersion,
        x.materialId,
        x.title,
        x.audience,
        x.memberNames,
        x.reviewNote,
        x.reviewedBy,
        x.reviewedAt,
        x.reviewSnapshot,
      ];
      if (JSON.stringify(immutable(old)) !== JSON.stringify(immutable(p)))
        throw new Error(
          "Reviewed publication evidence is immutable. Withdraw and prepare a new release.",
        );
      const oldDoc = releaseDoc(before, old),
        newDoc = releaseDoc(after, p);
      if (
        !oldDoc ||
        !newDoc ||
        documentIdentity(oldDoc) !== documentIdentity(newDoc)
      )
        throw new Error(
          "Preserve documents referenced by reviewed publications. Upload a new version.",
        );
    }
    if (
      JSON.stringify(p.history.slice(0, old.history.length)) !==
      JSON.stringify(old.history)
    )
      throw new Error("Preserve publication history.");
    if (
      ["Withdrawn", "Superseded"].includes(old.status) &&
      p.status !== old.status
    )
      throw new Error(
        "A closed publication cannot be reactivated. Prepare a new release.",
      );
    if (
      old.publishedAt &&
      (p.publishedAt !== old.publishedAt || p.publishedBy !== old.publishedBy)
    )
      throw new Error("Preserve the original publication event.");
  }
  for (const p of materials(after).publications) {
    const d = releaseDoc(after, p);
    if (
      ["Reviewed", "Published"].includes(p.status) &&
      d &&
      !publicationEligible(d)
    ) {
      p.status = "Withdrawn";
      p.history.push(
        event(
          after,
          "Withdrawn",
          "Document was restricted or classified as an application.",
        ),
      );
    }
    if (p.status === "Published" && !p.publishedAt)
      throw new Error("Publish only through the reviewed release workflow.");
  }
  for (const old of materials(before).items) {
    const item = materials(after).items.find((i) => i.id === old.id);
    if (
      !item ||
      item.companyId !== old.companyId ||
      JSON.stringify(item.history.slice(0, old.history.length)) !==
        JSON.stringify(old.history)
    )
      throw new Error("Preserve the company material and its history.");
    for (const e of old.history) {
      if (!e.approval) continue;
      const d = after.documents.find((d) => d.id === e.approval!.documentId);
      if (!d || documentIdentity(d) !== e.approval.documentIdentity)
        throw new Error(
          "Preserve the document behind each material approval. Upload a new version.",
        );
    }
    if (
      materialCurrent(before, old) &&
      item.status === "Approved" &&
      !materialCurrent(after, item)
    ) {
      const task = after.tasks.find((t) => t.id === `task-${item.id}`);
      if (task) task.done = false;
      item.history.push(
        event(
          after,
          "New review needed",
          "The approved source has a newer version or changed classification. Review the current material before publishing it.",
        ),
      );
    }
  }
}
