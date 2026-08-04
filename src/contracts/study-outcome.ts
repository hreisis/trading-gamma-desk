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

export const StudyPriceSeriesProvenance = z.object({
  sourceKind: z.literal("local_store"),
  asOfSessionDate: IsoDate,
  ingestedAt: IsoDateTime,
  firstSessionDate: IsoDate,
  lastSessionDate: IsoDate,
  barCount: z.number().int().positive(),
  sourceArtifactRef: z.object({
    relativePath: z.string().min(1),
    vendor: z.string().min(1),
  }),
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
    provenance: StudyPriceSeriesProvenance.optional(),
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

    if (!series.synthetic) {
      if (series.source.startsWith("fixtures/")) {
        ctx.addIssue({
          code: "custom",
          message: "non-synthetic price series cannot reference fixture source path",
          path: ["source"],
        });
      }
      if (!series.provenance) {
        ctx.addIssue({
          code: "custom",
          message: "non-synthetic price series requires provenance",
          path: ["provenance"],
        });
      }
    }

    if (series.synthetic && series.provenance?.sourceKind === "local_store") {
      ctx.addIssue({
        code: "custom",
        message: "synthetic price series cannot claim local_store provenance",
        path: ["provenance", "sourceKind"],
      });
    }

    if (series.provenance) {
      const prov = series.provenance;
      const first = series.bars[0]!.sessionDate;
      const last = series.bars[series.bars.length - 1]!.sessionDate;
      if (prov.firstSessionDate !== first) {
        ctx.addIssue({
          code: "custom",
          message: "provenance.firstSessionDate must match first bar",
          path: ["provenance", "firstSessionDate"],
        });
      }
      if (prov.lastSessionDate !== last) {
        ctx.addIssue({
          code: "custom",
          message: "provenance.lastSessionDate must match last bar",
          path: ["provenance", "lastSessionDate"],
        });
      }
      if (prov.asOfSessionDate !== last) {
        ctx.addIssue({
          code: "custom",
          message: "provenance.asOfSessionDate must equal last bar sessionDate",
          path: ["provenance", "asOfSessionDate"],
        });
      }
      if (prov.barCount !== series.bars.length) {
        ctx.addIssue({
          code: "custom",
          message: "provenance.barCount must match bars.length",
          path: ["provenance", "barCount"],
        });
      }
      if (prov.sourceArtifactRef.relativePath.startsWith("fixtures/")) {
        ctx.addIssue({
          code: "custom",
          message: "provenance sourceArtifactRef cannot reference fixtures/",
          path: ["provenance", "sourceArtifactRef", "relativePath"],
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
export type StudyPriceSeriesProvenance = z.infer<
  typeof StudyPriceSeriesProvenance
>;
export type StudyPriceSeries = z.infer<typeof StudyPriceSeries>;
export type StudyDefinition = z.infer<typeof StudyDefinition>;
export type StudyForwardOutcome = z.infer<typeof StudyForwardOutcome>;
