import { z } from "zod";
import { IsoDate, IsoDateTime } from "./common";
import { RESEARCH_ARCHIVE_SCHEMA_VERSION } from "./research-archive";

export const STUDY_DEFINITION_SCHEMA_VERSION = "0.1.0";
export const STUDY_DEFINITION_METHODOLOGY_ID = "study_definition_v1";
export const STUDY_DEFINITION_METHODOLOGY_VERSION = "0.1.0";

export const STUDY_OUTCOME_SCHEMA_VERSION = "0.1.0";
export const STUDY_OUTCOME_METHODOLOGY_ID = "forward_outcome_v1";
export const STUDY_OUTCOME_METHODOLOGY_VERSION = "0.1.0";

export const STUDY_PRICE_SERIES_SCHEMA_VERSION = "0.1.0";

export const ForwardHorizon = z.enum(["1D", "5D", "20D"]);

export const HORIZON_SESSIONS: Record<
  z.infer<typeof ForwardHorizon>,
  number
> = {
  "1D": 1,
  "5D": 5,
  "20D": 20,
};

export const OutcomeNumeric = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("available"),
    /** Simple adjClose return over N trading sessions: exitAdjClose/entryAdjClose - 1. */
    value: z.number().finite(),
    /** Entry-session adjClose (same basis as MFE/MAE). */
    entryPrice: z.number().finite().positive(),
    /** Exit-session adjClose at horizon. */
    exitPrice: z.number().finite().positive(),
    entrySessionDate: IsoDate,
    exitSessionDate: IsoDate,
    horizonSessions: z.number().int().positive(),
  }),
  z.object({
    status: z.literal("unavailable"),
    reason: z.string().min(1),
  }),
]);

export const MfeMaeOutcome = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("available"),
    /** Max (adjClose/entryAdjClose - 1) over forward window (exclusive entry). */
    mfe: z.number().finite(),
    /** Min (adjClose/entryAdjClose - 1) over forward window (exclusive entry). */
    mae: z.number().finite(),
    entrySessionDate: IsoDate,
    windowEndSessionDate: IsoDate,
    sessionsObserved: z.number().int().positive(),
  }),
  z.object({
    status: z.literal("unavailable"),
    reason: z.string().min(1),
  }),
]);

export const HorizonMaturity = z.object({
  horizon: ForwardHorizon,
  requiredSessions: z.number().int().positive(),
  sessionsAvailable: z.number().int().nonnegative(),
  status: z.enum(["mature", "immature", "unavailable"]),
  exitSessionDate: IsoDate.optional(),
  reason: z.string().optional(),
});

export const StudyPriceBar = z.object({
  sessionDate: IsoDate,
  adjClose: z.number().finite().positive(),
});

export const StudyPriceSeries = z
  .object({
    kind: z.literal("StudyPriceSeries"),
    schemaVersion: z.literal(STUDY_PRICE_SERIES_SCHEMA_VERSION),
    symbol: z.string().min(1),
    instrument: z.string().min(1),
    source: z.string().min(1),
    synthetic: z.boolean(),
    bars: z.array(StudyPriceBar).min(1),
  })
  .superRefine((series, ctx) => {
    const seen = new Set<string>();
    for (let i = 0; i < series.bars.length; i++) {
      const bar = series.bars[i]!;
      if (seen.has(bar.sessionDate)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate sessionDate ${bar.sessionDate}`,
          path: ["bars", i, "sessionDate"],
        });
      }
      seen.add(bar.sessionDate);
      if (i > 0 && series.bars[i - 1]!.sessionDate >= bar.sessionDate) {
        ctx.addIssue({
          code: "custom",
          message: "bars must be strictly increasing by sessionDate",
          path: ["bars", i, "sessionDate"],
        });
      }
    }
  });

/**
 * PIT study anchor — references archive by exact ID; never embeds forward outcomes.
 */
export const StudyDefinition = z
  .object({
    kind: z.literal("StudyDefinition"),
    schemaVersion: z.literal(STUDY_DEFINITION_SCHEMA_VERSION),
    studyId: z.string().min(1),
    archiveId: z.string().min(1),
    sessionDate: IsoDate,
    symbol: z.string().min(1),
    archiveRef: z.object({
      relativePath: z.string().min(1),
      schemaVersion: z.literal(RESEARCH_ARCHIVE_SCHEMA_VERSION),
    }),
    builtAt: IsoDateTime,
    methodologyId: z.literal(STUDY_DEFINITION_METHODOLOGY_ID),
    methodologyVersion: z.literal(STUDY_DEFINITION_METHODOLOGY_VERSION),
    synthetic: z.boolean(),
    limitations: z.array(z.string()),
  })
  .superRefine((def, ctx) => {
    const expected = buildStudyId(def.archiveId, def.symbol);
    if (def.studyId !== expected) {
      ctx.addIssue({
        code: "custom",
        message: `studyId must be ${expected}`,
        path: ["studyId"],
      });
    }
  });

/**
 * Forward-looking outcome artifact — separate from PIT archives.
 * Must never be merged into replay/archive inputs.
 */
export const StudyForwardOutcome = z
  .object({
    kind: z.literal("StudyForwardOutcome"),
    schemaVersion: z.literal(STUDY_OUTCOME_SCHEMA_VERSION),
    outcomeId: z.string().min(1),
    studyId: z.string().min(1),
    archiveId: z.string().min(1),
    sessionDate: IsoDate,
    symbol: z.string().min(1),
    /** Last trading session included in the price series — hard cap on forward look. */
    priceSeriesAsOfSessionDate: IsoDate,
    methodologyId: z.literal(STUDY_OUTCOME_METHODOLOGY_ID),
    methodologyVersion: z.literal(STUDY_OUTCOME_METHODOLOGY_VERSION),
    computedAt: IsoDateTime,
    provenance: z.object({
      priceSourceKind: z.enum(["fixture", "local_store"]),
      relativePath: z.string().min(1),
      instrument: z.string().min(1),
      synthetic: z.boolean(),
    }),
    maturity: z.array(HorizonMaturity).length(3),
    returns: z.object({
      d1: OutcomeNumeric,
      d5: OutcomeNumeric,
      d20: OutcomeNumeric,
    }),
    excursion: z.object({
      d1: MfeMaeOutcome,
      d5: MfeMaeOutcome,
      d20: MfeMaeOutcome,
    }),
    limitations: z.array(z.string()),
    pitIsolation: z.literal(true),
  })
  .superRefine((outcome, ctx) => {
    const expected = buildOutcomeId(
      outcome.studyId,
      outcome.priceSeriesAsOfSessionDate,
    );
    if (outcome.outcomeId !== expected) {
      ctx.addIssue({
        code: "custom",
        message: `outcomeId must be ${expected}`,
        path: ["outcomeId"],
      });
    }
    if (outcome.sessionDate > outcome.priceSeriesAsOfSessionDate) {
      ctx.addIssue({
        code: "custom",
        message: "sessionDate must not be after priceSeriesAsOfSessionDate",
        path: ["sessionDate"],
      });
    }
  });

export function buildStudyId(archiveId: string, symbol: string): string {
  return `study|${archiveId}|${symbol}|${STUDY_DEFINITION_METHODOLOGY_VERSION}`;
}

export function buildOutcomeId(
  studyId: string,
  priceSeriesAsOfSessionDate: string,
): string {
  return `outcome|${studyId}|${priceSeriesAsOfSessionDate}`;
}

export type ForwardHorizon = z.infer<typeof ForwardHorizon>;
export type OutcomeNumeric = z.infer<typeof OutcomeNumeric>;
export type MfeMaeOutcome = z.infer<typeof MfeMaeOutcome>;
export type HorizonMaturity = z.infer<typeof HorizonMaturity>;
export type StudyPriceBar = z.infer<typeof StudyPriceBar>;
export type StudyPriceSeries = z.infer<typeof StudyPriceSeries>;
export type StudyDefinition = z.infer<typeof StudyDefinition>;
export type StudyForwardOutcome = z.infer<typeof StudyForwardOutcome>;
