import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const output = await build({ stdin: { contents: "export * from './lib/backend/workspace'; export * from './lib/title/company-intake'; export * from './lib/title/company-operating-status'; export { companyProblems } from './lib/title/business';", resolveDir: fileURLToPath(new URL('../', import.meta.url)) }, bundle: true, write: false, platform: 'node', format: 'esm' });
const { emptyWorkspace, executeCommands, projectWorkspace, buildCompanyFromCandidate, companyDisplayStage, companyProblems } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].contents).toString('base64')}`);
const owner = { userId: crypto.randomUUID(), email: 'owner@example.test', role: 'owner', allCompanies: true, companyIds: [], restricted: true, version: 1, partnerMembers: [] };
const confirmation = { status: 'Active', confirmedBy: 'forged@example.test', confirmedAt: '2000-01-01T00:00:00.000Z', note: 'Owner confirms this is an existing operating business.' };
function state() {
  const s = emptyWorkspace(owner.email);
  for (const id of ['cedar', 'oak']) s.companies.push(buildCompanyFromCandidate({ organizationId: 'org', organizationName: 'Fictional group', teamId: id, teamName: `Fictional ${id} Title` }, { id, importedAt: '2026-09-23T21:00:00.000Z', importedBy: owner.email }));
  return s;
}
const edits = (values) => [{ id: crypto.randomUUID(), name: 'editDraft', args: [values.map(([id, value]) => ({ table: 'companies', id, value }))] }];
const apply = (s, operatingStatus = confirmation, access = owner) => executeCommands(s, edits([['cedar', { operatingStatus }]]), access);

test('confirmed existing operations display Active without inventing setup or authority evidence', () => {
  const before = state(), copy = structuredClone(before), started = Date.now();
  const result = apply(before), company = result.companies[0];
  assert.equal(companyDisplayStage(company), 'Active');
  assert.equal(company.stage, 'Onboarding');
  assert.deepEqual(company.steps, Array(7).fill(false));
  assert.deepEqual(company.intake, before.companies[0].intake);
  assert.deepEqual(company.members, []);
  assert.equal(company.jurisdiction, '');
  assert.equal(company.operatingStatus.confirmedBy, owner.email);
  assert.ok(Date.parse(company.operatingStatus.confirmedAt) >= started);
  assert.ok(Date.parse(company.operatingStatus.confirmedAt) <= Date.now());
  assert.ok(companyProblems(result, company).length > 0);
  assert.deepEqual(before, copy);
});

test('only organization administrators can record or clear existing-operation confirmation', () => {
  const before = state();
  for (const role of ['operations', 'onboarding', 'finance', 'viewer', 'partner']) {
    assert.throws(() => apply(before, confirmation, { ...owner, role }), /cannot|administrator|access/i);
    assert.throws(() => apply(before, null, { ...owner, role }), /cannot|administrator|access/i);
  }
  assert.throws(() => apply(before, confirmation, { ...owner, role: 'admin', allCompanies: false, companyIds: ['cedar'] }), /administrator/i);
  assert.equal(companyDisplayStage(apply(before, confirmation, { ...owner, role: 'admin' }).companies[0]), 'Active');
});

test('mixed-scope bulk confirmation fails atomically and does not widen company access', () => {
  const before = state(), copy = structuredClone(before);
  const scopedOwner = { ...owner, allCompanies: false, companyIds: ['cedar'] };
  assert.throws(() => executeCommands(before, edits([['cedar', { operatingStatus: confirmation }], ['oak', { operatingStatus: confirmation }]]), scopedOwner), /outside|access/i);
  assert.deepEqual(before, copy);
  assert.deepEqual(scopedOwner.companyIds, ['cedar']);
});

test('confirmation cannot set launch stage, complete steps or add unreviewed evidence', () => {
  const before = state();
  for (const other of [{ stage: 'Active' }, { steps: Array(7).fill(true) }, { authorizations: [{ status: 'Approved' }] }]) {
    assert.throws(() => executeCommands(before, edits([['cedar', { operatingStatus: confirmation, ...other }]]), owner), /Unsupported field/);
  }
  assert.deepEqual(apply(before).business.onboarding, before.business.onboarding);
});

test('invalid or unbounded confirmation data is rejected', () => {
  for (const value of [false, [], {}, { ...confirmation, status: 'Licensed' }, { ...confirmation, note: '' }, { ...confirmation, note: ' '.repeat(5) }, { ...confirmation, note: 'x'.repeat(1001) }, { ...confirmation, note: 'Bad\u0000note' }, { ...confirmation, extra: true }]) {
    assert.throws(() => apply(state(), value), error => error.status === 400);
  }
});

test('clearing confirmation is reversible and never marks profile or onboarding complete', () => {
  const confirmed = apply(state()), cleared = apply(confirmed, null);
  assert.equal(companyDisplayStage(cleared.companies[0]), 'Onboarding');
  assert.equal(cleared.companies[0].operatingStatus, null);
  assert.deepEqual(cleared.companies[0].steps, Array(7).fill(false));
  assert.equal(cleared.companies[0].intake.profileStatus, 'incomplete');
  assert.equal(companyDisplayStage(apply(cleared).companies[0]), 'Active');
});

test('profile completion work preserves existing-operation confirmation', () => {
  const confirmed = apply(state());
  const result = executeCommands(confirmed, edits([['cedar', { contact: 'Fictional Person', location: 'Charlotte', jurisdiction: 'NC', operatingStates: ['NC'] }]]), owner);
  assert.equal(companyDisplayStage(result.companies[0]), 'Active');
  assert.equal(result.companies[0].stage, 'Onboarding');
  assert.deepEqual(result.companies[0].operatingStatus, confirmed.companies[0].operatingStatus);
});

test('partner display exposes activity status without confirmation notes or administrator identity', () => {
  const confirmed = apply(state());
  confirmed.companies[0].members = [{ name: 'Fictional Partner', share: 100 }];
  const partner = { ...owner, role: 'partner', allCompanies: false, restricted: false, companyIds: ['cedar'], partnerMembers: [{ id: 'grant', companyId: 'cedar', memberName: 'Fictional Partner' }] };
  const visible = projectWorkspace(confirmed, partner);
  assert.equal(visible.companies.length, 1);
  assert.equal(visible.companies[0].stage, 'Active');
  assert.equal(visible.companies[0].operatingStatus, undefined);
  assert.doesNotMatch(JSON.stringify(visible.companies[0]), /forged@example|Owner confirms this/);
});
