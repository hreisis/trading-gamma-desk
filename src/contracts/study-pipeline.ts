import { z } from "zod";
import { IsoDateTime } from "./common";
import { StudyMatchFactorKey } from "./similar-regime-study";

export const STUDY_PIPELINE_MANIFEST_SCHEMA_VERSION = "0.1.0";
export const STUDY_PIPELINE_RUN_SCHEMA_VERSION = "0.1.0";

export const StudyPipelineQueryInput = z
  .object({
    archivePath: z.string().min(1).optional(),
    sourcesManifest: z.string().min(1).optional(),
    priceSeriesPath: z.string().min(1),
    priceSeriesAsOfSessionDate: z.string().min(1),
    gammaRegime: z.string().min(1),
  })
  .superRefine((value, ctx) => {
    if (!value.archivePath && !value.sourcesManifest) {
      ctx.addIssue({
        code: "custom",
        message: "query requires archivePath or sourcesManifest",
      });
    }
    if (value.archivePath && value.sourcesManifest) {
      ctx.addIssue({
        code: "custom",
        message: "query accepts archivePath or sourcesManifest, not both",
      });
    }
  });

export const StudyPipelineCorpusEntry = z.object({
  profilePath: z.string().min(1),
  priceSeriesPath: z.string().min(1).optional(),
  priceSeriesAsOfSessionDate: z.string().min(1).optional(),
});

export const StudyPipelineSimilarRegimeInput = z.object({
  factors: z.array(StudyMatchFactorKey).min(1),
  excludeQueryStudy: z.boolean(),
  minMatureSampleSize: z.number().int().positive(),
  corpus: z.array(StudyPipelineCorpusEntry).min(0),
});

export const StudyPipelineMemoInput = z.object({
  /** Default true — deterministic rule-based memo when unset (no network). */
  forceFallback: z.boolean().optional(),
});

export const StudyPipelineManifest = z.object({
  kind: z.literal("StudyPipelineManifest"),
  schemaVersion: z.literal(STUDY_PIPELINE_MANIFEST_SCHEMA_VERSION),
  sessionDate: z.string().min(1),
  symbol: z.string().min(1),
  computedAt: IsoDateTime,
  query: StudyPipelineQueryInput,
  similarRegime: StudyPipelineSimilarRegimeInput,
  memo: StudyPipelineMemoInput.optional(),
});

export const StudyPipelineArtifactPaths = z.object({
  archive: z.string().min(1),
  definition: z.string().min(1),
  queryOutcome: z.string().min(1),
  similarRegimeStudy: z.string().min(1),
  evidenceBundle: z.string().min(1),
  memo: z.string().min(1),
});

export const StudyPipelineRun = z.object({
  kind: z.literal("StudyPipelineRun"),
  schemaVersion: z.literal(STUDY_PIPELINE_RUN_SCHEMA_VERSION),
  sessionDate: z.string().min(1),
  symbol: z.string().min(1),
  manifestPath: z.string().min(1),
  completedAt: IsoDateTime,
  computedAt: IsoDateTime,
  studyId: z.string().min(1),
  evidenceStatus: z.string().min(1),
  memoStatus: z.string().min(1),
  memoSource: z.enum(["abstained", "openai", "rule_based_fallback"]),
  artifactPaths: StudyPipelineArtifactPaths,
});

export type StudyPipelineManifest = z.infer<typeof StudyPipelineManifest>;
export type StudyPipelineRun = z.infer<typeof StudyPipelineRun>;
export type StudyPipelineArtifactPaths = z.infer<
  typeof StudyPipelineArtifactPaths
>;
