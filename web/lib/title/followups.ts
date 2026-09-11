import type { Workspace, Order } from "./model";
import { business, enrichBusiness, today, products } from "./business";
import {
  orderSources,
  productionLocked,
  titleFile,
  type SourceRole,
} from "./production";

export type AttorneyFollowup = {
  id: string;
  companyId: string;
  orderId: string;
  messageId: string;
  owner: string;
  to: string;
  body: string;
  createdAt: string;
  status: "Draft" | "Waiting for attorney" | "Resolved" | "Cancelled";
  sentReference: string;
  items: {
    id: string;
    label: string;
    role: SourceRole;
    status: "Outstanding" | "Resolved" | "Cancelled";
    documentId: string;
    responseMessageId: string;
    note: string;
    resolvedAt: string;
  }[];
};
export function createFollowup(
  s: Workspace,
  orderId: string,
  input: {
    body: string;
    owner: string;
    messageId: string;
    items: { label: string; role: SourceRole }[];
  },
) {
  const o = s.orders.find((o) => o.id === orderId);
  if (!o || productionLocked(s, o))
    throw new Error("Choose an unissued file for attorney follow-up.");
  if (
    !input.body.trim() ||
    !input.owner.trim() ||
    !input.items.length ||
    input.items.some((i) => !i.label.trim())
  )
    throw new Error("Enter the request, owner and outstanding items.");
  if (
    input.messageId &&
    !s.inbox.some(
      (m) =>
        m.id === input.messageId &&
        m.orderId === o.id &&
        (!m.companyId || m.companyId === o.companyId),
    )
  )
    throw new Error("Choose an original message linked to this file.");
  enrichBusiness(s);
  const existing = business(s).followups.find(
    (r) =>
      r.orderId === orderId &&
      !["Resolved", "Cancelled"].includes(r.status) &&
      r.body.trim() === input.body.trim(),
  );
  if (existing) return existing.id;
  const id = `followup-${crypto.randomUUID()}`;
  business(s).followups.unshift({
    id,
    companyId: o.companyId,
    orderId,
    messageId: input.messageId,
    owner: input.owner.trim(),
    to: titleFile(o).attorneyEmail,
    body: input.body.trim(),
    createdAt: new Date().toISOString(),
    status: "Draft",
    sentReference: "",
    items: input.items.map((i) => ({
      ...i,
      id: crypto.randomUUID(),
      status: "Outstanding",
      documentId: "",
      responseMessageId: "",
      note: "",
      resolvedAt: "",
    })),
  });
  s.tasks.unshift({
    id: `task-${id}`,
    companyId: o.companyId,
    title: `Attorney follow-up · ${o.id}`,
    owner: input.owner.trim(),
    due: today(),
    priority: "High",
    done: false,
  });
  o.production = {
    ...titleFile(o),
    version: titleFile(o).version + 1,
    commitmentReview: undefined,
  };
  if (o.status === "Ready for jacket") o.status = "Needs review";
  return id;
}
export function recordFollowupSent(
  s: Workspace,
  requestId: string,
  reference: string,
) {
  const r = business(s).followups.find((r) => r.id === requestId);
  if (!r || r.status !== "Draft" || !reference.trim())
    throw new Error(
      "Record the approved-channel send reference for this draft.",
    );
  r.sentReference = reference.trim();
  r.status = "Waiting for attorney";
}
export function resolveFollowupItem(
  s: Workspace,
  requestId: string,
  itemId: string,
  input: { documentId: string; responseMessageId: string; note: string },
) {
  const r = business(s).followups.find((r) => r.id === requestId),
    item = r?.items.find((i) => i.id === itemId),
    o = s.orders.find((o) => o.id === r?.orderId);
  if (
    !r ||
    !item ||
    !o ||
    item.status !== "Outstanding" ||
    productionLocked(s, o)
  )
    throw new Error("Choose an outstanding item on an unissued file.");
  const doc = orderSources(s, o.id).find((d) => d.id === input.documentId);
  const message = s.inbox.find(
    (m) =>
      m.id === input.responseMessageId &&
      m.orderId === o.id &&
      (!m.companyId || m.companyId === o.companyId),
  );
  if (!input.note.trim() || (!doc && !message))
    throw new Error(
      "Link the received source or response message and record its review note.",
    );
  if (input.documentId && !doc)
    throw new Error(
      "The document must be current and belong to this company and file.",
    );
  if (input.responseMessageId && !message)
    throw new Error("The response must belong to this company and file.");
  if (item.role !== "Other" && (!doc || doc.sourceRole !== item.role))
    throw new Error(
      `Attach the current ${item.role} to resolve this document request.`,
    );
  Object.assign(item, input, {
    status: "Resolved",
    resolvedAt: new Date().toISOString(),
  });
  for (const f of o.fields) f.reviewed = false;
  o.production = {
    ...titleFile(o),
    version: titleFile(o).version + 1,
    commitmentReview: undefined,
  };
  if (o.status === "Ready for jacket") o.status = "Needs review";
  if (r.items.every((i) => i.status !== "Outstanding")) {
    r.status = "Resolved";
    const task = s.tasks.find((t) => t.id === `task-${r.id}`);
    if (task) task.done = true;
  }
}
export function cancelFollowupItem(
  s: Workspace,
  requestId: string,
  itemId: string,
  reason: string,
) {
  const r = business(s).followups.find((r) => r.id === requestId),
    item = r?.items.find((i) => i.id === itemId),
    o = s.orders.find((o) => o.id === r?.orderId);
  if (
    !r ||
    !item ||
    !o ||
    item.status !== "Outstanding" ||
    productionLocked(s, o) ||
    !reason.trim()
  )
    throw new Error(
      "Select an outstanding item and document why it is no longer needed.",
    );
  item.status = "Cancelled";
  item.note = reason.trim();
  item.resolvedAt = new Date().toISOString();
  o.production = {
    ...titleFile(o),
    version: titleFile(o).version + 1,
    commitmentReview: undefined,
  };
  for (const f of o.fields) f.reviewed = false;
  if (o.status === "Ready for jacket") o.status = "Needs review";
  if (r.items.every((i) => i.status !== "Outstanding")) {
    r.status = r.items.every((i) => i.status === "Cancelled")
      ? "Cancelled"
      : "Resolved";
    const task = s.tasks.find((t) => t.id === `task-${r.id}`);
    if (task) task.done = true;
  }
}
export function partnerPeriod(s: Workspace, companyId: string, month: string) {
  const all = s.orders.filter((o) => o.companyId === companyId);
  const eventInMonth = (
    o: Order,
    kind: "Rejected" | "Recovered" | "Closing recorded",
  ) => o.outcomes?.some((e) => e.kind === kind && e.date.slice(0, 7) === month);
  const received = all.filter((o) => o.receivedAt?.slice(0, 7) === month);
  const issued = all.filter((o) => {
    const ps = products(s, o.id);
    return ps.length
      ? ps.some(
          (p) =>
            ["Issued", "Delivered"].includes(p.status) &&
            p.issuedMonth === month,
        )
      : o.status === "Issued" && o.month === month;
  });
  const rejected = all.filter((o) => eventInMonth(o, "Rejected")),
    recovered = all.filter((o) => eventInMonth(o, "Recovered")),
    closed = all.filter((o) => eventInMonth(o, "Closing recorded"));
  const ids = new Set(
    [...received, ...issued, ...rejected, ...recovered, ...closed].map(
      (o) => o.id,
    ),
  );
  return {
    received,
    issued,
    rejected,
    recovered,
    closed,
    orders: all.filter((o) => ids.has(o.id)),
    unknownReceived: all.filter((o) => !o.receivedAt).length,
  };
}
