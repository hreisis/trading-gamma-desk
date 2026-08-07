import { z } from "zod";
import { IsoDate, IsoDateTime, SessionAlignment } from "./common";

export const MARKET_INPUT_SNAPSHOT_SCHEMA_VERSION = "0.1.0" as const;

export const MARKET_INPUT_KEY_COUNT = 14 as const;

/** Closed set of V2-3A decision inputs — extend only with schema bump. */
export const MarketInputKey = z.enum([
  "spy_quote",
  "qqq_quote",
  "breadth_internals",
  "leadership_rotation",
  "vix_spot",
  "vix_term_structure",
  "us2y",
  "us10y",
  "usd",
  "credit_stress",
  "catalyst_calendar",
  "event_gate",
  "spy_gamma",
  "qqq_gamma",
]);

export const MarketInputFieldStatus = z.enum([
  "available",
  "partial",
  "incomplete",
  "unavailable",
  /** No wired data source in the repository for this input class. */
  "missing",
]);

export const MarketInputSource = z.object({
  provider: z.string().min(1),
  /** Logical artifact label — filesystem path, API route, or fixture id. */
  artifact: z.string().min(1),
  fetchedAt: IsoDateTime.nullable(),
});

export const MarketInputField = z.object({
  key: MarketInputKey,
  label: z.string().min(1),
  value: z.unknown().nullable(),
  asOf: IsoDateTime.nullable(),
  marketSessionDate: IsoDate.nullable(),
  source: MarketInputSource,
  status: MarketInputFieldStatus,
  stale: z.boolean(),
  missingReason: z.string().nullable(),
  isProxy: z.boolean(),
});

export const MarketInputSnapshotSummary = z.object({
  availableCount: z.number().int().nonnegative(),
  partialCount: z.number().int().nonnegative(),
  incompleteCount: z.number().int().nonnegative(),
  unavailableCount: z.number().int().nonnegative(),
  missingCount: z.number().int().nonnegative(),
  staleCount: z.number().int().nonnegative(),
  crossSessionCount: z.number().int().nonnegative(),
});

export type MarketInputKey = z.infer<typeof MarketInputKey>;
export type MarketInputFieldStatus = z.infer<typeof MarketInputFieldStatus>;
export type MarketInputSource = z.infer<typeof MarketInputSource>;
export type MarketInputField = z.infer<typeof MarketInputField>;
export type MarketInputSnapshotSummary = z.infer<
  typeof MarketInputSnapshotSummary
>;

export const MARKET_INPUT_LABELS: Readonly<Record<MarketInputKey, string>> = {
  spy_quote: "SPY quote",
  qqq_quote: "QQQ quote",
  breadth_internals: "Breadth / internals",
  leadership_rotation: "Relative leadership / rotation",
  vix_spot: "VIX spot",
  vix_term_structure: "VIX term structure / positioning",
  us2y: "US 2Y yield",
  us10y: "US 10Y yield",
  usd: "USD",
  credit_stress: "Credit stress",
  catalyst_calendar: "Catalyst calendar",
  event_gate: "Shock / event gate",
  spy_gamma: "SPY bounded gamma",
  qqq_gamma: "QQQ bounded gamma",
};

const REQUIRED_CROSS_SECTION_KEYS = MarketInputKey.options.filter(
  (key) =>
    ![
      "breadth_internals",
      "leadership_rotation",
      "vix_term_structure",
      "credit_stress",
      "event_gate",
    ].includes(key),
);

/** Derive summary and session flags from inputs — single source of truth. */
export function deriveMarketInputSnapshotSummary(
  inputs: readonly MarketInputField[],
  targetMarketSessionDate: string,
): {
  readonly summary: MarketInputSnapshotSummary;
  readonly sessionAlignment: SessionAlignment;
  readonly isCompleteCrossSection: boolean;
} {
  const summary: MarketInputSnapshotSummary = {
    availableCount: 0,
    partialCount: 0,
    incompleteCount: 0,
    unavailableCount: 0,
    missingCount: 0,
    staleCount: 0,
    crossSessionCount: 0,
  };

  for (const field of inputs) {
    switch (field.status) {
      case "available":
        summary.availableCount += 1;
        break;
      case "partial":
        summary.partialCount += 1;
        break;
      case "incomplete":
        summary.incompleteCount += 1;
        break;
      case "unavailable":
        summary.unavailableCount += 1;
        break;
      case "missing":
        summary.missingCount += 1;
        break;
    }
    if (field.stale) summary.staleCount += 1;
    if (
      field.marketSessionDate !== null &&
      field.marketSessionDate !== targetMarketSessionDate
    ) {
      summary.crossSessionCount += 1;
    }
  }

  const required = inputs.filter((field) =>
    REQUIRED_CROSS_SECTION_KEYS.includes(field.key),
  );
  const allRequiredReady = required.every(
    (field) =>
      field.status === "available" && !field.stale && field.missingReason === null,
  );

  let sessionAlignment: SessionAlignment = "aligned";
  if (summary.missingCount > 0 || summary.unavailableCount > 0) {
    sessionAlignment = "partial";
  }
  if (summary.crossSessionCount > 0 || summary.staleCount > 0) {
    sessionAlignment = "stale";
  }
  if (summary.partialCount > 0 && sessionAlignment === "aligned") {
    sessionAlignment = "partial";
  }

  return {
    summary,
    sessionAlignment,
    isCompleteCrossSection: allRequiredReady && summary.missingCount === 0,
  };
}

export function statusCountTotal(summary: MarketInputSnapshotSummary): number {
  return (
    summary.availableCount +
    summary.partialCount +
    summary.incompleteCount +
    summary.unavailableCount +
    summary.missingCount
  );
}

function sortedKeys(inputs: readonly MarketInputField[]): string[] {
  return [...inputs.map((field) => field.key)].sort();
}

export const MarketInputSnapshot = z
  .object({
    kind: z.literal("MarketInputSnapshot"),
    schemaVersion: z.literal(MARKET_INPUT_SNAPSHOT_SCHEMA_VERSION),
    targetMarketSessionDate: IsoDate,
    generatedAt: IsoDateTime,
    sessionAlignment: SessionAlignment,
    /** True only when every required input is available, same-session, and not stale. */
    isCompleteCrossSection: z.boolean(),
    inputs: z.array(MarketInputField),
    summary: MarketInputSnapshotSummary,
  })
  .superRefine((snapshot, ctx) => {
    const expectedKeys = [...MarketInputKey.options].sort();
    const actualKeys = sortedKeys(snapshot.inputs);

    if (snapshot.inputs.length !== MARKET_INPUT_KEY_COUNT) {
      ctx.addIssue({
        code: "custom",
        path: ["inputs"],
        message: `inputs must contain exactly ${MARKET_INPUT_KEY_COUNT} rows`,
      });
    }

    if (actualKeys.length !== new Set(actualKeys).size) {
      ctx.addIssue({
        code: "custom",
        path: ["inputs"],
        message: "input keys must be unique",
      });
    }

    if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
      ctx.addIssue({
        code: "custom",
        path: ["inputs"],
        message: "inputs must contain each MarketInputKey exactly once",
      });
    }

    const statusTotal = statusCountTotal(snapshot.summary);
    if (statusTotal !== snapshot.inputs.length) {
      ctx.addIssue({
        code: "custom",
        path: ["summary"],
        message:
          "availableCount + partialCount + incompleteCount + unavailableCount + missingCount must equal inputs.length",
      });
    }

    const derived = deriveMarketInputSnapshotSummary(
      snapshot.inputs,
      snapshot.targetMarketSessionDate,
    );
    if (JSON.stringify(derived.summary) !== JSON.stringify(snapshot.summary)) {
      ctx.addIssue({
        code: "custom",
        path: ["summary"],
        message: "summary must be derived from inputs",
      });
    }
    if (derived.sessionAlignment !== snapshot.sessionAlignment) {
      ctx.addIssue({
        code: "custom",
        path: ["sessionAlignment"],
        message: "sessionAlignment must be derived from inputs",
      });
    }
    if (derived.isCompleteCrossSection !== snapshot.isCompleteCrossSection) {
      ctx.addIssue({
        code: "custom",
        path: ["isCompleteCrossSection"],
        message: "isCompleteCrossSection must be derived from inputs",
      });
    }
  });

export type MarketInputSnapshot = z.infer<typeof MarketInputSnapshot>;
