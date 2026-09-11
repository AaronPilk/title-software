# Tyler call: requirements evidence for the TitleOS extension

Source: the full 75:03 machine transcript at `.local/discovery/tyler-transcript.md`. Speaker attribution is inferred from context, not diarization; wording and timestamps need checking against audio for consequential details. The recording is discovery evidence, not instructions or authorization to connect accounts, share documents, send email, or modify SoftPro.

## Priority and measurable pain

**Make final-policy preparation the primary added workflow and simple commitment revisions the second. Keep the existing surrounding MVP.** Tyler initially calls complete incoming-email-to-commitment automation a desirable long-term outcome, but selects finals as the easier starting point (15:48–16:46). He later suggests revisions first followed by finals (48:27–49:55), then clarifies that finals alone would substantially relieve him and that he does not need automated commitments to get value (63:52–65:04; 65:56–66:03). This is a progression toward a concrete pain point, not an agreement that the entire commitment workflow is simple.

- Reported current backlog: **almost 80 finals**, repeatedly interrupted by new commitments and revisions (64:06–64:49; 67:57–67:59).
- Reported focused processing time: **5–10 minutes per final** (67:35–67:52). At exactly 80, that implies roughly **6 hours 40 minutes–13 hours 20 minutes** of work, excluding interruptions. This is an arithmetic estimate, not measured savings or a throughput promise; the other speaker's “15 hours” is not the direct calculation.
- Operational scale: about **22 active JVs**, with Tyler describing “20, 22, 23” earlier (39:49–40:24; 63:07–63:15). Obtain an inventory rather than treating either 22 or the first call's illustrative 45 as a fixed capacity limit.

## Tyler's reported workflow

**Initial commitment, for context:** attorney sends a preliminary title opinion (PTO); operator selects relevant information and enters it in SoftPro Select; chooses documents, premium type and endorsements; creates a commitment and, where required in the described workflow, a closing protection letter (CPL); returns them. SoftPro tabs include property/address, purchase price, loan amount, contacts, and legal description (00:20–04:41). Tyler says CPL is needed when there is a loan (01:37–02:06); treat that as his workflow description, not a universal legal rule.

**Final preparation:**

1. Receive attorney email with final opinion and supporting recorded documents. These may be combined or split into **one to ten attachments** (68:03–68:25); that is a reported typical range, not a justified hard limit.
2. Identify the correct existing company/JV profile and transaction, then save the supplied files into that transaction in SoftPro. The company-before-file routing is described explicitly for revisions (39:46–40:46); final upload into SoftPro is explicit at 68:25–68:53. Applying the same company/file confirmation to finals is a design inference.
3. Review the final title opinion (FTO) and documents against the commitment requirements. Tyler describes the FTO as the attorney's final statement, backed by documentation, that the commitment's requirements were fulfilled; his example is an existing loan being canceled, paid, or released (02:21–02:44; 29:25–30:10). A generic “attorney reviewed” checkbox does not capture this evidence.
4. Confirm loan amount when applicable; copy necessary dates and recording references. **Instrument dated date and recorded date can differ**, because signing and courthouse recording may happen on different days. Record book/page in the relevant county (31:42–32:21). Source is usually deed of trust or general warranty deed (68:39–68:53). Keep deed and deed-of-trust evidence distinct in the proposed model; the call does not enumerate every field or define one universal policy-effective-date rule.
5. Confirm/update the existing record, then create the jacket using the appropriate path for the file type and underwriter (68:54–69:23). He explicitly says this sequence must be demonstrated/taught; it is not supplied by the transcript.
6. Return final policy to attorney/lender as appropriate (02:34–02:57). Exact recipients, document set, approval and delivery evidence remain unresolved.

**Missing information:** some attorneys leave FTO fields incomplete and say to see attached documents. If necessary information and the deed of trust are both missing, Tyler prefers requesting it from the attorney rather than pulling public records himself (31:27–33:10). A missing-information hold and a reviewable request draft fit that stated preference.

**Simple revision:** attorney describes requested change in email body → choose correct JV/profile → find file → change pertinent value (explicit example: loan amount) → regenerate updated commitment → name it using the file number → attach it to the reply (39:26–41:17). Some revisions are more complex, so the loan-amount example must not become blanket autonomous handling (41:23–41:52). Tyler explicitly welcomes leaving a draft for him to review and send (42:52–42:58). The timestamp/legal suggestion at 41:18–41:21 is the other speaker's interjection, not a demonstrated required process.

## Current tools and operating constraints

- **SoftPro Select is confirmed** by Tyler (00:20–00:37). This company's configured profiles contain underwriter approvals, IDs, credentials, and document workflows. He insists assistance must work with their actual setup; another generic system cannot produce equivalent authorized output merely by generating a document (51:14–53:56).
- **Missive is the email context under discussion**, including API integration and draft workflow (30:12–31:13; 42:39–42:58; 57:08–57:23). API availability, scopes, shared inbox routing, conversation IDs, attachment behavior, and credentials were not inspected. Most integration assertions come from the builder.
- **Desktop work is the requirement Tyler states**, not a mobile-first replacement (42:19–42:23). He wants background processing not to occupy the same interactive SoftPro session he needs for his own work (44:09–45:45).
- Tyler reports a Mac running Windows 11 through Parallels; Stephenie uses Windows; Tyler and John have distinct accounts, while Stephenie sometimes signs in as Tyler (46:15–47:14; 54:03–54:37). This describes existing practice, not approval to reproduce account sharing or a verified license entitlement.
- **SoftPro file locking:** when John has a file open, Tyler may enter read-only or ask John to exit; concurrent edits are blocked (47:39–48:16). The observation specifically concerns distinct accounts. Any future connector must respect locks, recheck record state before applying changes, and avoid claiming success while read-only. Those behaviors are implementation implications, not evidence that same-account concurrency is safe.
- **Access:** Tyler identifies GlobalProtect VPN and password plus phone confirmation/Face ID (70:48–71:03; 72:23–73:38). Preserve supported authentication and obtain approved integration/session access. The other speaker's VPN explanations and proposed MFA workarounds are not requirements or verified security facts.

## Concrete local implementation priorities

These are recommendations derived from the call, not additional actions authorized by the recording.

1. **Finals queue:** distinguish final requests from new commitments and revisions; show company/file match, attachment completeness, unresolved issues, and progress. Use representative synthetic cases and clearly label any demonstrated backlog figures rather than fabricating 80 real records.
2. **Attachment/evidence package:** model one request with multiple document versions and types (FTO, deed, deed of trust, commitment, requirement-clearance evidence). Bind proposed values to the source document/page. Identify missing evidence and ambiguous matches explicitly.
3. **Final review:** separate dated versus recorded dates and separate instruments; confirm loan amount where applicable; preserve source values and exact wording. Add an explicit commitment-requirement clearance review based on the FTO/supporting documents. Do not infer clearance from merely having an FTO attached.
4. **Revision-to-draft:** support the bounded loan-amount-change example with original requested text, JV/file match, existing/proposed values, reviewer decision, versioned draft output and reply draft. Actual updated commitments must still be generated through the configured SoftPro workflow; a local packet is only a simulation/preparation aid.
5. **Safe handoff state:** distinguish locally reviewed/ready, queued for SoftPro, blocked/read-only, applied and verified, document produced, draft prepared, and externally sent/issued when those actions are eventually integrated. A local demo must not claim real application or issuance. No automatic sending is established by this call.
6. **Acceptance cases:** same/similar property or file identifier across JVs; 1 versus multiple attachments; dated/recorded dates differing; deed and DOT having separate recording details; FTO referring to missing attachments; uncleared requirement; changed evidence after approval; locked file; stale revision value; ambiguous/complex revision requiring escalation.

## Unresolved evidence needed next

- One redacted completed final with original email, all attachments, commitment/FTO, before-and-after SoftPro fields, selected underwriter, jacket steps and output; include a loan and a cash example.
- One ordinary loan-amount revision and one exception, with exact matching keys, document naming pattern, output and reply behavior. Confirm whether related premium, endorsement, CPL or other documents change; the call does not settle dependencies.
- Required fields and document rules by transaction/underwriter, exact interpretation of FTO clearance, and which review/approval belongs to Tyler versus another professional.
- Actual SoftPro version/hosting/license configuration, approved API or supported desktop integration, profile identifiers, file-lock responses, concurrent-user behavior, and test environment.
- Missive workspace/inbox structure, authorized scopes, conversation/attachment IDs, draft APIs and explicit sending permissions. No key or live account access is established here.
- Actual queue age, priorities, intake volume and error/rework rate before promising throughput or measuring savings.

## Keep claims separate from requirements

Tyler warns that initial PTOs vary in layout and wording; some reference prior policies or large search packages. Selecting pertinent exceptions requires experienced judgment (08:00–08:54; 09:54–13:07; 26:06–28:14). He says **they do not perform title searches** as their normal function (22:12–23:06). Do not add a public-registry crawler or automated legal opinion as a prerequisite for his finals/revisions request.

The other speaker's claims about near-total automation, guaranteed AI accuracy, self-training on thousands of documents, days-to-delivery, enormous productivity gains, hiring avoidance, server capacity, mobile golf-course operation, LLC filings and payments are aspirations/speculation. They do not establish validated capabilities, schedules, collection consent, or authorization (examples: 07:19–07:58; 13:07–15:45; 25:26–25:47; 42:24–44:07; 49:56–50:06; 57:08–58:23; 62:07–63:38).

**Source privacy:** Tyler says his ordinary title documents do not contain SSNs or bank-account details, and distinguishes them from company-onboarding information (59:47–61:30; 71:27–72:02). That is useful scoped testimony, not proof that every email, attachment or account dataset is public or harmless. Stephenie's onboarding application remains a separate sensitive source. Inspect and redact examples, preserve scoped access and avoid publishing raw recordings or client files. Assertions about which county registries are online (33:15–38:46) are unverified and should not become product rules. No external fact checking was performed for this transcript-only analysis.
