import type { Workspace } from "./model";

export type DraftEdit = {
  table: string;
  id: string;
  value: Record<string, unknown>;
  insert?: boolean;
};
export type WorkspaceCommand = { id: string; name: string; args: unknown[] };
type Capture = {
  anchor: Workspace;
  commands: WorkspaceCommand[];
  depth: number;
};
const captures = new WeakMap<Workspace, Capture>();
let sequence: { seed: string; counter: number } | undefined;
export function commandUuid(): string {
  if (!sequence) return crypto.randomUUID();
  const input = `${sequence.seed}:${sequence.counter++}`;
  const hash = (salt: number) => {
    let value = (2166136261 ^ salt) >>> 0;
    for (const c of input)
      value = Math.imul(value ^ c.charCodeAt(0), 16777619) >>> 0;
    return value.toString(16).padStart(8, "0");
  };
  const raw = hash(0) + hash(1) + hash(2) + hash(3);
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-4${raw.slice(13, 16)}-8${raw.slice(17, 20)}-${raw.slice(20)}`;
}
export function withCommandIds<T>(id: string, fn: () => T): T {
  const previous = sequence;
  sequence = { seed: id, counter: 0 };
  try {
    return fn();
  } finally {
    sequence = previous;
  }
}
const tables = [
  "companies",
  "orders",
  "documents",
  "tasks",
  "inbox",
  "rules",
  "revisions",
  "fieldRevisions",
  "replyDrafts",
  "importTemplates",
  "statementDeliveries",
  "deliveries",
  "ownershipHistory",
  "business.policies",
  "business.commitments",
  "business.cpls",
  "business.onboarding",
  "business.credentials",
  "business.closes",
  "business.handoffs",
  "business.corrections",
  "business.followups",
  "materials.items",
  "materials.publications",
];
function rows(s: Workspace, path: string): Record<string, unknown>[] {
  return path.split(".").reduce<any>((o, key) => o?.[key], s) || [];
}
const identity = (row: Record<string, unknown>) =>
  String(row.id || row.companyId || row.orderId || "");
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
function flush(s: Workspace, capture: Capture) {
  const edits: DraftEdit[] = [];
  for (const table of tables) {
    const before = rows(capture.anchor, table),
      after = rows(s, table);
    for (const row of before)
      if (!after.some((r) => identity(r) === identity(row)))
        throw new Error(
          "Use the record's supported cancellation action instead of deleting history.",
        );
    for (const row of after) {
      const prior = before.find((r) => identity(r) === identity(row));
      if (!prior)
        edits.push({
          table,
          id: identity(row),
          insert: true,
          value: structuredClone(row),
        });
      else {
        const patch: Record<string, unknown> = {};
        for (const key of new Set([...Object.keys(prior), ...Object.keys(row)]))
          if (!same(prior[key], row[key]))
            patch[key] =
              row[key] === undefined ? null : structuredClone(row[key]);
        if (Object.keys(patch).length)
          edits.push({ table, id: identity(row), value: patch });
      }
    }
  }
  for (const table of [
    "expenses",
    "expansionStates",
    "approvedReports",
    "user",
  ] as const)
    if (!same(capture.anchor[table], s[table]))
      edits.push({
        table,
        id: "",
        value: { value: structuredClone(s[table]) },
      });
  if (edits.length)
    capture.commands.push({
      id: crypto.randomUUID(),
      name: "editDraft",
      args: [edits],
    });
  capture.anchor = structuredClone(s);
}
export function captureCommands(s: Workspace, fn: (s: Workspace) => void) {
  const capture: Capture = {
    anchor: structuredClone(s),
    commands: [],
    depth: 0,
  };
  captures.set(s, capture);
  try {
    fn(s);
    flush(s, capture);
    return capture.commands;
  } finally {
    captures.delete(s);
  }
}
/** Capture only outermost domain actions. The backend independently allowlists and validates them. */
export function traceMutation<T>(
  s: Workspace,
  name: string,
  args: unknown[],
  fn: () => T,
): T {
  const capture = captures.get(s);
  if (!capture || capture.depth) return fn();
  flush(s, capture);
  const command = {
    id: crypto.randomUUID(),
    name,
    args: structuredClone(args),
  };
  capture.depth++;
  try {
    const result = withCommandIds(command.id, fn);
    capture.commands.push(command);
    capture.anchor = structuredClone(s);
    return result;
  } finally {
    capture.depth--;
  }
}
