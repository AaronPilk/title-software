import { commandUuid } from "./command-log";
import {
  enrichWorkspace,
  type TitleFile,
  type RevisionRequest,
  type FieldRevision,
  type ReplyDraft,
  type SourceRole,
} from "./production";
import { enrichBusiness, type BusinessState } from "./business";
export type Page =
  | "Overview"
  | "Assistant"
  | "Inbox"
  | "Orders"
  | "Policy workbench"
  | "Commitments"
  | "Policy products"
  | "Handoffs"
  | "Revisions"
  | "Companies"
  | "Onboarding"
  | "Documents"
  | "Tasks"
  | "Financials"
  | "Partner portal"
  | "Automations"
  | "Settings";
export type OrderStatus =
  | "New"
  | "In progress"
  | "Needs review"
  | "Ready for jacket"
  | "Issued"
  | "Rejected";
export type AuthorityRecord = {
  state: string;
  kind: string;
  status: string;
  reference: string;
  reviewer: string;
};
export type Company = {
  id: string;
  name: string;
  initials: string;
  color: string;
  contact: string;
  email: string;
  location: string;
  jurisdiction: string;
  formationState?: string;
  operatingStates?: string[];
  authorizations?: AuthorityRecord[];
  stage: string;
  steps: boolean[];
  members: { name: string; share: number; email?: string; phone?: string }[];
};
export type Field = {
  documentId?: string;
  sourcePage?: string;
  id: string;
  label: string;
  current: string;
  proposed: string;
  source: string;
  sourceValue: string;
  reviewed: boolean;
  confidence: string;
};
export const orderOutcomeKinds = [
  "Rejected",
  "Contacted",
  "Recovery lost",
  "Recovered",
  "Closing recorded",
] as const;
export type OrderOutcomeKind = (typeof orderOutcomeKinds)[number];
export type Order = {
  receivedAt?: string;
  outcomes?: {
    kind: OrderOutcomeKind;
    date: string;
    note: string;
    actor: string;
  }[];
  production?: TitleFile;
  id: string;
  companyId: string;
  address: string;
  client: string;
  type: string;
  underwriter: string;
  owner: string;
  jurisdiction: string;
  delivered: boolean;
  remitted: boolean;
  status: OrderStatus;
  due: string;
  premium: number;
  rate: number;
  month: string;
  fields: Field[];
  notes: string;
  exception: string;
};
export type VaultDoc = {
  publicationBlocked?: boolean;
  policyId?: string;
  policyVersion?: number;
  commitmentVersion?: number;
  cplId?: string;
  cplVersion?: number;
  correctionId?: string;
  preparationFingerprint?: string;
  parentDocumentId?: string;
  productionVersion?: number;
  sourceRole?: SourceRole;
  id: string;
  companyId: string;
  orderId?: string;
  name: string;
  category: string;
  visibility: "Internal" | "Restricted" | "Partner";
  date: string;
  size: string;
  version: number;
  text?: string;
  assetId?: string;
  mime?: string;
};
export type Task = {
  id: string;
  title: string;
  companyId: string;
  owner: string;
  due: string;
  done: boolean;
  priority: "High" | "Normal";
  /** Absent on tasks saved before creation dates were recorded; age stays unknown rather than guessed. */
  createdAt?: string;
  /** Append-only record of what this task waited on, and for how long. */
  waiting?: import("./task-clock").TaskWaitingPeriod[];
};
export type MissiveProvenance = {
  organizationId: string; teamId: string; conversationId: string; messageId: string;
  companyId: string; orderId: string; mappingVersion: number;
  receivedAt: string; importedAt: string; importedBy: string; fingerprint: string;
  sourceDocumentId: string;
  attachments: { id: string; name: string; mime: string; bytes: number; status: "not_downloaded" }[];
};
export type Mail = {
  missive?: MissiveProvenance;
  sourceReference?: string;
  kind?: "Revision" | "Finals" | "Company" | "Commitment";
  companyId?: string;
  documentIds?: string[];
  id: string;
  from: string;
  email: string;
  subject: string;
  body: string;
  time: string;
  orderId: string;
  status: "New" | "Queued" | "Archived";
  attachments: string[];
};
export type Activity = {
  id: string;
  title: string;
  detail: string;
  at: string;
  actor: string;
};
export type Rule = {
  id: string;
  name: string;
  description: string;
  trigger: string;
  action: string;
  enabled: boolean;
  runs: number;
  lastRun: string;
};
/**
 * Column targets for the accounting CSV import scaffold (J06-J07). This is
 * deliberately a preview/mapping tool only — see AccountingImport — until
 * John's actual books and accounting vendor are confirmed; nothing here
 * posts to a close, ledger or remittance.
 */
export const importTargetFields = [
  "Date",
  "Description",
  "Amount",
  "Category",
  "Ignore",
] as const;
export type ImportTargetField = (typeof importTargetFields)[number];
export type ImportTemplate = {
  id: string;
  name: string;
  createdAt: string;
  /** CSV header text (as it appeared in that file) -> target field. */
  columnMap: Record<string, ImportTargetField>;
};
/** Server-derived company activity only; contains no file or member details. */
export type PartnerCompanyPeriodSummary = {
  companyId: string;
  period: string;
  received: number;
  pending: number;
  closingRecorded: number;
  rejected: number;
  recovered: number;
  lost: number;
};
export type PartnerOperationalSummary = {
  asOfDate: string;
  /** Event months plus the current month. Quiet months carry pending forward. */
  rows: PartnerCompanyPeriodSummary[];
};
export type Workspace = {
  /** Read-only projection; never an authoritative source or a saved approval. */
  partnerSummary?: PartnerOperationalSummary;
  statementDeliveries?: import("./statement-delivery").StatementDelivery[];
  deliveries?: import("./delivery-ledger").DocumentDelivery[];
  materials?: import("./materials").MaterialsState;
  business?: BusinessState;
  revisions: RevisionRequest[];
  fieldRevisions: FieldRevision[];
  replyDrafts: ReplyDraft[];
  importTemplates: ImportTemplate[];
  version: 1;
  companies: Company[];
  orders: Order[];
  documents: VaultDoc[];
  tasks: Task[];
  inbox: Mail[];
  activity: Activity[];
  rules: Rule[];
  user: string;
  approvedReports: string[];
  expenses: Record<string, number>;
  expansionStates: string[];
};
export const onboardingSteps = [
  "Application received",
  "Company formation",
  "EIN received",
  "Licensing review",
  "Underwriter approval",
  "Company materials",
  "Ready to launch",
];
export const onboardingOwner = (step: number) =>
  [0, 1, 2, 5, 6].includes(step) ? "Stephenie" : "John";
export const moneyCents = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
export const people = ["Stephenie", "Tyler", "John"];
export const money = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
export const uid = (prefix: string) => `${prefix}-${commandUuid().slice(0, 8)}`;
export const companyById = (state: Workspace, id: string) =>
  state.companies.find((c) => c.id === id)!;
const fields = (name: string): Field[] =>
  [
    {
      id: "name",
      label: "Vesting / grantee name",
      current: name,
      proposed: `${name.split(" ")[0]} Taylor ${name.split(" ")[1]}, a single person`,
      source: "Recorded deed · page 1",
      reviewed: false,
      confidence: "High",
    },
    {
      id: "date",
      label: "Recording date",
      current: "September 8, 2026",
      proposed: "September 9, 2026",
      source: "Recording stamp · page 1",
      reviewed: false,
      confidence: "High",
    },
    {
      id: "time",
      label: "Recording time",
      current: "—",
      proposed: "2:43 PM",
      source: "Recording stamp · page 1",
      reviewed: false,
      confidence: "High",
    },
    {
      id: "reference",
      label: "Book / page reference",
      current: "Pending",
      proposed: "Book 1842 · Page 316",
      source: "Recording stamp · page 1",
      reviewed: false,
      confidence: "High",
    },
    {
      id: "trustee",
      label: "Trustee wording",
      current: "Pending",
      proposed: "Jordan Ellis, Trustee",
      source: "Deed of trust · page 2",
      reviewed: false,
      confidence: "Review required",
    },
  ].map((f) => ({ ...f, sourceValue: f.proposed }));
export function createSeed(): Workspace {
  const companies: Company[] = [
    {
      id: "c1",
      name: "Evergreen Title",
      initials: "ET",
      color: "teal",
      contact: "Emma Brooks",
      email: "emma@example.com",
      location: "Charlotte, NC",
      jurisdiction: "NC",
      stage: "Active",
      steps: Array(7).fill(true),
      members: [
        { name: "Emma Brooks", share: 60 },
        { name: "Title Group", share: 40 },
      ],
    },
    {
      id: "c2",
      name: "Harbor Title Group",
      initials: "HT",
      color: "blue",
      contact: "Daniel Reed",
      email: "daniel@example.com",
      location: "Charleston, SC",
      jurisdiction: "SC",
      stage: "Active",
      steps: Array(7).fill(true),
      members: [
        { name: "Daniel Reed", share: 50 },
        { name: "Title Group", share: 50 },
      ],
    },
    {
      id: "c3",
      name: "Summit Closing Co.",
      initials: "SC",
      color: "violet",
      contact: "Olivia Chen",
      email: "olivia@example.com",
      location: "Raleigh, NC",
      jurisdiction: "NC",
      stage: "Onboarding",
      steps: [true, true, true, false, false, false, false],
      members: [
        { name: "Olivia Chen", share: 60 },
        { name: "Title Group", share: 40 },
      ],
    },
    {
      id: "c4",
      name: "Foundry Title",
      initials: "FT",
      color: "amber",
      contact: "James Parker",
      email: "james@example.com",
      location: "Greenville, SC",
      jurisdiction: "SC",
      stage: "Onboarding",
      steps: [true, false, false, false, false, false, false],
      members: [
        { name: "James Parker", share: 50 },
        { name: "Title Group", share: 50 },
      ],
    },
    {
      id: "c5",
      name: "Oak & Stone Title",
      initials: "OS",
      color: "rose",
      contact: "Avery Miller",
      email: "avery@example.com",
      location: "Wilmington, NC",
      jurisdiction: "NC",
      stage: "Active",
      steps: Array(7).fill(true),
      members: [
        { name: "Avery Miller", share: 45 },
        { name: "Title Group", share: 55 },
      ],
    },
  ];
  const orders: Order[] = [
    {
      id: "T-2026-1048",
      companyId: "c1",
      address: "284 Maple Avenue",
      client: "Alex Morgan",
      type: "Purchase",
      underwriter: "WFG",
      owner: "Tyler",
      jurisdiction: "NC",
      delivered: false,
      remitted: false,
      status: "Needs review",
      due: "2026-09-11",
      premium: 1860,
      rate: 0.4,
      month: "2026-09",
      fields: fields("Alex Morgan"),
      notes:
        "Final deed and deed of trust received. Confirm exact vesting before preparing the jacket.",
      exception: "",
    },
    {
      id: "T-2026-1047",
      companyId: "c2",
      address: "912 Harbor Lane",
      client: "Casey Wilson",
      type: "Refinance",
      underwriter: "Commonwealth",
      owner: "Tyler",
      jurisdiction: "SC",
      delivered: false,
      remitted: false,
      status: "Needs review",
      due: "2026-09-11",
      premium: 1420,
      rate: 0.4,
      month: "2026-09",
      fields: fields("Casey Wilson"),
      notes: "Recording stamp is partially obscured. Request a legible copy.",
      exception: "Recording stamp needs a clearer copy",
    },
    {
      id: "T-2026-1046",
      companyId: "c5",
      address: "56 Willow Court",
      client: "Riley Bennett",
      type: "Purchase",
      underwriter: "WFG",
      owner: "John",
      jurisdiction: "NC",
      delivered: false,
      remitted: false,
      status: "Ready for jacket",
      due: "2026-09-12",
      premium: 2240,
      rate: 0.4,
      month: "2026-09",
      fields: fields("Riley Bennett").map((f) => ({ ...f, reviewed: true })),
      notes: "All proposed changes reviewed. Awaiting underwriter handoff.",
      exception: "",
    },
    {
      id: "T-2026-1045",
      companyId: "c1",
      address: "730 Parkside Drive",
      client: "Jamie Collins",
      type: "Purchase",
      underwriter: "Commonwealth",
      owner: "Tyler",
      jurisdiction: "NC",
      delivered: false,
      remitted: false,
      status: "In progress",
      due: "2026-09-14",
      premium: 1675,
      rate: 0.4,
      month: "2026-09",
      fields: fields("Jamie Collins"),
      notes: "Waiting for recorded documents from the attorney.",
      exception: "",
    },
    {
      id: "T-2026-1044",
      companyId: "c2",
      address: "18 Westbrook Way",
      client: "Drew Taylor",
      type: "Refinance",
      underwriter: "WFG",
      owner: "Tyler",
      jurisdiction: "SC",
      delivered: false,
      remitted: false,
      status: "New",
      due: "2026-09-15",
      premium: 1180,
      rate: 0.4,
      month: "2026-09",
      fields: [],
      notes: "New order. Intake review needed.",
      exception: "",
    },
    {
      id: "T-2026-1043",
      companyId: "c5",
      address: "642 Cedar Street",
      client: "Jordan Hayes",
      type: "Purchase",
      underwriter: "Commonwealth",
      owner: "John",
      jurisdiction: "NC",
      delivered: false,
      remitted: false,
      status: "Issued",
      due: "2026-09-09",
      premium: 2150,
      rate: 0.4,
      month: "2026-09",
      fields: [],
      notes: "Demo policy recorded as issued.",
      exception: "",
    },
    {
      id: "T-2026-1042",
      companyId: "c1",
      address: "305 Meadow Road",
      client: "Cameron Lee",
      type: "Purchase",
      underwriter: "WFG",
      owner: "Tyler",
      jurisdiction: "NC",
      delivered: false,
      remitted: false,
      status: "Issued",
      due: "2026-09-08",
      premium: 1970,
      rate: 0.4,
      month: "2026-09",
      fields: [],
      notes: "Demo policy recorded as issued.",
      exception: "",
    },
    {
      id: "T-2026-1041",
      companyId: "c2",
      address: "87 Riverside Drive",
      client: "Taylor Quinn",
      type: "Purchase",
      underwriter: "WFG",
      owner: "Tyler",
      jurisdiction: "SC",
      delivered: false,
      remitted: false,
      status: "Rejected",
      due: "2026-09-07",
      premium: 0,
      rate: 0.4,
      month: "2026-09",
      fields: [],
      notes: "Attorney selected another provider. Follow-up assigned.",
      exception: "Attorney selected another title provider",
    },
    {
      id: "T-2026-1038",
      companyId: "c1",
      address: "412 Elm Street",
      client: "Sam Rivera",
      type: "Purchase",
      underwriter: "WFG",
      owner: "John",
      jurisdiction: "NC",
      delivered: false,
      remitted: false,
      status: "Issued",
      due: "2026-08-27",
      premium: 2450,
      rate: 0.4,
      month: "2026-08",
      fields: [],
      notes: "August demo order.",
      exception: "",
    },
    {
      id: "T-2026-1035",
      companyId: "c5",
      address: "90 Rosewood Lane",
      client: "Robin Blake",
      type: "Refinance",
      underwriter: "Commonwealth",
      owner: "John",
      jurisdiction: "NC",
      delivered: false,
      remitted: false,
      status: "Issued",
      due: "2026-08-21",
      premium: 1630,
      rate: 0.4,
      month: "2026-08",
      fields: [],
      notes: "August demo order.",
      exception: "",
    },
  ];
  const documents: VaultDoc[] = companies.flatMap((c, i) => [
    {
      id: `d${i}-1`,
      companyId: c.id,
      name: "Company overview.txt",
      category: "Company records",
      visibility: "Partner" as const,
      date: "2026-09-10",
      size: "2 KB",
      version: 1,
      text: `DEMO DOCUMENT — FICTIONAL COMPANY\n\n${c.name}\nPrimary contact: ${c.contact}\nEmail: ${c.email}\n\nThis is a sample company overview for the local TitleOS prototype. No real filing, license, policy, or personal information is represented.`,
    },
    {
      id: `d${i}-2`,
      companyId: c.id,
      name: "Formation checklist.txt",
      category: "Formation",
      visibility: "Internal" as const,
      date: "2026-09-09",
      size: "1 KB",
      version: 1,
      text: `DEMO DOCUMENT\n\n${c.name} — formation checklist\n\nConfirm legal name and jurisdiction.\nRecord formation status and document reference.\nStore EIN documentation in restricted company records.\nAssign licensing review to John.\n\nThis is a sample workflow, not a legal filing.`,
    },
    {
      id: `d${i}-3`,
      companyId: c.id,
      name: "Application reference.txt",
      category: "Applications",
      visibility: "Restricted" as const,
      date: "2026-09-08",
      size: "1 KB",
      version: 1,
      text: `DEMO APPLICATION REFERENCE\n\n${c.name}\nContact: ${c.contact}\n\nSensitive identity fields are intentionally absent. Real applications will remain in an approved secure intake system until access controls and data storage are implemented.`,
    },
  ]);
  documents.push({
    id: "deed1",
    companyId: "c1",
    orderId: orders[0].id,
    name: "Recorded deed — sample.txt",
    category: "Policy documents",
    visibility: "Internal",
    date: "2026-09-09",
    size: "2 KB",
    version: 1,
    text: "FICTIONAL REVIEW EXCERPT — NOT A RECORDED INSTRUMENT\n\nProperty: 284 Maple Avenue\nGrantee: Alex Taylor Morgan, a single person\nRecorded: September 9, 2026 at 2:43 PM\nBook: 1842   Page: 316\nTrustee (separate deed of trust): Jordan Ellis, Trustee\n\nAll text is synthetic and supplied only to demonstrate document comparison.",
  });
  return enrichBusiness(
    enrichWorkspace({
      revisions: [],
      fieldRevisions: [],
      replyDrafts: [],
      importTemplates: [],
      version: 1,
      companies,
      orders,
      documents,
      user: "Stephenie",
      approvedReports: [],
      expenses: {},
      expansionStates: [],
      tasks: [
        {
          id: "task1",
          title: "Review final-policy changes",
          companyId: "c1",
          owner: "Tyler",
          due: "2026-09-11",
          done: false,
          priority: "High",
        },
        {
          id: "task2",
          title: "Request a clearer recording stamp",
          companyId: "c2",
          owner: "Tyler",
          due: "2026-09-11",
          done: false,
          priority: "High",
        },
        {
          id: "task3",
          title: "Complete licensing review",
          companyId: "c3",
          owner: "John",
          due: "2026-09-12",
          done: false,
          priority: "Normal",
        },
        {
          id: "task4",
          title: "Collect formation documents",
          companyId: "c4",
          owner: "Stephenie",
          due: "2026-09-14",
          done: false,
          priority: "Normal",
        },
        {
          id: "task5",
          title: "Prepare September reconciliation",
          companyId: "c1",
          owner: "John",
          due: "2026-09-30",
          done: false,
          priority: "Normal",
        },
      ],
      inbox: [
        {
          id: "m1",
          from: "Morgan & Reed Law",
          email: "closings@example.com",
          subject: "Final documents · T-2026-1048",
          body: "Hi Tyler,\n\nPlease find the final recorded deed and deed of trust for 284 Maple Avenue. Please confirm the recording information and prepare the final policy for review.\n\nThank you,\nMorgan & Reed closing team",
          time: "9:42 AM",
          orderId: "T-2026-1048",
          status: "New",
          attachments: [
            "Recorded deed — sample.txt",
            "Deed of trust — sample excerpt",
          ],
        },
        {
          id: "m2",
          from: "Westfield Legal",
          email: "team@example.com",
          subject: "Recording copy · T-2026-1047",
          body: "Hello,\n\nThe recorded document for 912 Harbor Lane is attached. The lower-right corner of the stamp may be difficult to read. Please let us know if another copy is needed.\n\nWestfield Legal",
          time: "9:18 AM",
          orderId: "T-2026-1047",
          status: "New",
          attachments: ["Recording stamp — sample excerpt"],
        },
        {
          id: "m3",
          from: "Olivia Chen",
          email: "olivia@example.com",
          subject: "Summit Closing Co. — EIN documents",
          body: "Hi Stephenie,\n\nThe sample company formation and EIN materials are ready. Please add these to our onboarding file and confirm the next steps.\n\nOlivia",
          time: "Yesterday",
          orderId: "",
          status: "New",
          attachments: ["EIN checklist — sample.txt"],
        },
      ],
      activity: [
        {
          id: "a1",
          title: "Final documents received",
          detail: "284 Maple Avenue · ready for Tyler",
          at: "2026-09-11T09:42:00",
          actor: "Tyler",
        },
        {
          id: "a2",
          title: "Summit formation completed",
          detail: "Stephenie completed company formation",
          at: "2026-09-11T09:15:00",
          actor: "Stephenie",
        },
        {
          id: "a3",
          title: "Policy ready for jacket",
          detail: "56 Willow Court · John completed review",
          at: "2026-09-10T16:40:00",
          actor: "John",
        },
      ],
      rules: [
        {
          id: "intake",
          name: "Prepare incoming policy requests",
          description:
            "Match known order numbers and place requests in the review queue.",
          trigger: "New policy email",
          action: "Queue for review",
          enabled: true,
          runs: 0,
          lastRun: "Never",
        },
        {
          id: "onboarding",
          name: "Keep onboarding moving",
          description:
            "Create a task for the next incomplete step for every onboarding company.",
          trigger: "Onboarding check",
          action: "Assign next step",
          enabled: true,
          runs: 0,
          lastRun: "Never",
        },
        {
          id: "exceptions",
          name: "Follow up on rejected orders",
          description:
            "Create a review task so the company can understand lost business.",
          trigger: "Rejected order",
          action: "Create follow-up",
          enabled: false,
          runs: 0,
          lastRun: "Never",
        },
      ],
    }),
  );
}
