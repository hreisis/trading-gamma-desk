import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DominantDriver, type DominantDriver as DominantDriverType } from "@/contracts";
import { isSessionStale } from "./load-macro-desk";
import type { ArtifactIntegrityIssue } from "@/contracts/artifact-integrity";

export interface SessionDriverLoadResult {
  readonly driver: DominantDriverType | null;
  readonly driverPath: string | null;
  readonly issues: readonly ArtifactIntegrityIssue[];
}

function driverPath(dataRoot: string, sessionDate: string): string {
  return join(dataRoot, "drivers", `${sessionDate}.json`);
}

/**
 * Load DominantDriver for an exact session date only — no latest, no fixture fallback.
 */
export function loadSessionDriver(
  sessionDate: string,
  dataRoot = "data",
): SessionDriverLoadResult {
  const path = driverPath(dataRoot, sessionDate);
  const issues: ArtifactIntegrityIssue[] = [];

  if (!existsSync(path)) {
    issues.push({
      artifact: "driver",
      severity: "missing",
      message: `No macro driver artifact for session ${sessionDate}.`,
      path,
    });
    return { driver: null, driverPath: path, issues };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    issues.push({
      artifact: "driver",
      severity: "invalid",
      message: `Macro driver artifact is not valid JSON: ${message}`,
      path,
    });
    return { driver: null, driverPath: path, issues };
  }

  const parsed = DominantDriver.safeParse(raw);
  if (!parsed.success) {
    issues.push({
      artifact: "driver",
      severity: "invalid",
      message: `Macro driver failed contract validation: ${parsed.error.issues[0]?.message ?? "schema"}`,
      path,
    });
    return { driver: null, driverPath: path, issues };
  }

  const driver = parsed.data;
  if (driver.marketSessionDate !== sessionDate) {
    issues.push({
      artifact: "driver",
      severity: "mismatched",
      message: `Driver marketSessionDate ${driver.marketSessionDate} != requested ${sessionDate}.`,
      path,
    });
  }

  if (isSessionStale(driver)) {
    issues.push({
      artifact: "driver",
      severity: "stale",
      message: `Macro driver for ${sessionDate} is incomplete, misaligned, or stale.`,
      path,
    });
  }

  return { driver, driverPath: path, issues };
}
