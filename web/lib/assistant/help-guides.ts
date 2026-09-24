import type { Page } from "../title/model";

export type HelpScreen = {
  page: string;
  view: "agency" | "production" | "partner";
  surface?: "page" | "company" | "order" | "document";
};
export type HelpGuide = {
  id: string;
  title: string;
  page: Page;
  views: HelpScreen["view"][];
  question: string;
  summary: string;
  steps: string[];
  note?: string;
};

// Screen hints contain navigation labels only, never record identifiers or text.
// They help rank suggestions; they do not establish authorization or add sources.
const pages: readonly Page[] = [
  "Overview", "Assistant", "Inbox", "Orders", "Policy workbench", "Commitments",
  "Policy products", "Handoffs", "Revisions", "Companies", "Onboarding", "Documents",
  "Tasks", "Financials", "Partner portal", "Automations", "Connections", "Settings",
];
const views: readonly HelpScreen["view"][] = ["agency", "production", "partner"];
const surfaces: NonNullable<HelpScreen["surface"]>[] = ["page", "company", "order", "document"];

export function parseHelpScreen(value: unknown): HelpScreen {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    throw new Error("Choose a valid help screen.");
  const screen = value as Record<string, unknown>;
  if (Reflect.ownKeys(screen).some(key => typeof key !== "string" || !["page", "view", "surface"].includes(key)) ||
    !Object.hasOwn(screen, "page") || !Object.hasOwn(screen, "view") ||
    typeof screen.page !== "string" || !pages.includes(screen.page as Page) ||
    typeof screen.view !== "string" || !views.includes(screen.view as HelpScreen["view"]) ||
    (Object.hasOwn(screen, "surface") && !surfaces.includes(screen.surface as NonNullable<HelpScreen["surface"]>)))
    throw new Error("Choose a valid help screen.");
  return { page: screen.page, view: screen.view as HelpScreen["view"],
    ...(Object.hasOwn(screen, "surface") ? { surface: screen.surface as HelpScreen["surface"] } : {}) };
}

type Role = "owner" | "admin" | "operations" | "onboarding" | "finance" | "viewer" | "partner";
type CatalogGuide = HelpGuide & { roles: readonly Role[]; surfaces?: HelpScreen["surface"][] };
const staff: readonly Role[] = ["owner", "admin", "operations", "onboarding", "finance", "viewer"];
const everyone: readonly Role[] = [...staff, "partner"];
const companyEditors: readonly Role[] = ["owner", "admin", "onboarding"];
const productionEditors: readonly Role[] = ["owner", "admin", "operations"];
const documentEditors: readonly Role[] = ["owner", "admin", "operations", "onboarding"];
const organizationAdmins: readonly Role[] = ["owner", "admin"];
const staffViews: HelpScreen["view"][] = ["agency", "production"];
const allViews: HelpScreen["view"][] = [...staffViews, "partner"];

const catalog: CatalogGuide[] = [
  {
    id: "help:navigation", title: "Find your way around", page: "Overview", views: staffViews,
    roles: staff, question: "What is the difference between Agency and Production?",
    summary: "Agency organizes companies and business operations. Production organizes title files and requests.",
    steps: [
      "Use Agency or Production under Your workspace to switch views.",
      "In Agency, use Companies for company profiles, ownership and documents; use Onboarding for company evidence reviews.",
      "In Production, use Orders for title files, Inbox for incoming requests, and Policy workbench for source review and policy preparation.",
      "Use Settings → Account to see your signed-in account and assigned company access.",
    ],
    note: "Switching views does not grant company access or editing permissions. If an action is unavailable, ask your workspace administrator to review your role and company assignment.",
  },
  {
    id: "help:company-profile", title: "Complete an imported company profile", page: "Companies", views: staffViews,
    roles: companyEditors, surfaces: ["company"], question: "How do I finish a company imported from Missive?",
    summary: "Imported inbox names are starting points. Verify company details against the original records.",
    steps: [
      "Open Companies, select the company, then choose Overview → Complete company profile. Completed imported profiles instead offer Edit company profile.",
      "Verify Company name against its documents and check I verified the legal company name against its documents only after checking it.",
      "Enter the confirmed Primary contact, Contact email, City and Initial operating state. Leave facts you do not know blank.",
      "Choose Save company profile. Use Members for ownership and Documents for original records; additional operating states belong in Jurisdictions.",
    ],
    note: "Owners, administrators and onboarding staff can edit assigned companies. This completion form is for imported profiles; saving profile basics does not approve ownership, licensing or company setup.",
  },
  {
    id: "help:company-status", title: "Active business, unfinished setup", page: "Companies", views: staffViews,
    roles: staff, surfaces: ["company"], question: "Why is an Active company still asking for documents?",
    summary: "Active can describe an already operating business while its workspace records remain incomplete.",
    steps: [
      "Open Companies, select the company and look at Overview.",
      "Review Company status separately from Company profile needs completion and the Workspace setup checklist.",
      "Use Documents for its records, Members for ownership and Open evidence review for the company's review checklist when your access permits.",
    ],
    note: "Confirming existing operations does not create ownership details, verify licensing or complete evidence reviews. Ask an organization-wide administrator if the operating status is incorrect.",
  },
  {
    id: "help:upload-documents", title: "Upload originals to the right company", page: "Documents", views: staffViews,
    roles: documentEditors, surfaces: ["company", "document"], question: "Where do I upload company documents?",
    summary: "Company Documents keeps original files and their reviews together.",
    steps: [
      "Open Companies, select the company, then Documents → Upload. You can also start from the Document vault's Upload button.",
      "Choose documents and confirm Company. Choose Company documents only for company records, or the correct Linked order for a title file.",
      "For a linked order choose the correct Source type. Review Category and Document access; Applications use Restricted access.",
      "Choose Save documents and wait for the save result before leaving. Open the saved file to preview or download its original.",
    ],
    note: "The upload form accepts up to 10 files, 25 MB each and 100 MB per batch. Authorized originals stay private in the connected workspace; uploads do not email or publish files. Reusing a filename for the same company and linked order creates a new version. Local sample mode is browser-only and should use fictional files.",
  },
  {
    id: "help:find-documents", title: "Find documents and requested materials", page: "Documents", views: staffViews,
    roles: staff, surfaces: ["company", "document"], question: "Are materials and documents in the same place?",
    summary: "Each company has one Documents tab for files, scanning, requests and approvals.",
    steps: [
      "Open Companies, select the company, then Documents to see its files.",
      "Open a file to preview the version and use Download for its original bytes.",
      "Expand Requests and approvals to see requested logos, disclosure templates, title preference forms and their preparation or review history.",
      "Use the main Documents page to find accessible files across your assigned companies.",
    ],
    note: "A file can be present without an approval or partner publication. If a record is missing, check the company and your assigned access rather than creating a duplicate.",
  },
  {
    id: "help:material-request", title: "Request and approve company materials", page: "Companies", views: staffViews,
    roles: companyEditors, surfaces: ["company"], question: "How do I request a logo or disclosure form?",
    summary: "Requests and approvals tracks the requested content, responsible person and reviewed file version.",
    steps: [
      "Open Companies → select company → Documents and expand Requests and approvals.",
      "Choose Request material, or Set up standard checklist for the standard company materials.",
      "Record the responsible person and Requested content and branding. Link the correct company document, set Awaiting review and choose Save preparation.",
      "Compare the saved material and linked file, add the required review note and confirmation, then choose Approve material when the review is complete.",
    ],
    note: "Only permitted company editors can prepare or approve materials. Approval is separate from company setup and partner publication. A new source version needs a fresh review.",
  },
  {
    id: "help:scan-package", title: "Scan a whole document package", page: "Documents", views: staffViews,
    roles: documentEditors, surfaces: ["company", "order", "document"], question: "How do I scan a long document or package?",
    summary: "Read document package scans selected originals and saves progress in the private workspace.",
    steps: [
      "Upload originals to the correct company and title file first. Open the company's Documents tab, or a title file's Final sources, then choose Read document package.",
      "Select the originals belonging to this review and choose Open saved package review.",
      "Choose Scan every page and keep the review open. Read the physical-page progress and any unread-page warnings.",
      "Use Pause scanning to stop after the current saved batch. Reopen the same originals and choose Resume / retry unread pages to continue confirmed progress.",
    ],
    note: "A package supports at most 1,000 physical pages, 100 originals, 25 MB per original, 500 MB total and five million retained text characters. Originals remain unchanged. Scanning does not continue after the review/browser closes; saved batches remain available. A page with no readable evidence still needs human inspection.",
  },
  {
    id: "help:review-scan", title: "Check and correct scanned suggestions", page: "Documents", views: staffViews,
    roles: documentEditors, surfaces: ["order", "document", "company"], question: "How do I check whether the scan pulled the right information?",
    summary: "Every proposed value must be checked against its original page before it is accepted.",
    steps: [
      "Open the saved package review. Use Review category to focus the results and Show fields with no supported evidence to find gaps.",
      "For a suggestion, choose Compare page with original and inspect its exact quote, physical page, document type and context.",
      "Correct the reviewed value if necessary, add a Review note, and confirm I compared this value and its document context against the original page.",
      "Choose Accept reviewed value or Save corrected value. Use Reject suggestion with a note for incorrect evidence; inspect conflicts and unread pages instead of guessing.",
    ],
    note: "The assistant has not read your originals. OCR and extracted suggestions are not guaranteed correct or legal approval. New pages can reveal conflicts and clear earlier field decisions. Uploading examples does not automatically train a model.",
  },
  {
    id: "help:company-scan-capture", title: "Use reviewed company details", page: "Companies", views: staffViews,
    roles: companyEditors, surfaces: ["company", "document"], question: "How do I fill a company profile from its scanned documents?",
    summary: "Reviewed company suggestions can prefill supported fields for a deliberate profile edit.",
    steps: [
      "In an imported company's Documents tab, open Read document package and review each supported company suggestion against the original.",
      "Accept or correct the supported legal company name, primary contact or contact email, then choose Use reviewed company details.",
      "Review the prefilled company form, confirm the name and choose Save company profile. Supply any remaining facts from confirmed records.",
    ],
    note: "This prefill does not fill city, operating states, members or ownership percentages. It does not approve licensing or onboarding. If the company, original or access changed, reopen the current package before applying suggestions.",
  },
  {
    id: "help:title-scan-capture", title: "Capture reviewed title fields", page: "Orders", views: ["production"],
    roles: productionEditors, surfaces: ["order", "document"], question: "How do I put reviewed scan results into a title file?",
    summary: "Capture reviewed source fields first, then complete the file's normal review.",
    steps: [
      "Open the title file's Final sources. Check that each original has the correct Source type before scanning the package.",
      "Compare and accept or correct supported suggestions, then choose Capture reviewed fields from the relevant original.",
      "Inspect the capture form, source reference and every value against the original. Confirm the comparison and save deliberately.",
      "Alternatively, use Capture fields on the original, then Find field suggestions, and review the suggested values before saving.",
    ],
    note: "Captured source values still require file review. Saving them does not automatically change the borrower's name or loan on an order, issue a policy or update SoftPro. Issued files use a separate correction workflow.",
  },
  {
    id: "help:read-document-text", title: "Read one original's text", page: "Documents", views: staffViews,
    roles: staff, surfaces: ["document"], question: "How do I read or copy the text of one document?",
    summary: "The original preview offers a separate single-document reader with page citations.",
    steps: [
      "Open an accessible original in Documents, then choose Read document text → Read whole document.",
      "Select a physical page to inspect its text beside the original. Use the page controls to retry unread pages or reread a rotated scan.",
      "Compare any excerpt with the original before copying it with its citation. Use the package review workflow when supported field suggestions are needed.",
    ],
    note: "This single-document reader is limited to 120 pages, 25 MB and 500,000 retained characters. Its temporary scan session clears when closed or reloaded. The separate Read document package workflow supports larger packages and saved progress for authorized document staff.",
  },
  {
    id: "help:new-order", title: "Create a title file", page: "Orders", views: ["production"],
    roles: productionEditors, surfaces: ["order"], question: "How do I start a new title order?",
    summary: "Create the order under the correct company and assign a staff account with access to it.",
    steps: [
      "Switch to Production, open Orders and choose New order.",
      "Confirm the company, property and transaction details. Select an active staff member under Assigned to and check the due date.",
      "Choose Create order, open the file and use Final sources → Upload files to attach original records with their correct Source type.",
    ],
    note: "Owners, administrators and operations staff can create orders for assigned companies. If no staff are available, an administrator must assign access. Estimated premiums are planning figures; order creation does not issue a policy.",
  },
  {
    id: "help:revisions", title: "Review a requested file change", page: "Revisions", views: ["production"],
    roles: productionEditors, surfaces: ["order"], question: "How do I change a loan amount or another title-file field?",
    summary: "Capture the instruction as a revision and compare it with the current file before applying it.",
    steps: [
      "Open Production → Revisions → New revision. Capture the source instruction, correct company and title file, and the specific field or loan being changed.",
      "Review the requested and current values. Confirm the company, file, property and source instruction.",
      "If the file changed, use Refresh comparison and review it again. If the named loan is no longer active, hold for clarification rather than applying the change to another loan.",
      "Choose Apply reviewed change, then Open reply drafts to review the prepared response and required attachment.",
    ],
    note: "This changes the reviewed workspace records. The official commitment still needs regeneration in SoftPro by an authorized operator; the app does not write it there.",
  },
  {
    id: "help:policy-review", title: "Prepare a policy review package", page: "Policy workbench", views: ["production"],
    roles: productionEditors, surfaces: ["order"], question: "What do I check before preparing a policy?",
    summary: "Use the workbench to review sources and required checks before preparing a review package.",
    steps: [
      "Open Production → Policy workbench and select the correct file.",
      "Inspect Source package, uploaded originals, captured values and every outstanding requirement or exception.",
      "Compare each proposed value with the original and complete the required review confirmations only after the responsible reviewer has checked them.",
      "Use Prepare review package when the app's checks allow it, then follow the authorized operator and underwriter process.",
    ],
    note: "Ready means app checks passed; it is not a legal title opinion or authority to issue. The assistant cannot clear title, decide coverage, issue an insurer's policy or operate SoftPro.",
  },
  {
    id: "help:missive-import", title: "Review and import Missive messages", page: "Settings", views: staffViews,
    roles: organizationAdmins, question: "How do I bring a Missive email into the correct title file?",
    summary: "An organization-wide administrator reviews inbox routing and the destination before importing a message.",
    steps: [
      "Open Settings → Connections and use Check Missive connection. If setup is required, the administrator verifies the credential in the connection form; never paste it into assistant chat.",
      "Confirm the Missive team inbox and Destination company, then Save reviewed inbox routing. Select the correct active Inbox and company route.",
      "Choose Browse inbox queue, select Conversation and Email message, then choose the correct Title file and Request type.",
      "Confirm the reviewed company, file and request type, then Import reviewed message text. Save needed attachments to documents through the imported-message section.",
    ],
    note: "Only the owner or an administrator with all-company access manages this connection. Company-scoped administrators must ask an organization-wide administrator. Reads and reviewed imports do not write Missive messages or drafts; inbox routing requires its own review.",
  },
  {
    id: "help:reply-drafts", title: "Review a reply without sending", page: "Revisions", views: ["production"],
    roles: productionEditors, surfaces: ["order"], question: "Will a reply draft send an email or change Missive?",
    summary: "Replies remain internal drafts in Title Software. Sending is off.",
    steps: [
      "Open Production → Revisions → Reply drafts and select the draft for the correct file.",
      "Review the recipient, subject and Reply draft text. Generate any official revised commitment in SoftPro and attach the correct current version using Upload copy.",
      "Use Preview attachment and check it against the reviewed change before choosing Approve local draft.",
      "Use Export draft if you need the text. Download the attachment separately from its preview.",
    ],
    note: "Approve local draft records internal review only. It does not send email, create a draft in Missive, or write SoftPro. Exported draft text does not include attachment bytes. Sending needs a separate tested rollout.",
  },
  {
    id: "help:invite", title: "Invite a teammate and check email status", page: "Settings", views: staffViews,
    roles: organizationAdmins, question: "How do I invite someone, and why did no email arrive?",
    summary: "Preparing workspace access and sending a setup email are separate steps.",
    steps: [
      "An organization-wide administrator opens Settings → Team & access and enters the exact Invitation email, role and permitted companies.",
      "Choose Prepare access invitation, then find that invitation under Access invitations.",
      "Click Send setup email if available. Preparing, editing or renewing the invitation alone does not send email.",
      "Use Refresh and read the invitation's status. Verify the recipient's exact address and check their inbox or quarantine; provider acceptance does not confirm inbox delivery.",
    ],
    note: "Only the owner manages all-company access, restricted evidence access and administrator grants. Company-scoped administrators cannot manage this page. If email delivery needs owner setup or the result is uncertain, ask the owner to inspect it instead of repeatedly sending. Do not share passwords or authenticator codes.",
  },
  {
    id: "help:sign-in", title: "Sign in and finish account setup", page: "Settings", views: allViews,
    roles: everyone, question: "How do I sign in or finish setting up my password?",
    summary: "Cloudflare access, your workspace password and your authenticator are separate sign-in steps.",
    steps: [
      "Open the private workspace using the exact email that was invited. Complete the Cloudflare email-code step when shown.",
      "For first-time setup, open the setup email's sign-in link in the same browser. Alternatively enter the invited email and choose Set up or reset password, leaving Password blank.",
      "Follow the emailed link, choose your own password and complete Set up your authenticator when prompted.",
      "For later sign-ins, use your personal password and the current six-digit code from your authenticator app. If signed in without assigned workspace access, ask the owner to review the invitation and company assignment.",
    ],
    note: "Use a unique password with at least 12 characters. Never paste your password, setup key, email code or authenticator code into chat or feedback. An email delivery failure or lost authenticator needs account support; the assistant cannot bypass sign-in.",
  },
  {
    id: "help:feedback", title: "Send developer feedback", page: "Settings", views: allViews,
    roles: everyone, question: "How do I report something confusing or broken?",
    summary: "Feedback privately sends the workspace owner your message and the page you were using.",
    steps: [
      "Use the Feedback button at the bottom of the workspace and choose Send feedback.",
      "Choose the feedback kind. Explain what you were trying to do, what happened and what you expected.",
      "Choose Send feedback, then follow the saved status and replies in My feedback. The owner sees Feedback inbox.",
    ],
    note: "Feedback includes your message, email and page. Screenshots and documents are not attached automatically. Leave passwords, API keys and client details out; upload authorized originals through Documents instead.",
  },
  {
    id: "help:tasks", title: "Assign and follow up on a task", page: "Tasks", views: staffViews,
    roles: ["owner", "admin", "operations", "onboarding", "finance"], question: "How do I assign a task or show that I am waiting on someone?",
    summary: "Tasks keeps the company, responsible staff member and next follow-up together.",
    steps: [
      "Open Tasks → New task. Enter the Task, select Company and Owner, check the Due date and choose Create task.",
      "Use the owner filter to find your assigned work and open linked company or title-file context when provided.",
      "When blocked, record what you are Waiting on, the Detail and Waiting since, then Mark waiting. When resolved, record What unblocked it and choose Record resolution.",
    ],
    note: "Choose an active staff account with access to the selected company. Recording a task or waiting status does not send a message or complete the underlying business review.",
  },
  {
    id: "help:partner-navigation", title: "Use your partner portal", page: "Partner portal", views: ["partner"],
    roles: ["partner"], question: "Where do I find my company's information?",
    summary: "The partner portal shows the company activity, statements and documents shared with your account.",
    steps: [
      "Open Partner portal and use Your company to select an assigned company.",
      "Choose the reporting month to review the available activity and statements.",
      "Use Settings → Account to check your signed-in account. Ask the workspace owner if a company or publication you expect is missing.",
    ],
    note: "Partner access is limited to assigned companies and approved publications for your recorded member identity. The portal does not grant staff editing access or access to internal and restricted originals.",
  },
  {
    id: "help:partner-documents", title: "Download a shared company document", page: "Partner portal", views: ["partner"],
    roles: ["partner"], surfaces: ["document"], question: "How do I download a document shared with me?",
    summary: "Published company documents contains the exact file versions reviewed for your audience.",
    steps: [
      "Open Partner portal and select the correct company with Your company.",
      "Find Published company documents and select the document to open its preview.",
      "Use Download to retrieve the approved version. If a file is unavailable, ask the company team to review the current publication and your access.",
    ],
    note: "An internal upload or a newer private version does not automatically appear here. A withdrawn or replaced publication can stop being available; the assistant cannot restore it or widen your access.",
  },
];

/** Stable source membership: screen hints only rank starters, never the guide set. */
export function helpGuides(role: string): HelpGuide[] {
  return catalog.filter(guide => guide.roles.includes(role as Role)).map(guide => ({
    id: guide.id, title: guide.title, page: guide.page, views: [...guide.views],
    question: guide.question, summary: guide.summary, steps: [...guide.steps],
    ...(guide.note ? { note: guide.note } : {}),
  }));
}

export function suggestedHelpGuides(role: string, screen: HelpScreen): HelpGuide[] {
  const current = parseHelpScreen(screen);
  const rank = (guide: HelpGuide) => {
    const entry = catalog.find(item => item.id === guide.id)!;
    return (guide.page === current.page ? 8 : 0) +
      (guide.views.includes(current.view) ? 2 : 0) +
      (current.surface && current.surface !== "page" && entry.surfaces?.includes(current.surface) ? 6 : 0);
  };
  return helpGuides(role).sort((left, right) => rank(right) - rank(left)).slice(0, 3);
}
