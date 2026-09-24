# Personal staff assistant

The private pilot has a real Cloudflare Agents SDK service. Each verified staff account gets one Durable Object per workspace. Conversations are further scoped to a company and optional title file. The UI can ask one or two specialists to review the same current records in parallel: Coordinator, Finals reviewer, Company coordinator, and Month-end reviewer (finance access required).

## What it does

The assistant returns concise findings with links to the supplied source records and a suggested staff task. Questions and separate specialist results persist across refreshes. Follow-up questions receive at most three completed prior turns from the same still-visible conversation; older answers are context, never a substitute for current records. Creating a task requires editing/reviewing a proposal in the UI and passing the existing server command workflow. The exact workspace revision is checked again before save.

The automatic context contains bounded, permission-projected company/file fields, finals waiting/ready checks, current document metadata, task titles, and finance-permitted close totals. It does not read PDFs, perform OCR, ingest email bodies or application forms, browse websites, send messages, operate SoftPro, issue policies or move money. A source citation identifies an app record; it is not proof that an AI conclusion is correct. Staff review remains necessary.

## In-app product help

**Ask for help** is available from each workspace page and from form/dialog headers. Users can ask natural-language questions about using the current screen, read quick guides, follow links to the relevant area, and return to their work. Opening or closing help preserves the underlying form; a link to a different page asks the user to finish the open form first. The panel supports narrow mobile screens and keyboard focus restoration.

Product help uses a separate conversation purpose and the Product guide specialist. The server supplies a maintained, role-filtered guide catalog plus a validated page/view/surface hint. It does not attach company records, file contents, email bodies, or form values. It works for authenticated users with no companies assigned. Partners receive only portal/account guides; this does not grant access to the staff record assistant. Browser navigation uses known local guide destinations rather than model-supplied URLs.

Help conversations persist privately for the verified account and workspace, separate from company/file reviews. Every call rechecks current access; the client rejects responses after an account, workspace, or permission-version change. The existing daily and storage limits are shared across help and record reviews. Questions are user-supplied, so the UI asks users to leave out passwords and personal client details.

Quick guides remain available in sample mode and when the model is unavailable. They are labeled as guides; failed model calls remain visible failures. Answers cite the supplied guides and cannot operate the app, change records, send messages, or approve title work. Updating product behavior should include updating `web/lib/assistant/help-guides.ts` and its regression tests.

## Request path and isolation

1. The existing private Cloudflare Access application protects the pilot and `/api/assistant`.
2. The frontend sends its authenticated Supabase session to that same-origin route.
3. A service binding calls `title-personal-assistant`. That Worker has no public route or workers.dev/preview URL.
4. The service calls `title-api/assistant/context`, which verifies the current user, required password setup, MFA, session validity, membership and company/file permissions.
5. Only that verified context determines the user's Durable Object name. The browser cannot select another user or instance.
6. Every history read and run repeats that verification. Changes to membership version or source visibility hide the earlier context. Partners can use portal product help but cannot use company/file reviews.

The service exposes no generic Agent/WebSocket routes or external tools. It uses the Workers AI binding and the supported `@cf/meta/llama-3.3-70b-instruct-fp8-fast` model. A JSON schema restricts output shape and source IDs; local validation still rejects malformed or unsubstantiated structures. It accepts both the documented text response and the decoded JSON response actually returned by JSON mode. Provider failures stay visibly failed; no replacement answer is fabricated.

Questions are limited to 2,000 characters. The pilot allows 30 questions per user per UTC day, one active question, two model calls per question, 20 conversations, and 12 questions per conversation. An 800 KB history threshold prevents additional model calls before storage becomes excessive; users can delete old conversations. Model outputs and record context have their own bounds. Interrupted work is marked failed after two minutes when history is next read. There are no automatically recurring jobs.

Assistant history is private service data, outside shared workspace exports and audit feeds. It is not yet part of the business backup/restore package. Deleting a conversation does not delete an already approved business task.

## Build and deployment

From the repository root, using the existing Cloudflare account and ignored frontend Supabase configuration:

```sh
npm ci --prefix services/title-assistant
npm run types --prefix services/title-assistant
npm run typecheck --prefix services/title-assistant
npm test --prefix services/title-assistant
npm run test:help --prefix web
npm run deploy --prefix services/title-assistant
npm run typecheck --prefix web
npm run build:pilot --prefix web
npm run check:pilot --prefix web
npm run deploy:pilot --prefix web
```

The matching `title-api` Edge Function bundle must also be deployed through the correct Supabase project. Its authenticated context route is in source control; no new SQL schema is required for this pass. Local fictional mode shows a truthful connected-pilot invitation, not simulated AI answers. Cloudflare Workers AI usage follows the account's billing; no separate model API key is shipped to the browser.

## Implementation references

- [Assistant UI](../web/components/title/assistant.tsx) and [authenticated client](../web/lib/assistant/client.ts)
- [Context projection](../web/lib/backend/assistant-context.ts), [private service](../services/title-assistant/src/index.ts), and [bounded runtime rules](../services/title-assistant/src/core.ts)
- [Cloudflare Agent routing](https://developers.cloudflare.com/agents/runtime/communication/routing/) and [persistent Agent state](https://developers.cloudflare.com/agents/runtime/lifecycle/state/)
- [Workers AI JSON mode](https://developers.cloudflare.com/workers-ai/features/json-mode/) and [model documentation](https://developers.cloudflare.com/workers-ai/models/llama-3.3-70b-instruct-fp8-fast/)

See [the transcript recheck](transcript-recheck-2026-09-13.md) for business coverage and the remaining integrations.
