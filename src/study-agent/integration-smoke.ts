import { randomUUID } from "node:crypto";
import { writeJsonAtomic } from "@/desk/atomic-write";
import { isPublicDemoMode } from "@/desk/public-demo";
import {
  StudyMemoIntegrationSmokeReport,
  type SanitizedStudyMemoSummary,
  type StudyEvidenceBundle,
  type StudyMemo,
  type StudyMemoBullet,
  type StudyMemoSectionCounts,
} from "@/contracts";
import { redactSecrets } from "@/catalyst/integration-smoke/redaction";
import {
  loadStudyMemoLlmConfig,
  resolveOpenAiApiKey,
} from "./config";
import { runStudyMemoWorkflow } from "./build-memo-workflow";
import { studyMemoIntegrationSmokeReportPath } from "./integration-smoke-paths";
import { readStudyEvidenceBundle, studyMemoPath, writeStudyMemo } from "./memo-store";
import type { StudyMemoNarrator } from "./narrator";
import { enumerateBundleFieldPaths, pathsResolve } from "./citations";

const PROHIBITED =
  /\b(buy|sell|long|short|overweight|underweight|take profit|stop.?loss|bullish|bearish|hawkish|dovish)\b/i;
const PREDICTION =
  /\b(will rally|will fall|will rise|will drop|predict|forecast|expect returns|trade signal|go long|go short)\b/i;

export interface StudyMemoGroundingChecks {
  readonly citationsValid: boolean;
  readonly numbersValid: boolean;
  readonly noProhibitedLanguage: boolean;
  readonly sectionsPresent: boolean;
  readonly allBulletsCited: boolean;
  readonly pathsResolve: boolean;
}

export interface VerifyStudyMemoGroundingResult {
  readonly ok: boolean;
  readonly checks: StudyMemoGroundingChecks;
  readonly errors: string[];
}

function sanitizeBullet(
  bullet: StudyMemoBullet,
  kind: SanitizedStudyMemoSummary["bullets"][number]["kind"],
): SanitizedStudyMemoSummary["bullets"][number] {
  return {
    id: bullet.id,
    kind,
    textPreview: redactSecrets(bullet.text).slice(0, 240),
    bundleFieldPaths: [...bullet.bundleFieldPaths],
  };
}

export function memoSectionCounts(memo: StudyMemo): StudyMemoSectionCounts {
  return {
    evidence: memo.evidence.length,
    inference: memo.inference.length,
    limitations: memo.limitations.length,
    unknowns: memo.unknowns.length,
  };
}

/** Ensures sanitized summary mirrors validated memo section arrays. */
export function assertMemoSummaryMatchesMemo(
  memo: StudyMemo,
  summary: SanitizedStudyMemoSummary,
): void {
  const counts = memoSectionCounts(memo);
  if (
    summary.sectionCounts.evidence !== counts.evidence ||
    summary.sectionCounts.inference !== counts.inference ||
    summary.sectionCounts.limitations !== counts.limitations ||
    summary.sectionCounts.unknowns !== counts.unknowns
  ) {
    throw new Error("smoke report sectionCounts do not match validated memo");
  }

  const expectedTotal =
    counts.evidence +
    counts.inference +
    counts.limitations +
    counts.unknowns;
  if (summary.bullets.length !== expectedTotal) {
    throw new Error("smoke report bullet count does not match validated memo");
  }

  const sections: Array<{
    kind: SanitizedStudyMemoSummary["bullets"][number]["kind"];
    bullets: readonly StudyMemoBullet[];
  }> = [
    { kind: "evidence", bullets: memo.evidence },
    { kind: "inference", bullets: memo.inference },
    { kind: "limitations", bullets: memo.limitations },
    { kind: "unknowns", bullets: memo.unknowns },
  ];

  let index = 0;
  for (const section of sections) {
    for (const bullet of section.bullets) {
      const sanitized = summary.bullets[index];
      if (!sanitized || sanitized.id !== bullet.id || sanitized.kind !== section.kind) {
        throw new Error(
          `smoke report bullet ${bullet.id} does not match validated memo section ${section.kind}`,
        );
      }
      index++;
    }
  }
}

export function sanitizeStudyMemoSummary(memo: StudyMemo): SanitizedStudyMemoSummary {
  const bullets = [
    ...memo.evidence.map((bullet) => sanitizeBullet(bullet, "evidence")),
    ...memo.inference.map((bullet) => sanitizeBullet(bullet, "inference")),
    ...memo.limitations.map((bullet) => sanitizeBullet(bullet, "limitations")),
    ...memo.unknowns.map((bullet) => sanitizeBullet(bullet, "unknowns")),
  ];

  const summary: SanitizedStudyMemoSummary = {
    id: memo.id,
    status: memo.status,
    provider: memo.provider,
    model: memo.model,
    headline: redactSecrets(memo.headline),
    sectionCounts: memoSectionCounts(memo),
    bullets,
    validation: memo.validation,
  };
  assertMemoSummaryMatchesMemo(memo, summary);
  return summary;
}

export function verifyStudyMemoGrounding(input: {
  readonly bundle: StudyEvidenceBundle;
  readonly memo: StudyMemo;
}): VerifyStudyMemoGroundingResult {
  const { bundle, memo } = input;
  const errors: string[] = [];
  const allowedPaths = enumerateBundleFieldPaths(bundle);
  const allBullets = [
    ...memo.evidence,
    ...memo.inference,
    ...memo.limitations,
    ...memo.unknowns,
  ];

  let pathsResolveOk = true;
  let allBulletsCited = true;
  for (const bullet of allBullets) {
    if (bullet.bundleFieldPaths.length === 0) {
      allBulletsCited = false;
      errors.push(`${bullet.id}: missing bundleFieldPaths`);
    }
    const resolved = pathsResolve(bundle, bullet.bundleFieldPaths, allowedPaths);
    if (!resolved.ok) {
      pathsResolveOk = false;
      errors.push(`${bullet.id}: bad path ${resolved.badPath}`);
    }
    if (PROHIBITED.test(bullet.text) || PREDICTION.test(bullet.text)) {
      errors.push(`${bullet.id}: prohibited language`);
    }
  }
  if (
    PROHIBITED.test(memo.headline) ||
    PREDICTION.test(memo.headline)
  ) {
    errors.push("headline: prohibited language");
  }

  const sectionsPresent =
    memo.status === "abstained"
      ? memo.evidence.length >= 1 && memo.inference.length === 0
      : memo.status === "unavailable"
        ? memo.unknowns.length >= 1
        : memo.evidence.length >= 1;

  if (!sectionsPresent) {
    errors.push("required memo sections missing for status");
  }

  if (!memo.validation.citationsValid) {
    errors.push("validation.citationsValid=false");
  }
  if (!memo.validation.numbersValid) {
    errors.push("validation.numbersValid=false");
  }
  if (memo.validation.prohibitedInferenceDetected) {
    errors.push("validation.prohibitedInferenceDetected=true");
  }

  const checks: StudyMemoGroundingChecks = {
    citationsValid: memo.validation.citationsValid,
    numbersValid: memo.validation.numbersValid,
    noProhibitedLanguage: !memo.validation.prohibitedInferenceDetected,
    sectionsPresent,
    allBulletsCited,
    pathsResolve: pathsResolveOk,
  };

  const ok =
    checks.citationsValid &&
    checks.numbersValid &&
    checks.noProhibitedLanguage &&
    checks.sectionsPresent &&
    checks.allBulletsCited &&
    checks.pathsResolve;

  return { ok, checks, errors };
}

export interface StudyMemoIntegrationSmokeOptions {
  readonly live?: boolean;
  readonly dryRun?: boolean;
  readonly date: string;
  readonly bundlePath: string;
  readonly dataRoot?: string;
  readonly publicDemo?: boolean;
  readonly env?: NodeJS.ProcessEnv;
  readonly narrator?: StudyMemoNarrator;
  readonly writeReport?: boolean;
  readonly generatedAt?: string;
}

export interface StudyMemoIntegrationSmokeResult {
  readonly report: StudyMemoIntegrationSmokeReport;
  readonly reportPath: string | null;
  readonly exitCode: number;
}

export function parseStudyMemoIntegrationSmokeArgs(
  argv: readonly string[],
): Omit<
  StudyMemoIntegrationSmokeOptions,
  "env" | "publicDemo" | "narrator" | "writeReport"
> {
  let live = false;
  let dryRun = true;
  let date: string | undefined;
  let bundlePath =
    "fixtures/studies/evidence-bundle.m62.json";
  let dataRoot = "data";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--live") {
      live = true;
      continue;
    }
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--write") {
      dryRun = false;
      continue;
    }
    if (arg.startsWith("--date=")) {
      date = arg.slice("--date=".length);
      continue;
    }
    if (arg === "--date") {
      date = argv[++i];
      continue;
    }
    if (arg.startsWith("--bundle=")) {
      bundlePath = arg.slice("--bundle=".length);
      continue;
    }
    if (arg === "--bundle") {
      bundlePath = argv[++i] ?? bundlePath;
      continue;
    }
    if (arg.startsWith("--data-root=")) {
      dataRoot = arg.slice("--data-root=".length);
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  if (!date) {
    throw new Error("--date is required (exact sessionDate — no latest fallback)");
  }

  return { live, dryRun, date, bundlePath, dataRoot };
}

export async function runStudyMemoIntegrationSmoke(
  options: StudyMemoIntegrationSmokeOptions,
): Promise<StudyMemoIntegrationSmokeResult> {
  const publicDemo = options.publicDemo ?? isPublicDemoMode();
  if (publicDemo) {
    throw new Error(
      "GAMMADESK_PUBLIC_DEMO is set — refusing study memo integration smoke.",
    );
  }

  const env = options.env ?? process.env;
  const startedAt = new Date().toISOString();
  const runId = randomUUID();
  const dataRoot = options.dataRoot ?? "data";
  const bundle = readStudyEvidenceBundle(options.bundlePath);

  if (bundle.queryContext.sessionDate !== options.date) {
    throw new Error(
      `bundle sessionDate ${bundle.queryContext.sessionDate} != --date ${options.date}`,
    );
  }

  const runtime = loadStudyMemoLlmConfig(env);
  const notes: string[] = [];
  const errors: string[] = [];

  if (options.live && !resolveOpenAiApiKey(env) && !options.narrator) {
    notes.push("OPENAI_API_KEY missing — live smoke will use rule-based fallback");
  }

  const workflow = await runStudyMemoWorkflow({
    bundle,
    narrator: options.narrator,
    config: options.live ? runtime : { apiKey: null },
    forceFallback: !options.live && !options.narrator,
    generatedAt: options.generatedAt ?? bundle.computedAt,
    synthetic: true,
  });

  const grounding = verifyStudyMemoGrounding({ bundle, memo: workflow.memo });
  errors.push(...grounding.errors);

  const outPath = studyMemoPath(dataRoot, options.date);
  let memoWritten = false;
  if (!options.dryRun) {
    writeStudyMemo(outPath, workflow.memo);
    memoWritten = true;
    notes.push(`memo written to ${outPath}`);
  } else {
    notes.push("dry-run — memo not written");
  }

  const passedStatuses = new Set(["complete", "partial", "abstained"]);
  const overallStatus: StudyMemoIntegrationSmokeReport["overallStatus"] =
    !grounding.ok
      ? "failed"
      : passedStatuses.has(workflow.memo.status)
        ? workflow.memo.status === "partial"
          ? "partial"
          : "passed"
        : workflow.memo.status === "unavailable"
          ? "unavailable"
          : "failed";

  const memoSummary = sanitizeStudyMemoSummary(workflow.memo);
  assertMemoSummaryMatchesMemo(workflow.memo, memoSummary);

  const report = StudyMemoIntegrationSmokeReport.parse({
    kind: "StudyMemoIntegrationSmokeReport",
    schemaVersion: "0.1.0",
    runId,
    mode: options.live ? "live" : "dry-run",
    startedAt,
    completedAt: new Date().toISOString(),
    sessionDate: options.date,
    bundlePath: options.bundlePath,
    bundleId: bundle.bundleId,
    overallStatus,
    memoSource: workflow.source,
    provider: workflow.memo.provider,
    model: workflow.memo.model,
    memoWritten,
    outPath: memoWritten ? outPath : undefined,
    fallbackReason: workflow.fallbackReason
      ? redactSecrets(workflow.fallbackReason)
      : undefined,
    groundingChecks: grounding.checks,
    errors: [...new Set(errors.map((e) => redactSecrets(e)))],
    notes,
    memo: memoSummary,
  });

  let reportPath: string | null = null;
  if (options.writeReport !== false) {
    reportPath = studyMemoIntegrationSmokeReportPath(dataRoot);
    writeJsonAtomic(reportPath, report);
  }

  const exitCode =
    overallStatus === "failed" ? 1 : overallStatus === "unavailable" ? 2 : 0;

  return { report, reportPath, exitCode };
}

export function formatStudyMemoSmokeSummary(
  report: StudyMemoIntegrationSmokeReport,
): string[] {
  const { sectionCounts } = report.memo;
  return [
    `overall: ${report.overallStatus}`,
    `memo: ${report.memo.status} via ${report.memoSource} (${report.provider}/${report.model})`,
    `grounding: citations=${report.groundingChecks.citationsValid} numbers=${report.groundingChecks.numbersValid} trade-language-clean=${report.groundingChecks.noProhibitedLanguage}`,
    `sections: evidence=${sectionCounts.evidence} inference=${sectionCounts.inference} limitations=${sectionCounts.limitations} unknowns=${sectionCounts.unknowns}`,
  ];
}
