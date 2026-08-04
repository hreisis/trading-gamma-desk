import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export function listDriverSessionDates(dataRoot = "data"): string[] {
  const dir = join(dataRoot, "drivers");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.replace(/\.json$/, ""))
    .filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name))
    .sort();
}

/** Latest macro driver session on disk — explicit date required for aligned surfaces. */
export function resolveLatestMarketSessionDate(
  dataRoot = "data",
): string | null {
  const sessions = listDriverSessionDates(dataRoot);
  return sessions.length > 0 ? sessions[sessions.length - 1]! : null;
}

export function resolveExplicitMarketSessionDate(input: {
  readonly sessionDate?: string | null;
  readonly dataRoot?: string;
}): string | null {
  const explicit = (input.sessionDate ?? "").trim();
  if (explicit) return explicit;
  return resolveLatestMarketSessionDate(input.dataRoot ?? "data");
}
