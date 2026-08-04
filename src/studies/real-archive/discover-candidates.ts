import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DominantDriver } from "@/contracts";
import { driverRelPath } from "./paths";

export class RealArchiveDiscoverError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RealArchiveDiscoverError";
  }
}

export interface DriverCandidate {
  readonly sessionDate: string;
  readonly driverPath: string;
  readonly driverRelativePath: string;
}

/**
 * Discover candidate sessions from data/drivers/*.json.
 * Validates filename ↔ marketSessionDate alignment — never infers from filename alone.
 */
export function discoverDriverCandidates(dataRoot: string): DriverCandidate[] {
  const driversDir = join(dataRoot, "drivers");
  if (!existsSync(driversDir)) {
    return [];
  }

  const out: DriverCandidate[] = [];
  for (const file of readdirSync(driversDir)) {
    if (!file.endsWith(".json") || file.startsWith(".")) continue;
    const sessionDate = file.slice(0, -".json".length);
    const driverPath = join(driversDir, file);
    const driverRelativePath = driverRelPath(sessionDate);

    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(driverPath, "utf8"));
    } catch (cause) {
      throw new RealArchiveDiscoverError(
        `invalid JSON in ${driverRelativePath}: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }

    const parsed = DominantDriver.safeParse(raw);
    if (!parsed.success) {
      throw new RealArchiveDiscoverError(
        `schema-invalid driver at ${driverRelativePath}: ${parsed.error.issues[0]?.message ?? "validation"}`,
      );
    }

    if (parsed.data.marketSessionDate !== sessionDate) {
      throw new RealArchiveDiscoverError(
        `driver filename ${sessionDate} != marketSessionDate ${parsed.data.marketSessionDate} at ${driverRelativePath}`,
      );
    }

    out.push({ sessionDate, driverPath, driverRelativePath });
  }

  return out.sort((a, b) =>
    a.sessionDate < b.sessionDate ? -1 : a.sessionDate > b.sessionDate ? 1 : 0,
  );
}

export function filterCandidatesThrough(
  candidates: readonly DriverCandidate[],
  throughDate: string,
): { readonly included: DriverCandidate[]; readonly future: DriverCandidate[] } {
  const included: DriverCandidate[] = [];
  const future: DriverCandidate[] = [];
  for (const c of candidates) {
    if (c.sessionDate > throughDate) {
      future.push(c);
    } else {
      included.push(c);
    }
  }
  return { included, future };
}

export function defaultEvaluationInstants(sessionDate: string): string[] {
  return [
    `${sessionDate}T14:00:00.000Z`,
    `${sessionDate}T16:00:00.000Z`,
    `${sessionDate}T20:00:00.000Z`,
  ];
}

export function sessionCutoffIso(sessionDate: string): string {
  return `${sessionDate}T23:59:59.999Z`;
}
