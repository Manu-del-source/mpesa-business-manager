import { formatDistanceToNowStrict, format } from "date-fns";

/** Anything that can be rendered as money — number, string or a Decimal-like. */
export type Money = number | string | { toNumber(): number };

function toNumber(value: Money): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return parseFloat(value);
  return value.toNumber();
}

const kesFormatter = new Intl.NumberFormat("en-KE", {
  style: "currency",
  currency: "KES",
  maximumFractionDigits: 0,
});

const kesCompactFormatter = new Intl.NumberFormat("en-KE", {
  style: "currency",
  currency: "KES",
  notation: "compact",
  maximumFractionDigits: 1,
});

const kesExactFormatter = new Intl.NumberFormat("en-KE", {
  style: "currency",
  currency: "KES",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** KSh 1,250 */
export function formatKES(value: Money): string {
  return kesFormatter.format(toNumber(value));
}

/** KSh 1.2M — for dashboard KPIs */
export function formatCompactKES(value: Money): string {
  return kesCompactFormatter.format(toNumber(value));
}

/** KSh 1,250.50 — for receipts / statements */
export function formatKESExact(value: Money): string {
  return kesExactFormatter.format(toNumber(value));
}

/** 12 Aug 2026 */
export function formatDate(date: Date | string): string {
  return format(new Date(date), "d MMM yyyy");
}

/** 12 Aug 2026, 14:30 */
export function formatDateTime(date: Date | string): string {
  return format(new Date(date), "d MMM yyyy, HH:mm");
}

/** Aug 2026 */
export function formatMonth(date: Date | string): string {
  return format(new Date(date), "MMM yyyy");
}

/** 2h ago */
export function formatRelative(date: Date | string): string {
  return formatDistanceToNowStrict(new Date(date), { addSuffix: true });
}

/** 07XX XXX XXX (local display) or 2547XX… (normalized) */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return "—";
  if (phone.startsWith("2547") && phone.length === 12) {
    return `0${phone.slice(3, 6)} ${phone.slice(6, 9)} ${phone.slice(9)}`;
  }
  return phone;
}

/** "KES" constant used across labels */
export const KES = "KSh";
