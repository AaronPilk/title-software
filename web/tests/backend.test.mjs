import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyWorkspace,
  executeCommands,
  projectWorkspace,
  safePayload,
  allowedAsset,
  captureCommands,
  createSeed,
  B,
  P,
  M,
} from "../.local-test/backend/api.mjs";
const owner = {
  userId: crypto.randomUUID(),
  email: "owner@example.com",
  role: "owner",
  allCompanies: true,
  companyIds: [],
  restricted: true,
  version: 1,
  partnerMembers: [],
};
const scope = (role = "operations", more = {}) => ({
  ...owner,
  role,
  allCompanies: false,
  companyIds: ["A"],
  restricted: false,
  ...more,
});
const command = (name, ...args) => ({ id: crypto.randomUUID(), name, args });
const edit = (table, id, value, insert = false) =>
  command("editDraft", [{ table, id, value, insert }]);
const company = (id) => ({
  id,
  name: `Company ${id}`,
  initials: id,
  color: "blue",
  contact: "Test Person",
  email: "test@example.com",
  location: "Charlotte",
  jurisdiction: "NC",
  stage: "Onboarding",
  steps: [],
  members: [{ name: "Member A", share: 100 }],
});
function fixture() {
  const s = emptyWorkspace();
  s.companies = [company("A"), company("B")];
  s.orders = [
    {
      id: "O-A",
      companyId: "A",
      address: "Test A",
      client: "Client A",
      type: "Purchase",
      underwriter: "WFG",
      owner: "Test",
      jurisdiction: "NC",
      status: "New",
      due: "2026-09-12",
      premium: 100,
      rate: 0.4,
      month: "2026-09",
      fields: [],
      notes: "",
      exception: "",
      delivered: false,
      remitted: false,
    },
  ];
  return s;
}
const doc = (id, more = {}) => ({
  id,
  companyId: "A",
  name: id + ".txt",
  category: "Other",
  visibility: "Internal",
  date: "2026-09-12",
  size: "12 B",
  version: 1,
  text: "Hello",
  ...more,
});
test("scoped staff cannot move another company message into their scope", () => {
  const s = fixture();
  s.inbox.push({
    id: "hidden-mail",
    companyId: "B",
    orderId: "",
    from: "Person",
    email: "person@example.com",
    subject: "PRIVATE",
    body: "SECRET",
    documentIds: [],
    attachments: [],
    status: "New",
  });
  assert.throws(
    () =>
      executeCommands(
        s,
        [
          edit("inbox", "hidden-mail", {
            companyId: "A",
            orderId: "",
            documentIds: [],
            attachments: [],
          }),
        ],
        scope(),
      ),
    /outside/,
  );
  assert.equal(projectWorkspace(s, scope()).inbox.length, 0);
});
test("viewer cannot mutate records or use named actions", () => {
  assert.throws(
    () =>
      executeCommands(
        fixture(),
        [edit("orders", "O-A", { notes: "changed" })],
        scope("viewer"),
      ),
    /cannot/,
  );
  assert.throws(
    () =>
      executeCommands(
        fixture(),
        [command("addPolicy", "O-A", "Owner")],
        scope("viewer"),
      ),
    /cannot/,
  );
});
test("source fields cannot bypass product issuance", () => {
  assert.throws(
    () =>
      executeCommands(
        fixture(),
        [edit("orders", "O-A", { status: "Issued" })],
        owner,
      ),
    /issuance/,
  );
  assert.throws(
    () =>
      executeCommands(
        fixture(),
        [edit("business.policies", "new-policy", { status: "Issued" }, true)],
        owner,
      ),
    /Create policy/,
  );
});
test("new order preserves submitted premium and starts unissued", () => {
  const s = fixture();
  const n = executeCommands(
    s,
    [
      edit(
        "orders",
        "O-new",
        {
          companyId: "A",
          address: "Home",
          client: "Client",
          jurisdiction: "NC",
          due: "2026-10-01",
          premium: 321,
          status: "Issued",
          remitted: true,
        },
        true,
      ),
    ],
    scope(),
  );
  assert.equal(n.orders[0].premium, 321);
  assert.equal(n.orders[0].status, "New");
  assert.equal(n.orders[0].remitted, false);
  assert.equal(n.orders[0].month, "2026-10");
});
test("finance can remit issued records and cannot edit title inputs", () => {
  const s = fixture();
  s.orders[0].status = "Issued";
  assert.equal(
    executeCommands(
      s,
      [edit("orders", "O-A", { remitted: true })],
      scope("finance"),
    ).orders[0].remitted,
    true,
  );
  assert.throws(
    () =>
      executeCommands(
        s,
        [edit("orders", "O-A", { remitted: true, notes: "also changing" })],
        scope("finance"),
      ),
    /cannot/,
  );
});
test("identity swaps and direct document history edits are rejected", () => {
  const s = fixture();
  s.documents = [doc("doc-a")];
  assert.throws(
    () =>
      executeCommands(s, [edit("documents", "doc-a", { id: "other" })], owner),
    /identity/,
  );
  assert.throws(
    () =>
      executeCommands(
        s,
        [edit("documents", "doc-a", { text: "replacement" })],
        owner,
      ),
    /Unsupported/,
  );
});
test("restricted source evidence disappears from every dependent snapshot", () => {
  const s = fixture();
  s.documents = [
    doc("restricted", {
      visibility: "Restricted",
      text: "SECRET-MARKER",
      assetId: "PRIVATE-ASSET",
      orderId: "O-A",
    }),
  ];
  s.materials.items = [
    {
      id: "material-secret",
      companyId: "A",
      documentId: "restricted",
      reviewSnapshot: JSON.stringify({
        documentId: "restricted",
        text: "SECRET-MARKER",
        assetId: "PRIVATE-ASSET",
      }),
      history: [],
    },
  ];
  const p = projectWorkspace(s, scope("onboarding"));
  assert.equal(p.orders.length, 0);
  assert.equal(p.materials.items.length, 0);
  assert(!JSON.stringify(p).includes("SECRET-MARKER"));
  assert(!JSON.stringify(p).includes("PRIVATE-ASSET"));
  assert.equal(allowedAsset(s, scope(), "PRIVATE-ASSET"), undefined);
  assert.throws(
    () =>
      executeCommands(
        s,
        [command("approveMaterial", "material-secret", 1, "Reviewed")],
        scope("onboarding"),
      ),
    /outside/,
  );
});
test("outsider cannot read company records", () => {
  const p = projectWorkspace(fixture(), scope("viewer", { companyIds: [] }));
  assert.equal(p.companies.length, 0);
  assert.equal(p.orders.length, 0);
});
test("partial draft recipient is preserved until final review", () => {
  const s = fixture();
  s.replyDrafts = [
    {
      id: "reply",
      orderId: "O-A",
      to: "old@example.com",
      subject: "Draft",
      body: "Content",
      attachmentId: "",
      status: "Awaiting document",
    },
  ];
  const p = executeCommands(
    s,
    [edit("replyDrafts", "reply", { to: "j" })],
    scope(),
  );
  assert.equal(p.replyDrafts[0].to, "j");
});
test("non-finite numbers, prototype keys, and arbitrary commands fail", () => {
  assert.throws(() => safePayload({ value: NaN }), /number/);
  assert.throws(() => safePayload(JSON.parse('{"__proto__":{}}')), /property/);
  assert.throws(
    () => executeCommands(fixture(), [command("replaceEverything", {})], owner),
    /Unknown/,
  );
});
test("empty workspace projects safely for every role", () => {
  for (const role of [
    "owner",
    "admin",
    "operations",
    "onboarding",
    "finance",
    "viewer",
    "partner",
  ])
    assert.equal(
      projectWorkspace(emptyWorkspace(), scope(role)).companies.length,
      0,
    );
});
test("server actor overrides browser persona", () => {
  assert.throws(
    () =>
      executeCommands(
        fixture(),
        [edit("user", "", { value: "Pretend owner" })],
        owner,
      ),
    /authentication/,
  );
  assert.equal(
    executeCommands(
      fixture(),
      [edit("orders", "O-A", { notes: "Saved" })],
      owner,
    ).user,
    owner.email,
  );
});
function replayCase(role = "owner") {
  let state = { ...emptyWorkspace(), ...createSeed(), statementDeliveries: [] };
  const access = { ...owner, role };
  return {
    get state() {
      return state;
    },
    run(fn) {
      const draft = projectWorkspace(state, access);
      const commands = captureCommands(draft, fn);
      assert(commands.length > 0);
      state = executeCommands(state, commands, access);
      return state;
    },
  };
}
test("captured owner and loan workflows prepare, issue, and preserve immutable evidence", () => {
  const c = replayCase("operations"),
    oid = c.state.orders[0].id;
  c.run((s) => {
    const o = s.orders.find((o) => o.id === oid);
    o.production.requirements.forEach((r) => {
      r.status = r.kind === "Requirement" ? "Satisfied" : "Retained";
      r.evidence = "Reviewed recorded source";
      r.note = "Disposition reviewed";
    });
    o.fields.forEach((f) => (f.reviewed = true));
  });
  c.run((s) =>
    P.reviewCommitment(
      s,
      s.orders.find((o) => o.id === oid),
      "Final source evidence reviewed",
    ),
  );
  const ids = {},
    outputs = {};
  c.run((s) => {
    for (const kind of ["Owner", "Loan"])
      ids[kind] = B.addPolicy(s, oid, kind).id;
  });
  for (const kind of ["Owner", "Loan"]) {
    const id = ids[kind];
    assert(c.state.business.policies.some((p) => p.id === id));
    c.run((s) => {
      const o = s.orders.find((o) => o.id === oid),
        p = B.products(s, oid).find((p) => p.id === id);
      B.savePolicy(s, {
        ...p,
        insured: kind === "Owner" ? "QA Owner" : "QA Lender",
        form: "QA authorized form",
        amount: kind === "Owner" ? 400000 : 320000,
        loanAmount: kind === "Loan" ? 320000 : 0,
        loanReference: kind === "Loan" ? "Primary loan" : "",
        premium: kind === "Owner" ? 1000 : 250,
        reviewNote: "Reviewed coverage",
        securityDocumentId:
          P.orderSources(s, oid).find((d) => d.sourceRole === "Deed of trust")
            ?.id || "",
        securityPage: "1",
        loanReviewNote: "Principal checked",
        exceptions: o.production.requirements
          .filter((r) => r.kind === "Exception")
          .map((r) => ({
            itemId: r.id,
            disposition: "Retain",
            wording: r.text,
            reason: "Reviewed",
          })),
      });
    });
    c.run((s) => B.preparePolicy(s, id, "Reviewed final inputs"));
    const did = (outputs[kind] = crypto.randomUUID());
    c.run((s) => {
      const o = s.orders.find((o) => o.id === oid),
        p = B.products(s, oid).find((p) => p.id === id);
      s.documents.push({
        id: did,
        companyId: o.companyId,
        orderId: oid,
        name: kind + " policy.txt",
        sourceRole: "Final policy",
        category: "Policy documents",
        visibility: "Internal",
        date: "2026-09-12",
        size: "10 B",
        version: 1,
        text: "QA returned output",
        policyId: id,
        policyVersion: p.version,
        productionVersion: o.production.version,
        preparationFingerprint: p.preparedSnapshot,
      });
    });
  }
  for (const kind of ["Owner", "Loan"]) {
    const id = ids[kind],
      did = outputs[kind];
    c.run((s) =>
      B.issuePolicy(s, id, {
        reference: "QA-" + kind,
        documentId: did,
        month: "2026-09",
      }),
    );
    assert.equal(
      c.state.business.policies.find((p) => p.id === id).status,
      "Issued",
    );
    assert.throws(
      () =>
        executeCommands(
          c.state,
          [edit("business.policies", id, { amount: 1 })],
          owner,
        ),
      /Unsupported/i,
    );
  }
});
test("captured application, materials, and published close commands replay correctly", () => {
  const onboarding = replayCase("onboarding");
  onboarding.run((s) => {
    const c = s.companies.find((c) => c.id === "c3");
    B.saveApplication(s, {
      ...B.getOnboarding(s, c),
      mailingAddress: "100 Example Street",
      secureApplicationReference: "QA secure intake",
      signatureReference: "QA signature",
      applicationStatus: "Reviewed",
      applicationNote: "Reviewed business details",
    });
  });
  assert.equal(
    onboarding.state.business.onboarding.find((o) => o.companyId === "c3")
      .applicationStatus,
    "Reviewed",
  );
  let material;
  onboarding.run((s) => {
    material = M.createMaterial(s, {
      companyId: "c1",
      kind: "Logo",
      title: "QA logo",
      owner: "QA",
      brief: "Reviewed company identity",
    });
  });
  const docId = onboarding.state.documents.find(
    (d) => d.companyId === "c1" && d.name === "Company overview.txt",
  ).id;
  onboarding.run((s) =>
    M.updateMaterial(s, material, {
      title: "QA logo",
      owner: "QA",
      brief: "Reviewed company identity",
      documentId: docId,
      status: "Awaiting review",
      note: "Source attached",
      revision: 1,
    }),
  );
  onboarding.run((s) =>
    M.approveMaterial(s, material, 2, "Approved company identity"),
  );
  assert.equal(
    onboarding.state.materials.items.find((i) => i.id === material).status,
    "Approved",
  );
  const finance = replayCase("finance");
  let close;
  finance.run((s) => {
    close = B.newClose(s, "c1", "2026-09").id;
  });
  finance.run((s) =>
    B.reviewClose(s, {
      ...s.business.closes.find((p) => p.id === close),
      booksReference: "QA reconciled books",
      agreementReference: "QA agreement",
      note: "Reviewed allocation and expenses",
    }),
  );
  finance.run((s) => B.publishClose(s, close));
  assert.equal(
    finance.state.business.closes.find((p) => p.id === close).status,
    "Published",
  );
  const projected = projectWorkspace(finance.state, {
    ...scope("partner"),
    companyIds: ["c1"],
    partnerMembers: finance.state.companies
      .find((c) => c.id === "c1")
      .members.slice(0, 2)
      .map((m, i) => ({ id: String(i), companyId: "c1", memberName: m.name })),
  });
  assert.equal(projected.business.closes.length, 1);
  assert.equal(projected.business.closes[0].allocations.length, 2);
  assert.equal(projected.companies[0].members.length, 2);
});

test("private onboarding does not prevent finance from closing its company",()=>{
  const s={...emptyWorkspace(),...createSeed()};const c=s.companies.find(c=>c.id==='c1');B.getOnboarding(s,c);
  const a={...scope('finance'),companyIds:['c1']};
  assert.equal(executeCommands(s,[command('newClose','c1','2026-09')],a).business.closes.length,1);
  assert.throws(()=>executeCommands(s,[command('addHandoff',{companyId:'c1',sourceId:'c1',kind:'Application packet'})],{...a,role:'onboarding'}),/Restricted/);
});
