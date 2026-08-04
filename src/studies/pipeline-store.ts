import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ZodType } from "zod";
import { writeJsonAtomic } from "@/desk/atomic-write";
import { deepEqualJson } from "@/gamma/deep-equal";

export class StudyPipelineStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudyPipelineStoreError";
  }
}

export function encodeStudyIdForPath(studyId: string): string {
  return studyId.replace(/\|/g, "__");
}

export function studyDefinitionRelPath(
  sessionDate: string,
  symbol: string,
): string {
  return join(
    "studies",
    "definitions",
    sessionDate,
    symbol,
    "study-definition.json",
  );
}

export function studyForwardOutcomeRelPath(
  studyId: string,
  priceAsOf: string,
): string {
  return join(
    "studies",
    "outcomes",
    encodeStudyIdForPath(studyId),
    priceAsOf,
    "forward-outcome.json",
  );
}

export function similarRegimeStudyRelPath(
  sessionDate: string,
  symbol: string,
): string {
  return join(
    "studies",
    "similar-regime",
    sessionDate,
    symbol,
    "similar-regime-study.json",
  );
}

export function studyEvidenceBundleRelPath(
  sessionDate: string,
  symbol: string,
): string {
  return join(
    "studies",
    "evidence",
    sessionDate,
    symbol,
    "evidence-bundle.json",
  );
}

export function studyPipelineRunRelPath(sessionDate: string): string {
  return join("studies", "pipeline", sessionDate, "run.json");
}

export function studyDefinitionPath(
  dataRoot: string,
  sessionDate: string,
  symbol: string,
): string {
  return join(dataRoot, studyDefinitionRelPath(sessionDate, symbol));
}

export function studyForwardOutcomePath(
  dataRoot: string,
  studyId: string,
  priceAsOf: string,
): string {
  return join(dataRoot, studyForwardOutcomeRelPath(studyId, priceAsOf));
}

export function similarRegimeStudyPath(
  dataRoot: string,
  sessionDate: string,
  symbol: string,
): string {
  return join(dataRoot, similarRegimeStudyRelPath(sessionDate, symbol));
}

export function studyEvidenceBundlePath(
  dataRoot: string,
  sessionDate: string,
  symbol: string,
): string {
  return join(dataRoot, studyEvidenceBundleRelPath(sessionDate, symbol));
}

export function studyPipelineRunPath(
  dataRoot: string,
  sessionDate: string,
): string {
  return join(dataRoot, studyPipelineRunRelPath(sessionDate));
}

export function readJsonArtifact<T>(path: string, schema: ZodType<T>): T {
  if (!existsSync(path)) {
    throw new StudyPipelineStoreError(`artifact not found: ${path}`);
  }
  return schema.parse(JSON.parse(readFileSync(path, "utf8")));
}

/**
 * Validated atomic write. Idempotent when an identical artifact already exists.
 */
export function writeStudyArtifact<T>(
  path: string,
  schema: ZodType<T>,
  artifact: T,
): T {
  const validated = schema.parse(artifact);

  if (existsSync(path)) {
    const existing = schema.parse(JSON.parse(readFileSync(path, "utf8")));
    if (!deepEqualJson(existing, validated)) {
      throw new StudyPipelineStoreError(
        `artifact already exists with different payload: ${path}`,
      );
    }
    return validated;
  }

  writeJsonAtomic(path, validated);
  return validated;
}
