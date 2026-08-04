import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  StudyDefinition,
  StudyEvidenceBundle,
  StudyForwardOutcome,
  StudyMemo,
  StudyPipelineRun,
  SimilarRegimeStudy,
} from "@/contracts";
import {
  parseStudyPipelineArgs,
  readJsonArtifact,
  runStudyPipeline,
  studyEvidenceBundlePath,
  studyPipelineRunPath,
} from "@/studies";

const MANIFEST = "fixtures/studies/pipeline.m64.json";
const SESSION_DATE = "2026-07-29";
const SYMBOL = "SPY";

describe("M6-4 study pipeline", () => {
  it("parses CLI args with required date and manifest", () => {
    const args = parseStudyPipelineArgs([
      "--date",
      SESSION_DATE,
      "--manifest",
      MANIFEST,
    ]);
    expect(args.sessionDate).toBe(SESSION_DATE);
    expect(args.manifestPath).toBe(MANIFEST);
    expect(args.dryRun).toBe(false);
  });

  it("requires explicit --manifest", () => {
    expect(() => parseStudyPipelineArgs(["--date", SESSION_DATE])).toThrow(
      /--manifest is required/,
    );
  });

  it("dry-run does not write artifacts to data root", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "study-pipeline-m64-dry-"));
    await runStudyPipeline({
      sessionDate: SESSION_DATE,
      manifestPath: MANIFEST,
      dataRoot,
      dryRun: true,
    });
    expect(existsSync(studyPipelineRunPath(dataRoot, SESSION_DATE))).toBe(
      false,
    );
    expect(existsSync(studyEvidenceBundlePath(dataRoot, SESSION_DATE, SYMBOL))).toBe(
      false,
    );
  });

  it("dry-run builds validated artifacts without writing", async () => {
    const result = await runStudyPipeline({
      sessionDate: SESSION_DATE,
      manifestPath: MANIFEST,
      dryRun: true,
    });

    expect(StudyDefinition.safeParse(result.definition).success).toBe(true);
    expect(StudyForwardOutcome.safeParse(result.queryOutcome).success).toBe(
      true,
    );
    expect(SimilarRegimeStudy.safeParse(result.similarRegimeStudy).success).toBe(
      true,
    );
    expect(StudyEvidenceBundle.safeParse(result.evidenceBundle).success).toBe(
      true,
    );
    expect(StudyMemo.safeParse(result.memo).success).toBe(true);
    expect(result.memoSource).toBe("rule_based_fallback");
    expect(result.memo.validation.citationsValid).toBe(true);
    expect(result.memo.validation.numbersValid).toBe(true);
    expect(result.memo.validation.prohibitedInferenceDetected).toBe(false);
    expect(result.evidenceBundle.evidenceStatus).toBe("supported");
    expect(result.similarRegimeStudy.matchedStudyIds.length).toBe(1);
  });

  it("writes versioned artifacts atomically and is idempotent", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "study-pipeline-m64-"));

    const first = await runStudyPipeline({
      sessionDate: SESSION_DATE,
      manifestPath: MANIFEST,
      dataRoot,
      dryRun: false,
    });

    expect(existsSync(first.run.artifactPaths.definition)).toBe(true);
    expect(existsSync(first.run.artifactPaths.evidenceBundle)).toBe(true);
    expect(existsSync(first.run.artifactPaths.memo)).toBe(true);
    expect(existsSync(studyPipelineRunPath(dataRoot, SESSION_DATE))).toBe(true);

    const runRecord = readJsonArtifact(
      studyPipelineRunPath(dataRoot, SESSION_DATE),
      StudyPipelineRun,
    );
    expect(runRecord.memoSource).toBe("rule_based_fallback");
    expect(runRecord.evidenceStatus).toBe("supported");

    const bundleOnDisk = readJsonArtifact(
      studyEvidenceBundlePath(dataRoot, SESSION_DATE, SYMBOL),
      StudyEvidenceBundle,
    );
    expect(bundleOnDisk.bundleId).toBe(first.evidenceBundle.bundleId);

    const second = await runStudyPipeline({
      sessionDate: SESSION_DATE,
      manifestPath: MANIFEST,
      dataRoot,
      dryRun: false,
    });
    expect(second.evidenceBundle.bundleId).toBe(first.evidenceBundle.bundleId);
    expect(second.memo.id).toBe(first.memo.id);
  });

  it("is deterministic for identical inputs", async () => {
    const a = await runStudyPipeline({
      sessionDate: SESSION_DATE,
      manifestPath: MANIFEST,
      dryRun: true,
    });
    const b = await runStudyPipeline({
      sessionDate: SESSION_DATE,
      manifestPath: MANIFEST,
      dryRun: true,
    });
    expect(JSON.stringify(a.evidenceBundle)).toBe(
      JSON.stringify(b.evidenceBundle),
    );
    expect(JSON.stringify(a.memo)).toBe(JSON.stringify(b.memo));
  });

  it("rejects manifest sessionDate mismatch", async () => {
    await expect(
      runStudyPipeline({
        sessionDate: "2026-07-30",
        manifestPath: MANIFEST,
        dryRun: true,
      }),
    ).rejects.toThrow(/sessionDate/);
  });

  it("query outcome uses price corpus without lookahead beyond asOf", async () => {
    const result = await runStudyPipeline({
      sessionDate: SESSION_DATE,
      manifestPath: MANIFEST,
      dryRun: true,
    });
    expect(result.queryOutcome.pitIsolation).toBe(true);
    expect(result.queryOutcome.priceSeriesAsOfSessionDate).toBe("2026-08-29");
    expect(result.queryOutcome.returns.d5.status).toBe("available");
    if (result.queryOutcome.returns.d5.status === "available") {
      expect(result.queryOutcome.returns.d5.value).toBeCloseTo(109 / 105 - 1, 6);
    }
  });

  it("peer outcomes never affect match selection — only explicit PIT fields", async () => {
    const result = await runStudyPipeline({
      sessionDate: SESSION_DATE,
      manifestPath: MANIFEST,
      dryRun: true,
    });
    expect(result.similarRegimeStudy.matchedStudyIds[0]).toBe(
      "study|research|2026-07-22|0.1.0|SPY|0.1.0",
    );
    expect(result.evidenceBundle.cohortQuality.matchedStudyCount).toBe(1);
  });

  it("keeps query and peer outcomes separate with distinct study anchors", async () => {
    const result = await runStudyPipeline({
      sessionDate: SESSION_DATE,
      manifestPath: MANIFEST,
      dryRun: true,
    });
    expect(result.queryOutcome.studyId).toBe(
      "study|research|2026-07-29|0.1.0|SPY|0.1.0",
    );
    expect(result.queryOutcome.sessionDate).toBe(SESSION_DATE);
    expect(result.queryOutcome.studyId).not.toBe(
      result.similarRegimeStudy.matchedStudyIds[0],
    );
    expect(result.definition.limitations.join(" ")).toMatch(/never merge/i);
    expect(result.queryOutcome.pitIsolation).toBe(true);
  });
});

describe("M6-4 pipeline manifest fixture", () => {
  it("parses commit-safe manifest", () => {
    const raw = JSON.parse(
      readFileSync(join(process.cwd(), MANIFEST), "utf8"),
    );
    expect(raw.kind).toBe("StudyPipelineManifest");
    expect(raw.sessionDate).toBe(SESSION_DATE);
  });
});
