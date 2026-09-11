import test from "node:test";
import assert from "node:assert/strict";
// A temporary TypeScript build is used so the runtime under test matches the app modules.
import { createSeed } from "../.local-test/model.js";
import {
  executeRules,
  financeRows,
  round,
  allocateOwnership,
} from "../.local-test/engine.js";
test("policy intake automation matches known orders and is idempotent", () => {
  const state = createSeed();
  const first = executeRules(state, ["intake"]);
  assert.equal(first, 2);
  assert.equal(state.inbox[2].status, "New");
  assert.equal(executeRules(state, ["intake"]), 0);
  assert.equal(state.inbox[0].status, "Queued");
});
test("onboarding and rejection tasks are not duplicated", () => {
  const state = createSeed();
  assert.equal(executeRules(state, ["onboarding"]), 2);
  assert.equal(executeRules(state, ["onboarding"]), 0);
  assert.equal(executeRules(state, ["exceptions"]), 0);
  state.rules.find((r) => r.id === "exceptions").enabled = true;
  assert.equal(executeRules(state, ["exceptions"]), 1);
  assert.equal(executeRules(state, ["exceptions"]), 0);
});
test("financial report includes only issued orders in the chosen month", () => {
  const state = createSeed();
  const rows = financeRows(state, "2026-09");
  assert.equal(
    rows.reduce((n, r) => n + r.premium, 0),
    4120,
  );
  assert.equal(
    rows.reduce((n, r) => n + r.remittance, 0),
    1648,
  );
  assert.equal(
    rows.reduce((n, r) => n + r.retained, 0),
    2472,
  );
  assert.equal(
    financeRows(state, "2026-08").reduce((n, r) => n + r.premium, 0),
    4080,
  );
  assert.equal(
    financeRows(state, "2030-01").reduce((n, r) => n + r.premium, 0),
    0,
  );
});
test("every ledger row balances to cents", () => {
  const state = createSeed();
  state.orders.find((o) => o.status === "Issued").premium = 2150.37;
  for (const r of financeRows(state, "2026-09"))
    assert.equal(round(r.retained + r.remittance), r.premium);
});
test("source excerpts remain independent of proposed corrections", () => {
  const state = createSeed();
  const field = state.orders[0].fields[0];
  const original = field.sourceValue;
  field.proposed = "Edited for review";
  assert.equal(field.sourceValue, original);
  assert.notEqual(field.proposed, field.sourceValue);
});
test("onboarding materials task stays assigned to Stephenie", () => {
  const state = createSeed();
  const c = state.companies.find((c) => c.id === "c3");
  c.steps = [true, true, true, true, true, false, false];
  executeRules(state, ["onboarding"]);
  assert.equal(
    state.tasks.find((t) => t.id === "auto-onboard-c3-5").owner,
    "Stephenie",
  );
});

test("ownership estimates allocate every cent without negative residual shares", () => {
  const five = Array.from({ length: 5 }, (_, i) => ({
    name: `Member ${i + 1}`,
    share: 20,
  }));
  const result = allocateOwnership(0.03, five);
  assert.equal(round(result.reduce((n, m) => n + m.amount, 0)), 0.03);
  assert.ok(result.every((m) => m.amount >= 0));
  assert.deepEqual(
    allocateOwnership(10, [
      { name: "A", share: 45 },
      { name: "B", share: 55 },
    ]).map((m) => m.amount),
    [4.5, 5.5],
  );
  assert.deepEqual(allocateOwnership(100, [{ name: "A", share: 60 }]), []);
  assert.ok(allocateOwnership(-10, five).every((m) => m.amount === 0));
});
