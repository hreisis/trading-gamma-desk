import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DominantDriver, type DominantDriver as DominantDriverType } from "@/contracts";
import { isSessionStale } from "./load-macro-desk";
import type { ArtifactIntegrityIssue } from "@/contracts/artifact-integrity";
import {
  artifactSourceLabel,
  readJson,
  type RuntimeJsonStore,
} from "./runtime-store";

export interface SessionDriverLoadResult {
  readonly driver: DominantDriverType | null;
  readonly driverPath: string | null;
  readonly issues: readonly ArtifactIntegrityIssue[];
}

function driverRelativePath(sessionDate: string): string {
  return `drivers/${sessionDate}.json`;
}

function driverPath(dataRoot: string, sessionDate: string): string {
  return join(dataRoot, "drivers", `${sessionDate}.json`);
}

function parseSessionDriverRaw(
  sessionDate: string,
  pathLabel: string,
  raw: unknown,
): SessionDriverLoadResult {
  const issues: ArtifactIntegrityIssue[] = [];
  const parsed = DominantDriver.safeParse(raw);
  if (!parsed.success) {
    issues.push({
      artifact: "driver",
      severity: "invalid",
      message: `Macro driver failed contract validation: ${parsed.error.issues[0]?.message ?? "schema"}`,
      path: pathLabel,
    });
    return { driver: null, driverPath: pathLabel, issues };
  }

  const driver = parsed.data;
  if (driver.marketSessionDate !== sessionDate) {
    issues.push({
      artifact: "driver",
      severity: "mismatched",
      message: `Driver marketSessionDate ${driver.marketSessionDate} != requested ${sessionDate}.`,
      path: pathLabel,
    });
  }

  if (isSessionStale(driver)) {
    issues.push({
      artifact: "driver",
      severity: "stale",
      message: `Macro driver for ${sessionDate} is incomplete, misaligned, or stale.`,
      path: pathLabel,
    });
  }

  return { driver, driverPath: pathLabel, issues };
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

  return parseSessionDriverRaw(sessionDate, path, raw);
}

export async function loadSessionDriverAsync(
  sessionDate: string,
  artifactStore: RuntimeJsonStore,
): Promise<SessionDriverLoadResult> {
  const relativePath = driverRelativePath(sessionDate);
  const pathLabel = artifactSourceLabel(artifactStore, relativePath);
  const raw = await readJson(artifactStore, relativePath);

  if (raw === null) {
    return {
      driver: null,
      driverPath: pathLabel,
      issues: [
        {
          artifact: "driver",
          severity: "missing",
          message: `No macro driver artifact for session ${sessionDate}.`,
          path: pathLabel,
        },
      ],
    };
  }

  return parseSessionDriverRaw(sessionDate, pathLabel, raw);
}
