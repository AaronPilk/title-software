import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

// Real orchestration and provider adapters, with fictional SQL/HTTP transports.
// Native SQL authorization and races are verified in test-vendor-sql.mjs.
const bundle = await build({ entryPoints: [fileURLToPath(new URL("../lib/backend/vendor-integrations.ts", import.meta.url))], bundle: true, write: false, format: "esm", platform: "node", target: "es2022" });
const { vendorRequest } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const accountId = "11111111-1111-4111-8111-111111111111", requestId = "22222222-2222-4222-8222-222222222222", templateId = "33333333-3333-4333-8333-333333333333";
const input = { provider: "docusign", companyId: "company-a", expectedRevision: 1, expectedGeneration: 1, reviewed: true, requestId, templateId, emailSubject: "Fictional onboarding", roles: [{ roleName: "Signer", name: "Fictional Owner", email: "owner@example.test" }] };
function fixture() {
  const state = { revision: 1, generation: 1, expired: true, providerPosts: 0, tokenPosts: 0, reservationCalls: 0, refreshRevisions: [] };
  const metadata = { accountId, accountName: "Fictional title", baseUri: "https://demo.docusign.net" };
  let tokens = { accessToken: "TEST-ACCESS-ONE", refreshToken: "TEST-REFRESH-ONE" }, pending = null, lease = null;
  const record = () => ({ provider: "docusign", companyId: "company-a", configured: true, revision: state.revision, generation: state.generation, environment: "sandbox", metadata, connectedAt: "2026-09-23T12:00:00Z", expiresAt: new Date(Date.now() + (state.expired ? -60_000 : 3_600_000)).toISOString(), busy: false, tokens });
  const env = { DOCUSIGN_CLIENT_ID: "FICTIONAL-CLIENT", DOCUSIGN_CLIENT_SECRET: "FICTIONAL-SECRET", DOCUSIGN_ENVIRONMENT: "sandbox", TITLE_VENDOR_REDIRECT_URI: "https://title.example.test/" };
  const context = {
    workspaceId: "workspace-one", access: { userId: "owner-one", role: "owner", allCompanies: true, companyIds: [], restricted: true, version: 1 }, env: name => env[name],
    rpc: async (name, args) => {
      assert.equal(args.p_workspace, "workspace-one"); assert.equal(args.p_actor, "owner-one"); assert.equal(args.p_company, "company-a"); assert.equal(args.p_provider, "docusign");
      if (name === "title_vendor_read") return record();
      if (name === "title_vendor_claim_refresh") {
        assert.equal(args.p_expected, state.revision, "refresh claims actual current revision");
        state.refreshRevisions.push(args.p_expected); lease = `synthetic-lease-${state.refreshRevisions.length}`;
        return { ...record(), ok: true, leaseId: lease };
      }
      if (name === "title_vendor_finish") {
        assert.equal(args.p_lease, lease); assert.deepEqual(args.p_metadata, metadata);
        tokens = args.p_tokens; state.revision++; state.expired = false; lease = null; return record();
      }
      if (name === "title_vendor_reserve_draft") {
        state.reservationCalls++; assert.equal(args.p_expected, state.revision); assert.equal(args.p_request, requestId);
        if (pending) {
          assert.equal(args.p_payload_hash, pending, "retry preserves payload and transaction ID");
          return { created: false, requestId, status: "pending", envelopeId: null };
        }
        pending = args.p_payload_hash; return { created: true, requestId, status: "pending", envelopeId: null };
      }
      assert.fail(`Unexpected RPC (a timed-out draft must not be marked created): ${name}`);
    },
    fetcher: async (url, options) => {
      assert.equal(options.method, "POST");
      if (url === "https://account-d.docusign.com/oauth/token") {
        const body = new URLSearchParams(options.body);
        assert.equal(body.get("grant_type"), "refresh_token"); assert.equal(body.get("refresh_token"), tokens.refreshToken);
        state.tokenPosts++;
        return new Response(JSON.stringify({ access_token: `TEST-ACCESS-${state.tokenPosts}`, refresh_token: `TEST-REFRESH-${state.tokenPosts}`, token_type: "Bearer", expires_in: 3600 }));
      }
      assert.equal(url, `https://demo.docusign.net/restapi/v2.1/accounts/${accountId}/envelopes`);
      const body = JSON.parse(options.body); assert.equal(body.transactionId, requestId); assert.equal(body.status, "created");
      state.providerPosts++;
      // Uncertain failure: the vendor could already have received this request.
      throw new Error("PRIVATE-SYNTHETIC-TRANSPORT-ERROR TEST-ACCESS-1 FICTIONAL-SECRET");
    },
  };
  const execute = (patch = {}) => vendorRequest("/integrations/vendors/draft", "POST", { ...input, ...patch }, context);
  async function uncertainFirstAttempt() {
    await assert.rejects(execute(), error => error.status === 502 && !/PRIVATE-SYNTHETIC|TEST-ACCESS|FICTIONAL-SECRET/.test(error.message));
    assert.equal(state.revision, 2); assert.equal(state.generation, 1); assert.equal(state.providerPosts, 1); assert.equal(state.reservationCalls, 1);
  }
  return { state, execute, uncertainFirstAttempt };
}

test("expired token and uncertain draft POST permit unchanged retry without a second envelope POST", async () => {
  const f = fixture(); await f.uncertainFirstAttempt(); const retry = await f.execute();
  assert.equal(retry.pending, true); assert.equal(retry.created, false); assert.equal(retry.requestId, requestId); assert.equal(retry.revision, 2);
  assert.equal(f.state.providerPosts, 1); assert.equal(f.state.reservationCalls, 2); assert.equal(f.state.tokenPosts, 1); assert.deepEqual(f.state.refreshRevisions, [1]);
});

test("retry refreshes again using actual current revision while preserving its original reservation", async () => {
  const f = fixture(); await f.uncertainFirstAttempt(); f.state.expired = true; const retry = await f.execute();
  assert.equal(retry.pending, true); assert.equal(retry.revision, 3); assert.deepEqual(f.state.refreshRevisions, [1, 2]);
  assert.equal(f.state.providerPosts, 1); assert.equal(f.state.reservationCalls, 2);
});

test("reconnect generation fences an old pending draft before further vendor requests", async () => {
  const f = fixture(); await f.uncertainFirstAttempt(); f.state.revision = 3; f.state.generation = 2;
  await assert.rejects(f.execute(), error => error.status === 409);
  assert.equal(f.state.providerPosts, 1); assert.equal(f.state.tokenPosts, 1); assert.equal(f.state.reservationCalls, 1);
});

test("revision ahead of the database is rejected despite a matching generation", async () => {
  const f = fixture(); await f.uncertainFirstAttempt(); await assert.rejects(f.execute({ expectedRevision: 3 }), error => error.status === 409);
  assert.equal(f.state.providerPosts, 1); assert.equal(f.state.reservationCalls, 1);
});

test("absent generation preserves strict revision conflict for an older client", async () => {
  const f = fixture(); await f.uncertainFirstAttempt(); await assert.rejects(f.execute({ expectedGeneration: undefined }), error => error.status === 409);
  assert.equal(f.state.providerPosts, 1); assert.equal(f.state.reservationCalls, 1);
});

test("string or mismatched generations cannot bypass a stale revision check", async () => {
  const f = fixture(); await f.uncertainFirstAttempt();
  for (const expectedGeneration of ["1", 0, 2, null]) await assert.rejects(f.execute({ expectedGeneration }), error => error.status === 409);
  assert.equal(f.state.providerPosts, 1); assert.equal(f.state.reservationCalls, 1);
});
