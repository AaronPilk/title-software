/**
 * The company's business calendar.
 *
 * The agencies work in North and South Carolina. A UTC calendar day flips at
 * 8pm Eastern, so anything that decides "is this due today" or "is this date
 * in the future" from `toISOString()` is wrong for five hours every evening:
 * a task due the 14th reads as a day overdue while it is still the 14th in
 * Charlotte. Every countdown, date bound and capture comparison goes through
 * here so the app agrees with the Overview about what day it is.
 */

const TIME_ZONE = "America/New_York";

/** Today on the company's calendar, as YYYY-MM-DD. */
export function businessDay(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)!.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

/** The current reporting month on the company's calendar, as YYYY-MM. */
export function businessPeriod(now: Date = new Date()): string {
  return businessDay(now).slice(0, 7);
}

/** True for a well-formed YYYY-MM-DD calendar date. */
export function isCalendarDay(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  );
}

/** A calendar date as a whole day number, for comparing and subtracting dates. */
export function dayNumber(value: string): number {
  return Math.floor(Date.parse(`${value}T00:00:00Z`) / 86_400_000);
}

/** Whole days from one calendar date to another; never negative. */
export function daysBetween(from: string, to: string): number {
  return Math.max(0, dayNumber(to) - dayNumber(from));
}

/**
 * The business day an ISO timestamp fell on. Used to compare a stored
 * `createdAt` or `preparedAt` against calendar dates the operator typed.
 */
export function businessDayOf(timestamp: string): string {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return "";
  return businessDay(new Date(parsed));
}
