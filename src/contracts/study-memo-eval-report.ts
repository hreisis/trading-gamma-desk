import { z } from "zod";
import { SanitizedStudyMemoSummary } from "./study-memo-integration-smoke";

export const StudyMemoEvalDimension = z.enum([
  "evidence_status_fidelity",
  "citation_validity",
  "number_grounding",
  "evidence_inference_separation",
  "limitations_prominence",
  "missing_data_preservation",
  "no_invented_facts",
  "no_prohibited_language",
  "readability",
  "usefulness",
]);

export const StudyMemoEvalVerdict = z.enum(["pass", "partial", "fail"]);

export const StudyMemoEvalDimensionResult = z.object({
  dimension: StudyMemoEvalDimension,
  verdict: StudyMemoEvalVerdict,
  automated: z.boolean(),
  notes: z.array(z.string()),
});

export const StudyMemoEvalRunResult = z.object({
  runIndex: z.number().int().positive(),
  memoStatus: z.string(),
  hardPass: z.boolean(),
  hardErrors: z.array(z.string()),
  providerAttempts: z.number().int().nonnegative(),
  failureCategory: z.string().optional(),
  dimensions: z.array(StudyMemoEvalDimensionResult),
  memo: SanitizedStudyMemoSummary,
});

export const StudyMemoEvalCaseResult = z.object({
  caseId: z.string(),
  label: z.string(),
  expectedEvidenceStatus: z.string(),
  abstained: z.boolean(),
  bundlePath: z.string(),
  runs: z.array(StudyMemoEvalRunResult),
  overallHardPass: z.boolean(),
  overallQualitativePass: z.boolean(),
  variability: z.object({
    headlineUniqueCount: z.number().int().nonnegative(),
    memoStatusUnique: z.array(z.string()),
    hardPassCount: z.number().int().nonnegative(),
    hardFailCount: z.number().int().nonnegative(),
    sectionCountVariance: z.object({
      evidence: z.number().nonnegative(),
      inference: z.number().nonnegative(),
      limitations: z.number().nonnegative(),
      unknowns: z.number().nonnegative(),
    }),
    notes: z.array(z.string()),
  }),
  ruleBasedComparison: z
    .object({
      hardPass: z.boolean(),
      headline: z.string(),
    })
    .optional(),
});

export const StudyMemoEvalReport = z.object({
  kind: z.literal("StudyMemoEvalReport"),
  schemaVersion: z.literal("0.1.0"),
  runId: z.string().uuid(),
  startedAt: z.string(),
  completedAt: z.string(),
  sessionDate: z.string(),
  provider: z.string(),
  model: z.string(),
  promptVersion: z.string(),
  mode: z.literal("live"),
  cases: z.array(StudyMemoEvalCaseResult),
  summary: z.object({
    casesTotal: z.number().int().nonnegative(),
    casesHardPass: z.number().int().nonnegative(),
    casesQualitativePass: z.number().int().nonnegative(),
    openAiUsefulBeyondRuleBased: z.enum(["yes", "partial", "no", "inconclusive"]),
    blockingRecommendations: z.array(z.string()),
    optionalRecommendations: z.array(z.string()),
    baselineHardPassCases: z.number().int().nonnegative().optional(),
    narratorRunsTotal: z.number().int().nonnegative(),
    narratorRunsWithRetry: z.number().int().nonnegative(),
    parseRetrySuccesses: z.number().int().nonnegative(),
  }),
});

export type StudyMemoEvalDimension = z.infer<typeof StudyMemoEvalDimension>;
export type StudyMemoEvalVerdict = z.infer<typeof StudyMemoEvalVerdict>;
export type StudyMemoEvalDimensionResult = z.infer<
  typeof StudyMemoEvalDimensionResult
>;
export type StudyMemoEvalRunResult = z.infer<typeof StudyMemoEvalRunResult>;
export type StudyMemoEvalCaseResult = z.infer<typeof StudyMemoEvalCaseResult>;
export type StudyMemoEvalReport = z.infer<typeof StudyMemoEvalReport>;
