import {
  StudyEvidenceBundle,
  StudyMemo,
  StudyPipelineRun,
} from "@/contracts";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ArtifactIntegrityIssue } from "@/contracts/decision-surface";
import { studyEvidenceBundlePath, studyPipelineRunPath } from "@/studies/pipeline-store";
import { studyMemoPath } from "@/study-agent/memo-store";

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

export interface DecisionArtifactsLoadResult {
  readonly bundle: StudyEvidenceBundle | null;
  readonly memo: StudyMemo | null;
  readonly pipelineRun: StudyPipelineRun | null;
  readonly issues: readonly ArtifactIntegrityIssue[];
  readonly studyIntegrityOk: boolean;
}

function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function loadEvidenceBundle(
  sessionDate: string,
  symbol: string,
  dataRoot: string,
  issues: ArtifactIntegrityIssue[],
): StudyEvidenceBundle | null {
  const path = studyEvidenceBundlePath(dataRoot, sessionDate, symbol);
  if (!existsSync(path)) {
    issues.push({
      artifact: "evidence_bundle",
      severity: "missing",
      message: `No StudyEvidenceBundle for ${sessionDate} (${symbol}).`,
      path,
    });
    return null;
  }
  try {
    const bundle = StudyEvidenceBundle.parse(readJsonFile(path));
    if (bundle.queryContext.sessionDate !== sessionDate) {
      issues.push({
        artifact: "evidence_bundle",
        severity: "mismatched",
        message: `Bundle sessionDate ${bundle.queryContext.sessionDate} != requested ${sessionDate}.`,
        path,
      });
    }
    return bundle;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    issues.push({
      artifact: "evidence_bundle",
      severity: "invalid",
      message: `StudyEvidenceBundle failed validation: ${message}`,
      path,
    });
    return null;
  }
}

function loadStudyMemo(
  sessionDate: string,
  dataRoot: string,
  bundle: StudyEvidenceBundle | null,
  issues: ArtifactIntegrityIssue[],
): StudyMemo | null {
  const path = studyMemoPath(dataRoot, sessionDate);
  if (!existsSync(path)) {
    issues.push({
      artifact: "study_memo",
      severity: "missing",
      message: `No StudyMemo for session ${sessionDate}.`,
      path,
    });
    return null;
  }
  try {
    const memo = StudyMemo.parse(readJsonFile(path));
    if (bundle) {
      if (memo.bundleId !== bundle.bundleId) {
        issues.push({
          artifact: "study_memo",
          severity: "mismatched",
          message: `Memo bundleId ${memo.bundleId} != evidence bundle ${bundle.bundleId}.`,
          path,
        });
      }
      if (memo.bundleSchemaVersion !== bundle.schemaVersion) {
        issues.push({
          artifact: "study_memo",
          severity: "mismatched",
          message: `Memo bundleSchemaVersion ${memo.bundleSchemaVersion} != bundle ${bundle.schemaVersion}.`,
          path,
        });
      }
    }
    return memo;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    issues.push({
      artifact: "study_memo",
      severity: "invalid",
      message: `StudyMemo failed validation: ${message}`,
      path,
    });
    return null;
  }
}

function loadPipelineRun(
  sessionDate: string,
  symbol: string,
  dataRoot: string,
  bundle: StudyEvidenceBundle | null,
  memo: StudyMemo | null,
  issues: ArtifactIntegrityIssue[],
): StudyPipelineRun | null {
  const path = studyPipelineRunPath(dataRoot, sessionDate);
  if (!existsSync(path)) {
    return null;
  }
  try {
    const run = StudyPipelineRun.parse(readJsonFile(path));
    if (run.sessionDate !== sessionDate) {
      issues.push({
        artifact: "pipeline_run",
        severity: "mismatched",
        message: `Pipeline run sessionDate ${run.sessionDate} != requested ${sessionDate}.`,
        path,
      });
    }
    if (run.symbol !== symbol) {
      issues.push({
        artifact: "pipeline_run",
        severity: "mismatched",
        message: `Pipeline run symbol ${run.symbol} != ${symbol}.`,
        path,
      });
    }
    const expectedBundlePath = normalizePath(
      studyEvidenceBundlePath(dataRoot, sessionDate, symbol),
    );
    const expectedMemoPath = normalizePath(studyMemoPath(dataRoot, sessionDate));
    if (normalizePath(run.artifactPaths.evidenceBundle) !== expectedBundlePath) {
      issues.push({
        artifact: "pipeline_run",
        severity: "mismatched",
        message: `Pipeline evidenceBundle path does not match canonical artifact for ${sessionDate}.`,
        path,
      });
    }
    if (normalizePath(run.artifactPaths.memo) !== expectedMemoPath) {
      issues.push({
        artifact: "pipeline_run",
        severity: "mismatched",
        message: `Pipeline memo path does not match canonical artifact for ${sessionDate}.`,
        path,
      });
    }
    if (bundle && run.evidenceStatus !== bundle.evidenceStatus) {
      issues.push({
        artifact: "pipeline_run",
        severity: "stale",
        message: `Pipeline evidenceStatus ${run.evidenceStatus} != bundle ${bundle.evidenceStatus}.`,
        path,
      });
    }
    if (memo && run.memoStatus !== memo.status) {
      issues.push({
        artifact: "pipeline_run",
        severity: "stale",
        message: `Pipeline memoStatus ${run.memoStatus} != memo ${memo.status}.`,
        path,
      });
    }
    return run;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    issues.push({
      artifact: "pipeline_run",
      severity: "invalid",
      message: `StudyPipelineRun failed validation: ${message}`,
      path,
    });
    return null;
  }
}

function studyIntegrityOk(issues: readonly ArtifactIntegrityIssue[]): boolean {
  const studyArtifacts = new Set(["evidence_bundle", "study_memo"]);
  return !issues.some(
    (issue) =>
      studyArtifacts.has(issue.artifact) &&
      (issue.severity === "missing" ||
        issue.severity === "invalid" ||
        issue.severity === "mismatched"),
  );
}

/**
 * Load exact-date study artifacts from data/ — no latest, no fixture fallback.
 */
export function loadDecisionArtifacts(input: {
  readonly sessionDate: string;
  readonly symbol?: string;
  readonly dataRoot?: string;
}): DecisionArtifactsLoadResult {
  const sessionDate = input.sessionDate;
  const symbol = input.symbol ?? "SPY";
  const dataRoot = input.dataRoot ?? "data";
  const issues: ArtifactIntegrityIssue[] = [];

  const bundle = loadEvidenceBundle(sessionDate, symbol, dataRoot, issues);
  const memo = loadStudyMemo(sessionDate, dataRoot, bundle, issues);
  const pipelineRun = loadPipelineRun(
    sessionDate,
    symbol,
    dataRoot,
    bundle,
    memo,
    issues,
  );

  return {
    bundle,
    memo,
    pipelineRun,
    issues,
    studyIntegrityOk: studyIntegrityOk(issues),
  };
}
