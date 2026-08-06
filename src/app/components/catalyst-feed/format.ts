import { AMERICA_NEW_YORK } from "@/catalyst/timezone";

export function formatScheduledAt(iso: string): string {
  return iso.replace("T", " ").replace(/\.\d+/, "");
}

/** Wall-clock Eastern Time for schedule / release display. */
export function formatScheduledAtEt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return formatScheduledAt(iso);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: AMERICA_NEW_YORK,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  const month = get("month");
  const day = get("day");
  const year = get("year");
  const hour = get("hour");
  const minute = get("minute");
  const dayPeriod = get("dayPeriod");
  return `${month} ${day}, ${year} · ${hour}:${minute} ${dayPeriod} ET`;
}

/** Compact schedule label for signal scan rows (e.g. Aug 12). */
export function formatScheduledShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return formatScheduledAt(iso);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: AMERICA_NEW_YORK,
    month: "short",
    day: "numeric",
  }).formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("month")} ${get("day")}`;
}

export function formatPct(pct: number | null | undefined): string {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return "—";
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

export function windowShort(w: string): string {
  if (w === "5m") return "+5m";
  if (w === "30m") return "+30m";
  if (w === "2h") return "+2h";
  if (w === "session_close") return "close";
  return w;
}
