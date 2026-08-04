import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { StudyMemoEvalReport } from "@/contracts/study-memo-eval-report";
import type {
  StudyMemoEvalCaseResult,
  StudyMemoEvalDimension,
  StudyMemoEvalDimensionResult,
  StudyMemoEvalRunResult,
  StudyMemoEvalVerdict,
} from "@/contracts/study-memo-eval-report";
import type { StudyEvidenceBundle, StudyMemo } from "@/contracts";
import { writeJsonAtomic } from "@/desk/atomic-write";
import { redactSecrets } from "@/catalyst/integration-smoke/redaction";
import { loadStudyMemoLlmConfig } from "./config";
import { createOpenAiStudyMemoNarrator } from "./openai-narrator";
import { buildStudyMemoInputPacket } from "./prompt";
import {
  EVAL_CASES,
  EVAL_FIXTURES_DIR,
  EVAL_FIXTURE_SESSION,
  type EvalCaseId,
  readEvalFixtureBundle,
} from "./eval-fixtures";
import {
  sanitizeStudyMemoSummary,
  verifyStudyMemoGrounding,
} from "./integration-smoke";
import { STUDY_MEMO_PROMPT_VERSION } from "./prompt";
import {
  buildRuleBasedMemoOutput,
  RULE_BASED_MEMO_MODEL,
  RULE_BASED_MEMO_PROVIDER,
} from "./rule-based-memo";
import {
  abstainStudyMemo,
  unavailableStudyMemo,
  validateStudyMemoOutput,
} from "./validate";

const PROHIBITED =
  /\b(buy|sell|long|short|overweight|underweight|probability|go long|go short|bullish|bearish)\b/i;

const INFERENCE_MARKERS =
  /\b(suggests?|implies?|indicates?|may reflect|appears|interpret|consistent with|descriptive only)\b/i;

const STATUS_TERMS: Record<StudyEvidenceBundle["evidenceStatus"], string[]> = {
  supported: ["supported"],
  mixed: ["mixed"],
  not_supported: ["not supported", "not_supported"],
  insufficient_evidence: ["insufficient", "insufficient_evidence"],
};

export interface RunStudyMemoEvalOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly dataRoot?: string;
  readonly runsPerCase?: number;
  readonly writeReport?: boolean;
}

function verdict(
  dimension: StudyMemoEvalDimension,
  v: StudyMemoEvalVerdict,
  notes: string[],
  automated = true,
): StudyMemoEvalDimensionResult {
  return { dimension, verdict: v, automated, notes };
}

function memoText(memo: StudyMemo): string {
  const parts = [
    memo.headline,
    ...memo.evidence.map((b) => b.text),
    ...memo.inference.map((b) => b.text),
    ...memo.limitations.map((b) => b.text),
    ...memo.unknowns.map((b) => b.text),
  ];
  return parts.join("\n").toLowerCase();
}

function evaluateEvidenceStatusFidelity(
  bundle: StudyEvidenceBundle,
  memo: StudyMemo,
): StudyMemoEvalDimensionResult {
  const text = memoText(memo);
  const terms = STATUS_TERMS[bundle.evidenceStatus];
  const matched = terms.some((term) => text.includes(term.toLowerCase()));
  if (matched) {
    return verdict("evidence_status_fidelity", "pass", [
      `Memo references expected status (${bundle.evidenceStatus}).`,
    ]);
  }
  const contradictions: string[] = [];
  for (const [status, words] of Object.entries(STATUS_TERMS)) {
    if (status === bundle.evidenceStatus) continue;
    if (words.some((w) => text.includes(w.toLowerCase()))) {
      contradictions.push(`mentions ${status}`);
    }
  }
  if (contradictions.length > 0) {
    return verdict("evidence_status_fidelity", "fail", [
      `Missing explicit ${bundle.evidenceStatus}; ${contradictions.join(", ")}.`,
    ]);
  }
  return verdict("evidence_status_fidelity", "partial", [
    `Expected status ${bundle.evidenceStatus} not clearly stated.`,
  ]);
}

function evaluateEvidenceInferenceSeparation(
  memo: StudyMemo,
): StudyMemoEvalDimensionResult {
  if (memo.status === "abstained") {
    return verdict("evidence_inference_separation", "pass", [
      "Abstained memo keeps inference empty.",
    ]);
  }
  const notes: string[] = [];
  let fail = false;
  for (const bullet of memo.evidence) {
    if (INFERENCE_MARKERS.test(bullet.text)) {
      notes.push(`${bullet.id}: evidence bullet uses inference language`);
      fail = true;
    }
  }
  if (memo.inference.length === 0) {
    notes.push("No inference bullets — interpretation layer absent.");
    return verdict("evidence_inference_separation", "partial", notes);
  }
  for (const bullet of memo.inference) {
    if (!INFERENCE_MARKERS.test(bullet.text) && bullet.text.length > 120) {
      notes.push(`${bullet.id}: long inference without interpretive framing`);
    }
  }
  if (fail) return verdict("evidence_inference_separation", "fail", notes);
  return verdict(
    "evidence_inference_separation",
    notes.length > 0 ? "partial" : "pass",
    notes.length > 0 ? notes : ["Evidence and inference sections are separated."],
  );
}

function evaluateLimitationsProminence(
  bundle: StudyEvidenceBundle,
  memo: StudyMemo,
): StudyMemoEvalDimensionResult {
  if (memo.status === "abstained") {
    const hasLim =
      memo.limitations.length > 0 || memo.unknowns.length > 0;
    return verdict(
      "limitations_prominence",
      hasLim ? "pass" : "fail",
      hasLim
        ? ["Abstain memo documents limitations/unknowns."]
        : ["Abstain memo missing limitations/unknowns."],
    );
  }
  if (memo.limitations.length === 0) {
    return verdict("limitations_prominence", "fail", [
      "No limitations section bullets.",
    ]);
  }
  const citesBundleLimitations = memo.limitations.some((b) =>
    b.bundleFieldPaths.some((p) => p.includes("limitations")),
  );
  const notes = [`${memo.limitations.length} limitation bullet(s).`];
  if (bundle.cohortQuality.warnings.length > 0 && memo.unknowns.length === 0) {
    notes.push("Bundle warnings present but unknowns empty.");
    return verdict("limitations_prominence", "partial", notes);
  }
  return verdict(
    "limitations_prominence",
    citesBundleLimitations ? "pass" : "partial",
    notes,
  );
}

function evaluateMissingDataPreservation(
  bundle: StudyEvidenceBundle,
  memo: StudyMemo,
  caseId: EvalCaseId,
): StudyMemoEvalDimensionResult {
  const text = memoText(memo);
  const notes: string[] = [];
  const d20 = bundle.horizonEvidence.d20;
  const d5 = bundle.horizonEvidence.d5;
  const needsHorizonGap =
    caseId === "partial_horizon_mfe" ||
    d20.aggregate.status === "insufficient_data";
  const needsMfeGap =
    caseId === "partial_horizon_mfe" ||
    (d5.aggregate.meanMfe === null && d5.aggregate.meanMae === null);

  if (needsHorizonGap) {
    const mentions20d =
      text.includes("20d") ||
      text.includes("20 d") ||
      text.includes("immature") ||
      text.includes("insufficient");
    if (!mentions20d) {
      notes.push("20D horizon gap not acknowledged.");
    }
  }
  if (needsMfeGap) {
    const mentionsMfe =
      text.includes("mfe") ||
      text.includes("mae") ||
      text.includes("excursion") ||
      text.includes("unavailable");
    if (!mentionsMfe) {
      notes.push("MFE/MAE unavailability not acknowledged.");
    }
  }
  if (bundle.cohortQuality.matchedStudyCount === 1) {
    const mentionsThin =
      text.includes("n=1") ||
      text.includes("1 stud") ||
      text.includes("single") ||
      text.includes("thin") ||
      text.includes("one match");
    if (!mentionsThin) {
      notes.push("Thin n=1 cohort not highlighted.");
    }
  }
  if (notes.length === 0) {
    return verdict("missing_data_preservation", "pass", [
      "Gaps and thin-sample caveats preserved.",
    ]);
  }
  if (memo.unknowns.length > 0 || memo.limitations.length >= 2) {
    return verdict("missing_data_preservation", "partial", notes);
  }
  return verdict("missing_data_preservation", "fail", notes);
}

function evaluateReadability(memo: StudyMemo): StudyMemoEvalDimensionResult {
  const notes: string[] = [];
  if (memo.headline.length < 15 || memo.headline.length > 220) {
    notes.push(`Headline length ${memo.headline.length} outside 15–220.`);
  }
  const allBullets = [
    ...memo.evidence,
    ...memo.inference,
    ...memo.limitations,
    ...memo.unknowns,
  ];
  const avgLen =
    allBullets.reduce((sum, b) => sum + b.text.length, 0) /
    Math.max(allBullets.length, 1);
  if (avgLen > 280) notes.push(`Average bullet length high (${avgLen.toFixed(0)}).`);
  if (avgLen < 25) notes.push(`Average bullet length low (${avgLen.toFixed(0)}).`);
  return verdict(
    "readability",
    notes.length === 0 ? "pass" : "partial",
    notes.length === 0
      ? ["Headline and bullets are concise and scannable."]
      : notes,
  );
}

function evaluateUsefulness(
  bundle: StudyEvidenceBundle,
  memo: StudyMemo,
): StudyMemoEvalDimensionResult {
  const text = memoText(memo);
  const notes: string[] = [];
  const hasCohort =
    text.includes(String(bundle.cohortQuality.matchedStudyCount)) ||
    text.includes("cohort") ||
    text.includes("matched");
  const hasHorizon =
    text.includes("5d") ||
    text.includes("primary horizon") ||
    text.includes(bundle.primaryHorizon.toLowerCase());
  const hasMetric =
    text.includes("mean") ||
    text.includes("median") ||
    text.includes("positive rate") ||
    text.includes("return");

  if (!hasCohort) notes.push("Cohort context weak or missing.");
  if (!hasHorizon && memo.status !== "abstained") {
    notes.push("Primary horizon not referenced.");
  }
  if (!hasMetric && memo.status !== "abstained") {
    notes.push("Aggregate metrics not referenced.");
  }

  const score = [hasCohort, hasHorizon, hasMetric].filter(Boolean).length;
  if (score >= 3) {
    return verdict("usefulness", "pass", [
      "Researcher can see cohort, horizon, and aggregate stats.",
    ]);
  }
  if (score >= 2) {
    return verdict("usefulness", "partial", notes);
  }
  return verdict("usefulness", "fail", notes);
}

function evaluateRun(input: {
  readonly bundle: StudyEvidenceBundle;
  readonly memo: StudyMemo;
  readonly caseId: EvalCaseId;
  readonly runIndex: number;
  readonly providerAttempts: number;
  readonly failureCategory?: string;
}): StudyMemoEvalRunResult {
  const grounding = verifyStudyMemoGrounding({
    bundle: input.bundle,
    memo: input.memo,
  });
  const hardErrors = grounding.errors.map((e) => redactSecrets(e));

  const dimensions: StudyMemoEvalDimensionResult[] = [
    evaluateEvidenceStatusFidelity(input.bundle, input.memo),
    verdict(
      "citation_validity",
      grounding.checks.citationsValid && grounding.checks.pathsResolve
        ? "pass"
        : "fail",
      grounding.checks.citationsValid && grounding.checks.pathsResolve
        ? ["Citations resolve on bundle."]
        : hardErrors.filter((e) => e.includes("path") || e.includes("citation")),
    ),
    verdict(
      "number_grounding",
      grounding.checks.numbersValid ? "pass" : "fail",
      grounding.checks.numbersValid
        ? ["Numbers grounded in cited bundle fields."]
        : hardErrors.filter((e) => e.includes("number") || e.includes("token")),
    ),
    evaluateEvidenceInferenceSeparation(input.memo),
    evaluateLimitationsProminence(input.bundle, input.memo),
    evaluateMissingDataPreservation(input.bundle, input.memo, input.caseId),
    verdict(
      "no_invented_facts",
      input.memo.validation.citationsValid && input.memo.validation.numbersValid
        ? "pass"
        : "fail",
      input.memo.validation.citationsValid && input.memo.validation.numbersValid
        ? ["Validator found no unsupported facts."]
        : ["Validation flags unsupported content."],
    ),
    verdict(
      "no_prohibited_language",
      grounding.checks.noProhibitedLanguage &&
        !PROHIBITED.test(memoText(input.memo))
        ? "pass"
        : "fail",
      grounding.checks.noProhibitedLanguage
        ? ["No trade/probability language detected."]
        : ["Prohibited language or inference detected."],
    ),
    evaluateReadability(input.memo),
    evaluateUsefulness(input.bundle, input.memo),
  ];

  const hardPass =
    grounding.ok &&
    (input.memo.status === "complete" ||
      input.memo.status === "partial" ||
      input.memo.status === "abstained");

  return {
    runIndex: input.runIndex,
    memoStatus: input.memo.status,
    hardPass,
    hardErrors,
    providerAttempts: input.providerAttempts,
    failureCategory: input.failureCategory,
    dimensions,
    memo: sanitizeStudyMemoSummary(input.memo),
  };
}

function variance(values: number[]): number {
  if (values.length <= 1) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
}

function buildVariability(
  runs: readonly StudyMemoEvalRunResult[],
): StudyMemoEvalCaseResult["variability"] {
  const headlines = runs.map((r) => r.memo.headline);
  const uniqueHeadlines = new Set(headlines);
  const statuses = [...new Set(runs.map((r) => r.memoStatus))];
  const notes: string[] = [];
  if (uniqueHeadlines.size > 1) {
    notes.push(`${uniqueHeadlines.size} distinct headlines across runs.`);
  } else if (runs.length > 1) {
    notes.push("Headlines identical across runs.");
  }
  if (statuses.length > 1) {
    notes.push(`Memo status varied: ${statuses.join(", ")}.`);
  }

  const evidenceCounts = runs.map((r) => r.memo.sectionCounts.evidence);
  const inferenceCounts = runs.map((r) => r.memo.sectionCounts.inference);
  const limitationsCounts = runs.map((r) => r.memo.sectionCounts.limitations);
  const unknownsCounts = runs.map((r) => r.memo.sectionCounts.unknowns);

  return {
    headlineUniqueCount: uniqueHeadlines.size,
    memoStatusUnique: statuses,
    hardPassCount: runs.filter((r) => r.hardPass).length,
    hardFailCount: runs.filter((r) => !r.hardPass).length,
    sectionCountVariance: {
      evidence: variance(evidenceCounts),
      inference: variance(inferenceCounts),
      limitations: variance(limitationsCounts),
      unknowns: variance(unknownsCounts),
    },
    notes,
  };
}

function qualitativePass(runs: readonly StudyMemoEvalRunResult[]): boolean {
  const qualitativeDimensions: StudyMemoEvalDimension[] = [
    "evidence_status_fidelity",
    "evidence_inference_separation",
    "limitations_prominence",
    "missing_data_preservation",
    "readability",
    "usefulness",
  ];
  for (const run of runs) {
    for (const dim of qualitativeDimensions) {
      const result = run.dimensions.find((d) => d.dimension === dim);
      if (result?.verdict === "fail") return false;
    }
  }
  return true;
}

function buildRecommendations(
  cases: readonly StudyMemoEvalCaseResult[],
): {
  blocking: string[];
  optional: string[];
} {
  const blocking = new Set<string>();
  const optional = new Set<string>();

  for (const evalCase of cases) {
    for (const run of evalCase.runs) {
      if (!run.hardPass) {
        for (const err of run.hardErrors) {
          if (err.includes("prohibited")) {
            blocking.add("Tighten prompt/validator for prohibited trade language.");
          }
          if (err.includes("number") || err.includes("token")) {
            blocking.add("Reinforce number grounding — cite exact bundle numeric fields.");
          }
          if (err.includes("path") || err.includes("citation")) {
            blocking.add("Clarify bundleFieldPaths examples in user prompt.");
          }
          if (run.memoStatus === "rejected") {
            blocking.add("Investigate rejected memo rate — may need prompt or schema adjustment.");
          }
        }
      }
      for (const dim of run.dimensions) {
        if (dim.verdict === "fail" && dim.dimension === "missing_data_preservation") {
          optional.add(
            "Prompt should require unknowns when horizons or MFE/MAE are partial.",
          );
        }
        if (dim.verdict === "partial" && dim.dimension === "evidence_status_fidelity") {
          optional.add("Prompt should require explicit evidenceStatus in evidence section.");
        }
        if (dim.verdict === "partial" && dim.dimension === "usefulness") {
          optional.add("Add template bullets for cohort count and primary-horizon aggregates.");
        }
      }
    }
    if (evalCase.variability.hardFailCount > 0 && evalCase.variability.hardPassCount > 0) {
      blocking.add(
        `Case ${evalCase.caseId}: intermittent validation failures — investigate run-to-run variance.`,
      );
    }
    if (evalCase.variability.headlineUniqueCount >= 3 && evalCase.runs.length >= 3) {
      optional.add(
        `Case ${evalCase.caseId}: high headline variance — consider temperature or stricter headline template.`,
      );
    }
  }

  return {
    blocking: [...blocking],
    optional: [...optional],
  };
}

function assessUsefulness(
  cases: readonly StudyMemoEvalCaseResult[],
): StudyMemoEvalReport["summary"]["openAiUsefulBeyondRuleBased"] {
  const nonAbstained = cases.filter((c) => !c.abstained);
  if (nonAbstained.length === 0) return "inconclusive";

  const openAiBetter = nonAbstained.filter((c) => {
    if (!c.overallHardPass) return false;
    const qualDims = c.runs.flatMap((r) =>
      r.dimensions.filter(
        (d) =>
          d.dimension === "readability" ||
          d.dimension === "usefulness" ||
          d.dimension === "evidence_inference_separation",
      ),
    );
    const passCount = qualDims.filter((d) => d.verdict === "pass").length;
    return passCount / qualDims.length >= 0.6;
  }).length;

  const allHardPass = nonAbstained.every((c) => c.overallHardPass);
  if (!allHardPass) return "partial";
  if (openAiBetter >= nonAbstained.length * 0.8) return "yes";
  if (openAiBetter >= nonAbstained.length * 0.4) return "partial";
  return "no";
}

export async function runStudyMemoQualityEval(
  options: RunStudyMemoEvalOptions = {},
): Promise<StudyMemoEvalReport> {
  const env = options.env ?? process.env;
  const runtime = loadStudyMemoLlmConfig(env);
  if (!runtime.apiKey) {
    throw new Error("OPENAI_API_KEY required for live study memo quality eval");
  }

  const startedAt = new Date().toISOString();
  const runId = randomUUID();
  const runsPerCaseDefault = options.runsPerCase ?? 3;
  const caseResults: StudyMemoEvalCaseResult[] = [];
  const narrator = createOpenAiStudyMemoNarrator({ config: runtime });
  let narratorRunsTotal = 0;
  let narratorRunsWithRetry = 0;
  let parseRetrySuccesses = 0;

  for (const evalCase of EVAL_CASES) {
    const bundle = readEvalFixtureBundle(evalCase.id);
    const runs: StudyMemoEvalRunResult[] = [];
    const runCount = evalCase.abstains ? 1 : runsPerCaseDefault;

    for (let i = 0; i < runCount; i++) {
      const generatedAt = new Date().toISOString();
      let memo: StudyMemo;
      let providerAttempts = 0;
      let failureCategory: string | undefined;

      if (evalCase.abstains) {
        memo = abstainStudyMemo({
          bundle,
          provider: "openai",
          model: runtime.model,
          generatedAt,
          synthetic: true,
        });
      } else {
        narratorRunsTotal++;
        const narrated = await narrator.narrate(buildStudyMemoInputPacket(bundle));
        providerAttempts = narrated.attempts;
        if (providerAttempts > 1) {
          narratorRunsWithRetry++;
          if (narrated.ok) parseRetrySuccesses++;
        }
        if (!narrated.ok) {
          failureCategory = narrated.failureCategory;
          memo = unavailableStudyMemo({
            bundle,
            provider: narrated.provider,
            model: narrated.model,
            generatedAt,
            error: narrated.error,
            synthetic: true,
          });
        } else {
          memo = validateStudyMemoOutput({
            bundle,
            output: narrated.output,
            provider: narrated.provider,
            model: narrated.model,
            generatedAt,
            synthetic: true,
          });
        }
      }

      runs.push(
        evaluateRun({
          bundle,
          memo,
          caseId: evalCase.id,
          runIndex: i + 1,
          providerAttempts,
          failureCategory,
        }),
      );
    }

    let ruleBasedComparison: StudyMemoEvalCaseResult["ruleBasedComparison"];
    if (!evalCase.abstains) {
      const ruleMemo = validateStudyMemoOutput({
        bundle,
        output: buildRuleBasedMemoOutput(bundle),
        provider: RULE_BASED_MEMO_PROVIDER,
        model: RULE_BASED_MEMO_MODEL,
        generatedAt: bundle.computedAt,
        synthetic: true,
      });
      const ruleGrounding = verifyStudyMemoGrounding({ bundle, memo: ruleMemo });
      ruleBasedComparison = {
        hardPass: ruleGrounding.ok,
        headline: redactSecrets(ruleMemo.headline),
      };
    }

    caseResults.push({
      caseId: evalCase.id,
      label: evalCase.label,
      expectedEvidenceStatus: evalCase.expectedEvidenceStatus,
      abstained: evalCase.abstains,
      bundlePath: join(EVAL_FIXTURES_DIR, evalCase.fixtureFile),
      runs,
      overallHardPass: runs.every((r) => r.hardPass),
      overallQualitativePass: qualitativePass(runs),
      variability: buildVariability(runs),
      ruleBasedComparison,
    });
  }

  const recs = buildRecommendations(caseResults);
  const report = StudyMemoEvalReport.parse({
    kind: "StudyMemoEvalReport",
    schemaVersion: "0.1.0",
    runId,
    startedAt,
    completedAt: new Date().toISOString(),
    sessionDate: EVAL_FIXTURE_SESSION,
    provider: "openai",
    model: runtime.model,
    promptVersion: STUDY_MEMO_PROMPT_VERSION,
    mode: "live",
    cases: caseResults,
    summary: {
      casesTotal: caseResults.length,
      casesHardPass: caseResults.filter((c) => c.overallHardPass).length,
      casesQualitativePass: caseResults.filter((c) => c.overallQualitativePass)
        .length,
      openAiUsefulBeyondRuleBased: assessUsefulness(caseResults),
      blockingRecommendations: recs.blocking,
      optionalRecommendations: recs.optional,
      baselineHardPassCases: 3,
      narratorRunsTotal,
      narratorRunsWithRetry,
      parseRetrySuccesses,
    },
  });

  if (options.writeReport !== false) {
    const dataRoot = options.dataRoot ?? "data";
    const dir = join(dataRoot, "studies", "evals");
    mkdirSync(dir, { recursive: true });
    const timestamp = report.completedAt.replace(/[:.]/g, "-");
    writeJsonAtomic(join(dir, `study-memo-quality-${timestamp}.json`), report);
    writeJsonAtomic(join(dir, "study-memo-quality-latest.json"), report);
  }

  return report;
}

export function formatStudyMemoEvalSummary(
  report: StudyMemoEvalReport,
): string[] {
  const lines = [
    `provider/model: ${report.provider}/${report.model}`,
    `prompt: ${report.promptVersion}`,
    `cases: ${report.summary.casesHardPass}/${report.summary.casesTotal} hard pass`,
    `qualitative: ${report.summary.casesQualitativePass}/${report.summary.casesTotal} pass`,
    `useful beyond rule-based: ${report.summary.openAiUsefulBeyondRuleBased}`,
    "",
    "case\tabstain\thard\tqual\tvariability",
  ];
  for (const c of report.cases) {
    lines.push(
      `${c.caseId}\t${c.abstained ? "yes" : "no"}\t${c.overallHardPass ? "PASS" : "FAIL"}\t${c.overallQualitativePass ? "PASS" : "FAIL"}\t${c.variability.notes.join("; ") || "stable"}`,
    );
  }
  return lines;
}
