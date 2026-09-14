import { traceMutation, commandUuid } from "./command-log";
import type { Company, Workspace } from "./model";

/**
 * Effective-dated member ownership (S09).
 *
 * A company's `members` array is what ownership looks like *today*. A monthly
 * close, though, allocates profit for a period that may have ended before the
 * shares changed. Without dated records, closing April in June would allocate
 * April's profit on June's ownership.
 *
 * Records are append-only snapshots of the whole member set, each effective
 * from a stated date. Nothing here is inferred: when no record covers a
 * period, the app says so and falls back to current ownership visibly rather
 * than guessing what the shares used to be.
 */

export type OwnershipMember = { name: string; share: number };

export type OwnershipRecord = {
  id: string;
  companyId: string;
  /** YYYY-MM-DD. This record governs from this date until the next one. */
  effectiveFrom: string;
  /** True for the first record of a company: the opening position, not a change. */
  opening: boolean;
  members: OwnershipMember[];
  reason: string;
  recordedBy: string;
  recordedAt: string;
};

export type OwnershipResolution = {
  members: OwnershipMember[];
  /** The record that governs, or null when none covers the date. */
  record: OwnershipRecord | null;
  /** "record" when a dated record governs; "current" when it fell back to today's members. */
  source: "record" | "current";
  /** True when history exists for this company but starts after the date asked about. */
  beforeHistory: boolean;
};

const now = () => new Date().toISOString();
const dayValid = (v: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString().slice(0, 10) === v;
const monthValid = (v: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

const actor = (s: Workspace) => {
  if (!s.user.trim()) throw new Error("Choose the operator recording this work.");
  return s.user;
};

/** The last calendar day of a YYYY-MM reporting month. */
export function monthEnd(month: string) {
  if (!monthValid(month)) throw new Error("Choose a valid reporting month.");
  const [year, m] = month.split("-").map(Number);
  return new Date(Date.UTC(year, m, 0)).toISOString().slice(0, 10);
}

export function ownershipHistory(s: Workspace, companyId?: string) {
  return (s.ownershipHistory || [])
    .filter((r) => companyId === undefined || r.companyId === companyId)
    .sort(
      (a, b) =>
        a.effectiveFrom.localeCompare(b.effectiveFrom) || a.recordedAt.localeCompare(b.recordedAt),
    );
}

const currentMembers = (c: Company): OwnershipMember[] =>
  c.members.map(({ name, share }) => ({ name, share }));

/** Ownership in effect on a given calendar date. */
export function ownershipAsOf(
  s: Workspace,
  company: Company,
  date: string,
): OwnershipResolution {
  const history = ownershipHistory(s, company.id);
  if (!history.length)
    return { members: currentMembers(company), record: null, source: "current", beforeHistory: false };
  const governing = [...history]
    .reverse()
    .find((r) => r.effectiveFrom <= date);
  if (!governing)
    return {
      members: currentMembers(company),
      record: null,
      source: "current",
      beforeHistory: true,
    };
  return {
    members: governing.members.map(({ name, share }) => ({ name, share })),
    record: governing,
    source: "record",
    beforeHistory: false,
  };
}

/**
 * Ownership governing a monthly close: the position at the end of the
 * reporting month, not the position today.
 */
export function ownershipForMonth(s: Workspace, company: Company, month: string) {
  return ownershipAsOf(s, company, monthEnd(month));
}

function validateMembers(members: OwnershipMember[]) {
  if (!members.length) throw new Error("Record at least one member.");
  for (const m of members) {
    if (!m.name.trim()) throw new Error("Every member needs a name.");
    if (!Number.isFinite(m.share) || m.share <= 0 || m.share > 100)
      throw new Error("Every member's interest must be above zero and at most 100 percent.");
  }
  const names = members.map((m) => m.name.trim().toLowerCase());
  if (new Set(names).size !== names.length)
    throw new Error("Each member can only appear once in an ownership record.");
  const total = members.reduce((n, m) => n + m.share, 0);
  // Tolerance matches the hundredth-of-a-percent the member editor allows.
  if (Math.abs(total - 100) > 0.01)
    throw new Error("Member interests must total 100 percent.");
}

export function recordOwnership(
  s: Workspace,
  companyId: string,
  input: { effectiveFrom: string; members: OwnershipMember[]; reason: string },
  at = new Date(),
) {
  return traceMutation(s, "recordOwnership", [companyId, input], () => {
    const company = s.companies.find((c) => c.id === companyId);
    if (!company) throw new Error("That company is no longer on file.");
    const effectiveFrom = input.effectiveFrom.trim();
    const reason = input.reason.trim();
    if (!dayValid(effectiveFrom))
      throw new Error("Enter the date this ownership took effect.");
    if (effectiveFrom > at.toISOString().slice(0, 10))
      throw new Error("Ownership cannot be recorded as effective in the future.");
    if (!reason) throw new Error("Record why the ownership is what it is.");
    const members = input.members.map((m) => ({
      name: m.name.trim(),
      share: Math.round(m.share * 100) / 100,
    }));
    validateMembers(members);
    const history = ownershipHistory(s, companyId);
    if (history.some((r) => r.effectiveFrom === effectiveFrom))
      throw new Error("This company already has an ownership record effective that date.");
    const opening = !history.length;
    if (!opening && effectiveFrom < history[0].effectiveFrom)
      throw new Error(
        "An ownership change cannot pre-date the opening record. Correct the opening record's date first.",
      );
    const record: OwnershipRecord = {
      id: `own-${commandUuid().slice(0, 8)}`,
      companyId,
      effectiveFrom,
      opening,
      members,
      reason,
      recordedBy: actor(s),
      recordedAt: now(),
    };
    s.ownershipHistory = [...(s.ownershipHistory || []), record];
    return record;
  });
}

/**
 * Closes that were published on ownership other than the dated record now
 * governing their month. Reported, never auto-corrected: a published
 * allocation is frozen, and changing one is a reviewed revision.
 */
export function ownershipDrift(s: Workspace) {
  const closes = s.business?.closes || [];
  return closes.flatMap((p) => {
    if (p.status !== "Published") return [];
    const company = s.companies.find((c) => c.id === p.companyId);
    if (!company) return [];
    const resolved = ownershipForMonth(s, company, p.month);
    if (resolved.source !== "record") return [];
    // Compare only the fields that decide an allocation. A close captured
    // from an older snapshot may carry member email/phone alongside the
    // name and share; that is not a change in ownership.
    const normalise = (members: OwnershipMember[]) =>
      JSON.stringify(
        [...members]
          .map(({ name, share }) => ({ name, share }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
    const same = normalise(p.members) === normalise(resolved.members);
    return same
      ? []
      : [
          {
            closeId: p.id,
            companyId: p.companyId,
            companyName: p.companyName,
            month: p.month,
            revision: p.revision,
            published: p.members,
            governing: resolved.members,
            effectiveFrom: resolved.record!.effectiveFrom,
          },
        ];
  });
}

const memberShape = (v: unknown): v is OwnershipMember => {
  if (!v || typeof v !== "object") return false;
  const m = v as Record<string, unknown>;
  return typeof m.name === "string" && typeof m.share === "number";
};

const recordShape = (v: unknown): v is OwnershipRecord => {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.companyId === "string" &&
    typeof r.effectiveFrom === "string" &&
    typeof r.opening === "boolean" &&
    typeof r.reason === "string" &&
    typeof r.recordedBy === "string" &&
    typeof r.recordedAt === "string" &&
    Array.isArray(r.members) &&
    r.members.every(memberShape)
  );
};

export function isValidOwnershipHistory(v: unknown) {
  return v === undefined || (Array.isArray(v) && v.every(recordShape));
}

/**
 * Ownership records are evidence a close was allocated against. They are
 * append-only and never edited in place.
 */
export function validateOwnershipMutation(before: Workspace, after: Workspace) {
  if (!isValidOwnershipHistory(after.ownershipHistory))
    throw new Error("That ownership record is not in a shape this workspace can store.");
  const rows = after.ownershipHistory || [];
  const seen = new Set<string>();
  for (const r of rows) {
    const key = `${r.companyId}::${r.effectiveFrom}`;
    if (seen.has(key))
      throw new Error("A company can only have one ownership record effective on a date.");
    seen.add(key);
    const total = r.members.reduce((n, m) => n + m.share, 0);
    if (Math.abs(total - 100) > 0.01)
      throw new Error("Every ownership record must total 100 percent.");
    if (!r.members.length)
      throw new Error("Every ownership record must name at least one member.");
  }
  for (const companyId of new Set(rows.map((r) => r.companyId))) {
    const forCompany = rows
      .filter((r) => r.companyId === companyId)
      .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
    if (forCompany.filter((r) => r.opening).length !== 1)
      throw new Error("A company's ownership history has exactly one opening record.");
    if (!forCompany[0].opening)
      throw new Error("The opening ownership record must be the earliest one.");
  }
  for (const prior of before.ownershipHistory || []) {
    const current = rows.find((x) => x.id === prior.id);
    if (!current)
      throw new Error("Ownership history is evidence for past closes and stays on file.");
    if (JSON.stringify(current) !== JSON.stringify(prior))
      throw new Error(
        "A recorded ownership position cannot be edited. Record a later change instead.",
      );
  }
}
