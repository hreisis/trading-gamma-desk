export function formatScheduledAt(iso: string): string {
  return iso.replace("T", " ").replace(/\.\d+/, "");
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
