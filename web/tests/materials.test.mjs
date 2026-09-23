import test from "node:test";
import assert from "node:assert/strict";
import { createSeed } from "../.local-test/model.js";
import {
  enrichBusiness,
  validateBusinessMutation,
} from "../.local-test/business.js";
import {
  materials,
  setupMaterials,
  createMaterial,
  updateMaterial,
  approveMaterial,
  materialCurrent,
  createPublication,
  reviewPublication,
  publishDocument,
  withdrawPublication,
  partnerPublications,
  replacementPublications,
  publicationReady,
} from "../.local-test/materials.js";

function fixture() {
  const s = createSeed();
  const d = s.documents.find(
    (d) => d.companyId === "c1" && d.name === "Company overview.txt",
  );
  return { s, d };
}
function release(s, d, extra = {}) {
  const id = createPublication(s, {
    documentId: d.id,
    materialId: "",
    title: "Company overview",
    audience: "All company partners",
    memberNames: [],
    ...extra,
  });
  reviewPublication(s, id, "Version and audience reviewed");
  return materials(s).publications.find((p) => p.id === id);
}
function replacement(s, d) {
  const next = {
    ...d,
    id: crypto.randomUUID(),
    version: d.version + 1,
    visibility: "Internal",
    text: "New unpublished draft content",
  };
  s.documents.push(next);
  return next;
}
function approvedMaterial(s, d) {
  const id = createMaterial(s, {
    companyId: d.companyId,
    kind: "Logo",
    title: "Company logo",
    owner: "Stephenie",
    brief: "Blue company logo with reviewed name",
  });
  updateMaterial(s, id, {
    title: "Company logo",
    owner: "Stephenie",
    brief: "Blue company logo with reviewed name",
    documentId: d.id,
    status: "Awaiting review",
    note: "Attached source",
    revision: 1,
  });
  approveMaterial(s, id, 2, "Company and branding checked");
  return materials(s).items.find((i) => i.id === id);
}

test("materials migration preserves files and legacy Partner labels without inventing publication", () => {
  const { s, d } = fixture();
  const before = structuredClone(s.documents);
  enrichBusiness(s);
  enrichBusiness(s);
  assert.equal(d.visibility, "Partner");
  assert.equal(materials(s).publications.length, 0);
  assert.deepEqual(s.documents, before);
  assert.deepEqual(partnerPublications(s, "c1"), []);
});
test("standard company materials and assigned tasks are idempotent and scoped", () => {
  const { s } = fixture();
  const tasks = s.tasks.length;
  assert.equal(setupMaterials(s, "c1"), 4);
  assert.equal(setupMaterials(s, "c1"), 0);
  assert.equal(s.tasks.length, tasks + 4);
  assert.equal(materials(s).items.length, 4);
  assert.ok(materials(s).items.every((i) => i.companyId === "c1"));
  assert.ok(!materials(s).items.some((i) => i.status === "Approved"));
});
test("material approval requires company evidence and recorded review", () => {
  const { s, d } = fixture();
  const item = approvedMaterial(s, d);
  assert.equal(materialCurrent(s, item), true);
  assert.equal(s.tasks.find((t) => t.id === `task-${item.id}`).done, true);
  const foreign = s.documents.find((d) => d.companyId === "c2");
  assert.throws(
    () =>
      updateMaterial(s, item.id, {
        ...item,
        status: "Awaiting review",
        documentId: foreign.id,
        note: "Wrong company",
        revision: item.revision,
      }),
    /current company/,
  );
  assert.equal(item.status, "Approved");
});
test("new file version invalidates current material approval but preserves review history", () => {
  const { s, d } = fixture();
  const item = approvedMaterial(s, d);
  const history = structuredClone(item.history);
  replacement(s, d);
  assert.equal(materialCurrent(s, item), false);
  assert.deepEqual(item.history, history);
  assert.throws(
    () =>
      createPublication(s, {
        documentId: d.id,
        materialId: item.id,
        title: "Logo",
        audience: "All company partners",
        memberNames: [],
      }),
    /current/,
  );
});
test("stale material edits cannot overwrite newer preparation", () => {
  const { s, d } = fixture();
  const item = approvedMaterial(s, d);
  assert.throws(
    () =>
      updateMaterial(s, item.id, {
        ...item,
        status: "In progress",
        revision: item.revision - 1,
        note: "Stale",
      }),
    /changed/,
  );
});
test("material revisions retain exact approval evidence and protect its source", () => {
  const { s, d } = fixture();
  const item = approvedMaterial(s, d);
  const evidence = structuredClone(item.history.find((e) => e.approval));
  assert.equal(evidence.approval.documentId, d.id);
  assert.equal(evidence.approval.documentVersion, d.version);
  assert.equal(evidence.approval.revision, 2);
  assert.equal(evidence.approval.materialSnapshot, item.reviewSnapshot);
  const before = structuredClone(s);
  const next = replacement(s, d);
  validateBusinessMutation(before, s);
  assert.equal(s.tasks.find((t) => t.id === `task-${item.id}`).done, false);
  updateMaterial(s, item.id, {
    ...item,
    brief: "New approved name requested",
    documentId: next.id,
    status: "Awaiting review",
    note: "New content",
  });
  assert.deepEqual(
    item.history.find((e) => e.approval),
    evidence,
  );
  assert.equal(item.reviewSnapshot, "");
  const baseline = structuredClone(s);
  d.text = "Edited old approved content";
  assert.throws(
    () => validateBusinessMutation(baseline, s),
    /document behind each material approval/,
  );
});
test("replacing a selected audience requires confirmation and removes previous member access", () => {
  const { s, d } = fixture();
  s.companies.find((c) => c.id === "c1").members = [
    { name: "Alice", role: "Partner", ownership: 50 },
    { name: "Bob", role: "Partner", ownership: 50 },
  ];
  const p1 = release(s, d, {
    audience: "Selected members",
    memberNames: ["Alice"],
  });
  publishDocument(s, p1.id);
  const p2 = release(s, d, {
    audience: "Selected members",
    memberNames: ["Bob"],
  });
  assert.throws(() => publishDocument(s, p2.id), /explicitly confirm/);
  assert.equal(partnerPublications(s, "c1", "Alice").length, 1);
  publishDocument(s, p2.id, [p1.id]);
  assert.equal(partnerPublications(s, "c1", "Alice").length, 0);
  assert.equal(partnerPublications(s, "c1", "Bob")[0].id, p2.id);
});
test("private replacement leaves the published version available until explicit replacement", () => {
  const { s, d } = fixture();
  const p = release(s, d);
  publishDocument(s, p.id);
  const next = replacement(s, d);
  assert.deepEqual(
    partnerPublications(s, "c1").map((p) => p.documentId),
    [d.id],
  );
  const v2 = release(s, next);
  assert.throws(() => publishDocument(s, v2.id), /explicitly confirm/);
  assert.deepEqual(
    replacementPublications(s, v2).map((p) => p.id),
    [p.id],
  );
  publishDocument(s, v2.id, [p.id]);
  assert.equal(p.status, "Superseded");
  assert.equal(p.supersededBy, v2.id);
  assert.deepEqual(
    partnerPublications(s, "c1").map((p) => p.documentId),
    [next.id],
  );
});
test("withdrawal retains history and never falls back to an older release", () => {
  const { s, d } = fixture();
  const p1 = release(s, d);
  publishDocument(s, p1.id);
  const p2 = release(s, replacement(s, d));
  publishDocument(s, p2.id, [p1.id]);
  assert.throws(() => withdrawPublication(s, p2.id, ""), /reason/);
  withdrawPublication(s, p2.id, "Company requested removal");
  assert.equal(p1.status, "Superseded");
  assert.equal(p2.status, "Withdrawn");
  assert.equal(partnerPublications(s, "c1").length, 0);
  assert.equal(materials(s).publications.length, 2);
});
test("reviewed publication becomes stale when a newer draft upload arrives before publication", () => {
  const { s, d } = fixture();
  const p = release(s, d);
  replacement(s, d);
  assert.equal(publicationReady(s, p), false);
  assert.throws(() => publishDocument(s, p.id), /current/);
  assert.equal(p.status, "Reviewed");
});
test("applications and restricted records cannot be published by relabeling them", () => {
  const { s } = fixture();
  const app = s.documents.find((d) => d.category === "Applications");
  assert.equal(app.publicationBlocked, true);
  app.visibility = "Internal";
  app.category = "Branding";
  assert.throws(() => release(s, app), /unrestricted/);
  const after = structuredClone(s);
  after.documents.find((d) => d.id === app.id).publicationBlocked = false;
  assert.throws(
    () => validateBusinessMutation(s, after),
    /Keep the restriction/,
  );
});
test("restricting a published document withdraws it and blocks access", () => {
  const { s, d } = fixture();
  const p = release(s, d);
  publishDocument(s, p.id);
  const before = structuredClone(s);
  d.visibility = "Restricted";
  validateBusinessMutation(before, s);
  assert.equal(p.status, "Withdrawn");
  assert.equal(d.publicationBlocked, true);
  assert.deepEqual(partnerPublications(s, "c1"), []);
  assert.ok(p.history.at(-1).note.includes("restricted"));
});
test("selected-member publication never appears for another company or unspecified viewer", () => {
  const { s, d } = fixture();
  const member = s.companies.find((c) => c.id === "c1").members[0].name;
  const p = release(s, d, {
    audience: "Selected members",
    memberNames: [member],
  });
  publishDocument(s, p.id);
  assert.deepEqual(partnerPublications(s, "c1"), []);
  assert.deepEqual(partnerPublications(s, "c2", member), []);
  assert.deepEqual(
    partnerPublications(s, "c1", member).map((p) => p.id),
    [p.id],
  );
  assert.throws(
    () =>
      release(s, d, {
        audience: "Selected members",
        memberNames: ["Not a member"],
      }),
    /audience members/,
  );
});
test("reviewed publication locks its evidence and source content against in-place edits", () => {
  const { s, d } = fixture();
  const p = release(s, d);
  publishDocument(s, p.id);
  for (const change of ["audience", "source", "delete", "history"]) {
    const after = structuredClone(s);
    const draft = materials(after).publications[0];
    if (change === "audience") draft.title = "Changed title";
    if (change === "source")
      after.documents.find((x) => x.id === d.id).text = "Silently replaced";
    if (change === "delete") materials(after).publications = [];
    if (change === "history") draft.history = [];
    assert.throws(
      () => validateBusinessMutation(s, after),
      /immutable|Preserve|Keep publication/,
    );
  }
});
test("closed publications cannot be reactivated or change their first publication event", () => {
  const { s, d } = fixture();
  const p = release(s, d);
  publishDocument(s, p.id);
  withdrawPublication(s, p.id, "Retired");
  const after = structuredClone(s);
  materials(after).publications[0].status = "Published";
  assert.throws(() => validateBusinessMutation(s, after), /reactivated/);
});
test("new material approval does not activate the company or publish any files", () => {
  const { s, d } = fixture();
  const c = s.companies.find((c) => c.id === d.companyId);
  const steps = structuredClone(c.steps),
    stage = c.stage;
  approvedMaterial(s, d);
  assert.deepEqual(c.steps, steps);
  assert.equal(c.stage, stage);
  assert.equal(partnerPublications(s, c.id).length, 0);
});
test("a renamed material document replaces its old release only through the explicit material link", () => {
  const { s, d } = fixture();
  const item = approvedMaterial(s, d);
  const p1 = release(s, d, { materialId: item.id });
  publishDocument(s, p1.id);
  const next = {
    ...d,
    id: crypto.randomUUID(),
    name: "Renamed final logo.txt",
    version: 1,
  };
  s.documents.push(next);
  updateMaterial(s, item.id, {
    ...item,
    status: "Awaiting review",
    documentId: next.id,
    note: "New material file",
    revision: item.revision,
  });
  approveMaterial(s, item.id, item.revision, "New file approved");
  assert.deepEqual(
    partnerPublications(s, "c1").map((p) => p.id),
    [p1.id],
  );
  const p2 = release(s, next, { materialId: item.id });
  publishDocument(s, p2.id, [p1.id]);
  assert.deepEqual(
    partnerPublications(s, "c1").map((p) => p.id),
    [p2.id],
  );
});
