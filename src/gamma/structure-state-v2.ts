import {
  ESTIMATED_GAMMA_SCHEMA_VERSION,
  GEX_METHODOLOGY_ID,
  GEX_METHODOLOGY_VERSION,
  MARKET_STRUCTURE_FEATURE_METHODOLOGY_ID,
  MARKET_STRUCTURE_FEATURE_METHODOLOGY_VERSION_V2,
  MARKET_STRUCTURE_STATE_V2_SCHEMA_VERSION,
  MarketStructureStateV2,
  BOUNDED_GAMMA_PROVIDER_SCHEMA_VERSION,
  BOUNDED_GAMMA_SCOPE,
  type BoundedGammaProviderSnapshot,
  type BoundedWallLevel,
  type CoverageRatio,
  type GammaChangeSet,
  type GammaFlipLevel,
  type MarketStructureStateV2 as MarketStructureStateV2Dto,
  type SpotWallCorridor,
  type StructureBaselineFeatures,
  type StructureChangeContext,
  type StructureConditionState,
  type StructureEvidenceEntry,
  type StructureInterpretation,
  type WallDistance,
  type ZeroDteShareFeature,
} from "@/contracts";
import { unavailableGammaFlip } from "./aggregate";

/** Forbidden substrings for interpretation copy (case-insensitive). */
const FORBIDDEN_INTERPRETATION = [
  /\bbuy\b/i,
  /\bsell\b/i,
  /\bbullish\b/i,
  /\bbearish\b/i,
  /money is flowing/i,
  /funds? (are )?flowing/i,
  /market call wall/i,
  /market put wall/i,
  /full[- ]chain (market )?wall/i,
  /standalone predictive/i,
];

export class MarketStructureV2Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarketStructureV2Error";
  }
}

function wallHasStrike(
  wall: BoundedWallLevel,
): wall is BoundedWallLevel & { strike: number } {
  return (
    (wall.status === "available" ||
      wall.status === "incomplete" ||
      wall.status === "partial") &&
    typeof wall.strike === "number" &&
    Number.isFinite(wall.strike)
  );
}

function wallDistance(
  label: string,
  spot: number | null,
  wall: BoundedWallLevel,
): WallDistance {
  if (spot === null) {
    return { status: "unavailable", reason: "spot unavailable" };
  }
  if (!wallHasStrike(wall)) {
    return { status: "unavailable", reason: `${label} unavailable` };
  }
  const wallStrike = wall.strike;
  const points = spot - wallStrike;
  const pct =
    wallStrike === 0
      ? {
          status: "unavailable" as const,
          reason: "wall strike is zero; percentage distance undefined",
        }
      : {
          status: "available" as const,
          value: (points / wallStrike) * 100,
        };
  return {
    status: "available",
    wallStrike,
    spot,
    points,
    pct,
  };
}

function spotWallCorridor(
  spot: number | null,
  putWall: BoundedWallLevel,
  callWall: BoundedWallLevel,
): SpotWallCorridor {
  if (spot === null) {
    return {
      status: "unavailable",
      reason: "spot unavailable",
      position: "unavailable",
    };
  }
  if (!wallHasStrike(putWall)) {
    return {
      status: "unavailable",
      reason: "boundedPutWall unavailable",
      position: "unavailable",
    };
  }
  if (!wallHasStrike(callWall)) {
    return {
      status: "unavailable",
      reason: "boundedCallWall unavailable",
      position: "unavailable",
    };
  }
  const putWallStrike = putWall.strike;
  const callWallStrike = callWall.strike;
  if (putWallStrike >= callWallStrike) {
    return {
      status: "unavailable",
      reason: "boundedPutWall >= boundedCallWall; corridor undefined",
      position: "unavailable",
    };
  }

  let position:
    | "below_put_wall"
    | "at_put_wall"
    | "between_walls"
    | "at_call_wall"
    | "above_call_wall";
  if (spot < putWallStrike) position = "below_put_wall";
  else if (spot === putWallStrike) position = "at_put_wall";
  else if (spot < callWallStrike) position = "between_walls";
  else if (spot === callWallStrike) position = "at_call_wall";
  else position = "above_call_wall";

  return {
    status: "available",
    position,
    putWallStrike,
    callWallStrike,
    spot,
  };
}

function coverageRatio(
  contractsUsed: number,
  contractsIn: number,
): CoverageRatio {
  if (contractsIn === 0) {
    return {
      status: "unavailable",
      reason: "contractsIn is zero; coverage ratio undefined",
      contractsUsed,
      contractsIn,
    };
  }
  return {
    status: "available",
    contractsUsed,
    contractsIn,
    value: contractsUsed / contractsIn,
  };
}

function zeroDteShare(
  snapshot: BoundedGammaProviderSnapshot,
): ZeroDteShareFeature {
  const z = snapshot.zeroDte;
  if (z.status === "unavailable") {
    return {
      status: "unavailable",
      reason: z.reason ?? "zeroDte unavailable",
    };
  }
  if (z.shareOfGrossGex === null) {
    return {
      status: "unavailable",
      reason: "zeroDte shareOfGrossGex unavailable",
    };
  }
  return { status: "available", value: z.shareOfGrossGex };
}

/**
 * Condition taxonomy from availability + regime.
 * Completeness issues dominate regime labels.
 */
export function deriveStructureCondition(input: {
  readonly availability: BoundedGammaProviderSnapshot["status"];
  readonly regime: BoundedGammaProviderSnapshot["gammaRegime"];
}): StructureConditionState {
  if (
    input.availability === "unavailable" ||
    input.regime === "unavailable"
  ) {
    return "unavailable";
  }
  if (
    input.availability === "incomplete" ||
    input.availability === "partial"
  ) {
    return "incomplete_structure";
  }
  if (input.regime === "positive") return "positive_gamma_stabilizing";
  if (input.regime === "negative") return "negative_gamma_amplifying";
  if (input.regime === "near_zero") return "near_zero_transition";
  return "unavailable";
}

function assertNoForbiddenCopy(text: string, field: string): void {
  for (const re of FORBIDDEN_INTERPRETATION) {
    if (re.test(text)) {
      throw new MarketStructureV2Error(
        `${field} contains forbidden language matching ${re}`,
      );
    }
  }
}

function formatNum(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "null";
  return String(n);
}

function buildEvidence(
  snapshot: BoundedGammaProviderSnapshot,
  distCall: WallDistance,
  distPut: WallDistance,
  change: StructureChangeContext,
): StructureEvidenceEntry[] {
  const suspect = snapshot.coverage.suspectVendorGreeksCount ?? 0;
  const usablePct = snapshot.coverage.usableGammaCoveragePct;
  const entries: StructureEvidenceEntry[] = [
    {
      id: "total_gex",
      statement: "Total GEX from bounded single-expiry sample",
      basis: formatNum(snapshot.totalGex),
    },
    {
      id: "gross_gex",
      statement: "Gross GEX mass in bounded single-expiry sample",
      basis: formatNum(snapshot.grossGex),
    },
    {
      id: "spot_vs_bounded_call_wall",
      statement:
        distCall.status === "available"
          ? `Spot relative to Bounded Call Wall (${distCall.wallStrike})`
          : "Spot vs Bounded Call Wall unavailable",
      basis:
        distCall.status === "available"
          ? `points=${distCall.points}`
          : distCall.reason,
    },
    {
      id: "spot_vs_bounded_put_wall",
      statement:
        distPut.status === "available"
          ? `Spot relative to Bounded Put Wall (${distPut.wallStrike})`
          : "Spot vs Bounded Put Wall unavailable",
      basis:
        distPut.status === "available"
          ? `points=${distPut.points}`
          : distPut.reason,
    },
    {
      id: "dte",
      statement: "Calendar DTE from vendor asOf session to expiration",
      basis: `dte=${snapshot.dte};zeroDteStatus=${snapshot.zeroDte.status}`,
    },
    {
      id: "usable_gamma_coverage",
      statement: "Usable gamma coverage after data-quality exclusions",
      basis:
        usablePct === undefined
          ? `used=${snapshot.coverage.contractsUsed}/${snapshot.coverage.contractsIn}`
          : `usableGammaCoveragePct=${usablePct}`,
    },
    {
      id: "suspect_vendor_greeks",
      statement: "Positive-OI contracts excluded as suspect_vendor_greeks",
      basis: `count=${suspect}`,
    },
    {
      id: "scope_strike_range",
      statement: "Bounded single-expiry strike request",
      basis: `scope=${snapshot.scope};exp=${snapshot.expiration};strikes=${snapshot.strikeRequest.min}-${snapshot.strikeRequest.max} step ${snapshot.strikeRequest.step}`,
    },
  ];

  if (change.status === "unavailable") {
    entries.push({
      id: "change_context",
      statement: "Prior-close / since-open change context unavailable",
      basis: change.reason,
    });
  } else {
    const prior = change.versusPriorClose.metrics.totalGex;
    const open = change.versusSessionOpen.metrics.totalGex;
    entries.push({
      id: "change_prior_close",
      statement: "Total GEX vs prior-close baseline",
      basis:
        prior.status === "available"
          ? `absoluteChange=${prior.absoluteChange}`
          : `unavailable:${prior.reason}`,
    });
    entries.push({
      id: "change_session_open",
      statement: "Total GEX vs session-open baseline",
      basis:
        open.status === "available"
          ? `absoluteChange=${open.absoluteChange}`
          : `unavailable:${open.reason}`,
    });
  }

  return entries;
}

function buildInterpretation(
  snapshot: BoundedGammaProviderSnapshot,
  condition: StructureConditionState,
): StructureInterpretation {
  const suspect = snapshot.coverage.suspectVendorGreeksCount ?? 0;
  const scopeNote =
    "Scope is BOUNDED · SINGLE EXPIRY — not a full-option-chain market estimate.";

  let summary: string;
  const bullets: string[] = [scopeNote];

  switch (condition) {
    case "unavailable":
      summary =
        "Bounded expiry structure is unavailable; no usable GEX interpretation can be formed from this sample.";
      bullets.push(
        "Treat spot/level comparisons as undefined until a usable bounded sample is available.",
      );
      break;
    case "incomplete_structure":
      summary =
        suspect > 0
          ? "Interpretation is degraded because positive-OI contracts were excluded by vendor-Greek quality checks within this bounded expiry sample."
          : "Interpretation is degraded because this bounded expiry sample has incomplete or partial coverage.";
      bullets.push(
        `Availability=${snapshot.status}; regime=${snapshot.gammaRegime} remains visible but coverage is incomplete.`,
      );
      if (suspect > 0) {
        bullets.push(
          `${suspect} contract(s) excluded as suspect_vendor_greeks; original vendor Greeks were not repaired.`,
        );
      }
      bullets.push(
        "This remains a structure condition for the requested strike range — not a directional forecast.",
      );
      break;
    case "positive_gamma_stabilizing":
      summary =
        "Within this bounded expiry sample, dealer hedging may be more stabilizing while spot remains near observed concentration levels.";
      bullets.push(
        "Positive total GEX in the sample is a conditional amplifier/compressor cue, not a trade recommendation.",
      );
      bullets.push(
        "Read Bounded Call Wall and Bounded Put Wall only as concentrations inside the requested strike range.",
      );
      break;
    case "negative_gamma_amplifying":
      summary =
        "Within this bounded expiry sample, hedging sensitivity may amplify moves; this is a structure condition, not a directional forecast.";
      bullets.push(
        "Negative total GEX in the sample does not imply a predicted direction for the underlying.",
      );
      bullets.push(
        "Bounded Call Wall and Bounded Put Wall remain sample-local levels, not full-market walls.",
      );
      break;
    case "near_zero_transition":
      summary =
        "Within this bounded expiry sample, net GEX is near zero relative to gross mass — a transitional structure condition.";
      bullets.push(
        "Near-zero is about balance of signed GEX mass in the sample, not a prediction of breakout direction.",
      );
      bullets.push(scopeNote);
      break;
  }

  if (snapshot.dte === 1) {
    bullets.push(
      "Sample is 1 DTE relative to vendor asOf — not labeled 0DTE.",
    );
  } else if (snapshot.dte === 0) {
    bullets.push("Sample expiration matches vendor sessionDate (0 DTE).");
  }

  const interpretation = { summary, bullets };
  assertNoForbiddenCopy(summary, "interpretation.summary");
  for (const b of bullets) {
    assertNoForbiddenCopy(b, "interpretation.bullets");
  }
  return interpretation;
}

function assertBoundedWallScope(wall: BoundedWallLevel, label: string): void {
  if (wall.scope !== BOUNDED_GAMMA_SCOPE) {
    throw new MarketStructureV2Error(
      `${label} must retain scope=${BOUNDED_GAMMA_SCOPE}`,
    );
  }
}

function changeSetCompatible(
  snapshot: BoundedGammaProviderSnapshot,
  changeSet: GammaChangeSet,
): { ok: true } | { ok: false; reason: string } {
  if (changeSet.underlying !== snapshot.symbol) {
    return {
      ok: false,
      reason: `changeSet underlying ${changeSet.underlying} != symbol ${snapshot.symbol}`,
    };
  }
  if (changeSet.methodologyId !== GEX_METHODOLOGY_ID) {
    return {
      ok: false,
      reason: `changeSet methodologyId ${changeSet.methodologyId} unsupported`,
    };
  }
  if (changeSet.methodologyVersion !== GEX_METHODOLOGY_VERSION) {
    return {
      ok: false,
      reason: `changeSet methodologyVersion ${changeSet.methodologyVersion} != ${GEX_METHODOLOGY_VERSION}`,
    };
  }
  if (changeSet.sessionDate !== snapshot.sessionDate) {
    return {
      ok: false,
      reason: `changeSet sessionDate ${changeSet.sessionDate} != ${snapshot.sessionDate}`,
    };
  }
  return { ok: true };
}

function directionFromAbsoluteChange(
  absoluteChange: number,
): StructureBaselineFeatures["totalGexDirection"] {
  if (absoluteChange > 0) {
    return { status: "available", direction: "higher" };
  }
  if (absoluteChange < 0) {
    return { status: "available", direction: "lower" };
  }
  return { status: "available", direction: "unchanged" };
}

function baselineFromComparison(
  comparison: GammaChangeSet["versusPriorClose"],
): StructureBaselineFeatures {
  const m = comparison.metrics;
  const numericDir = (
    change: typeof m.totalGex,
  ): StructureBaselineFeatures["totalGexDirection"] => {
    if (change.status === "unavailable") {
      return {
        status: "unavailable",
        reason: change.reason,
        direction: "unavailable",
      };
    }
    return directionFromAbsoluteChange(change.absoluteChange);
  };
  const wallDir = (
    change: typeof m.callWall,
  ): StructureBaselineFeatures["callWallShiftDirection"] => {
    if (change.status === "unavailable") {
      return {
        status: "unavailable",
        reason: change.reason,
        direction: "unavailable",
      };
    }
    return directionFromAbsoluteChange(change.absoluteChange);
  };

  return {
    baseline: comparison.baseline,
    gammaRegimeTransition: m.gammaRegime,
    totalGexDirection: numericDir(m.totalGex),
    callWallShiftDirection: wallDir(m.callWall),
    putWallShiftDirection: wallDir(m.putWall),
    zeroDteShareOfGrossGexDirection: numericDir(m.zeroDteShareOfGrossGex),
    metrics: m,
  };
}

function resolveChangeContext(
  snapshot: BoundedGammaProviderSnapshot,
  changeSet: GammaChangeSet | null | undefined,
): StructureChangeContext {
  if (!changeSet) {
    return {
      status: "unavailable",
      reason:
        "No compatible GammaChangeSet supplied — prior-close / since-open context unavailable",
    };
  }
  const compat = changeSetCompatible(snapshot, changeSet);
  if (!compat.ok) {
    return {
      status: "unavailable",
      reason: `Incompatible GammaChangeSet: ${compat.reason}`,
    };
  }
  return {
    status: "available",
    versusPriorClose: baselineFromComparison(changeSet.versusPriorClose),
    versusSessionOpen: baselineFromComparison(changeSet.versusSessionOpen),
  };
}

export interface BuildMarketStructureStateV2Input {
  readonly bounded: BoundedGammaProviderSnapshot;
  readonly changeSet?: GammaChangeSet | null;
  readonly generatedAt?: string;
}

/**
 * Pure: MarketStructureState v0.2.0 from a BoundedGammaProviderSnapshot.
 * Optional GammaChangeSet — mismatched/missing → changeContext unavailable.
 * Never fabricates flip, repairs Greeks, or invents full-chain walls.
 */
export function buildMarketStructureStateV2(
  input: BuildMarketStructureStateV2Input,
): MarketStructureStateV2Dto {
  const snapshot = input.bounded;
  if (snapshot.scope !== BOUNDED_GAMMA_SCOPE) {
    throw new MarketStructureV2Error(
      `expected scope ${BOUNDED_GAMMA_SCOPE}, got ${snapshot.scope}`,
    );
  }
  assertBoundedWallScope(snapshot.boundedCallWall, "boundedCallWall");
  assertBoundedWallScope(snapshot.boundedPutWall, "boundedPutWall");

  const spot = snapshot.spot;
  const distCall = wallDistance(
    "boundedCallWall",
    spot,
    snapshot.boundedCallWall,
  );
  const distPut = wallDistance(
    "boundedPutWall",
    spot,
    snapshot.boundedPutWall,
  );
  const condition = deriveStructureCondition({
    availability: snapshot.status,
    regime: snapshot.gammaRegime,
  });
  const changeContext = resolveChangeContext(snapshot, input.changeSet);
  const evidence = buildEvidence(snapshot, distCall, distPut, changeContext);
  const interpretation = buildInterpretation(snapshot, condition);
  const flip: GammaFlipLevel = unavailableGammaFlip();
  const generatedAt = input.generatedAt ?? snapshot.generatedAt;

  const result: MarketStructureStateV2Dto = {
    kind: "MarketStructureState",
    schemaVersion: MARKET_STRUCTURE_STATE_V2_SCHEMA_VERSION,
    symbol: snapshot.symbol,
    generatedAt,
    asOf: snapshot.vendorAsOf,
    vendorAsOf: snapshot.vendorAsOf,
    sessionDate: snapshot.sessionDate,
    source: {
      provider: snapshot.source.provider,
      name: snapshot.source.name,
      fetchedAt: snapshot.source.fetchedAt,
    },
    methodology: {
      id: GEX_METHODOLOGY_ID,
      version: GEX_METHODOLOGY_VERSION,
      featureMethodologyId: MARKET_STRUCTURE_FEATURE_METHODOLOGY_ID,
      featureMethodologyVersion:
        MARKET_STRUCTURE_FEATURE_METHODOLOGY_VERSION_V2,
    },
    scope: BOUNDED_GAMMA_SCOPE,
    expiration: snapshot.expiration,
    dte: snapshot.dte,
    zeroDteStatus: snapshot.zeroDte.status,
    availability: snapshot.status,
    dataDelay: "unknown",
    limitations: [
      "BOUNDED single-expiry structure interpretation — not full-chain market walls.",
      ...snapshot.limitations,
    ],
    synthetic: snapshot.synthetic,
    sourceBoundedSchemaVersion: BOUNDED_GAMMA_PROVIDER_SCHEMA_VERSION,
    sourceStructureSchemaVersion: ESTIMATED_GAMMA_SCHEMA_VERSION,
    regime: snapshot.gammaRegime,
    spot,
    totalGex: snapshot.totalGex,
    grossGex: snapshot.grossGex,
    boundedCallWall: { ...snapshot.boundedCallWall },
    boundedPutWall: { ...snapshot.boundedPutWall },
    flip,
    spotWallCorridor: spotWallCorridor(
      spot,
      snapshot.boundedPutWall,
      snapshot.boundedCallWall,
    ),
    distanceToBoundedCallWall: distCall,
    distanceToBoundedPutWall: distPut,
    zeroDteShareOfGrossGex: zeroDteShare(snapshot),
    coverage: {
      contractsIn: snapshot.coverage.contractsIn,
      contractsUsed: snapshot.coverage.contractsUsed,
      contractsSkipped: snapshot.coverage.contractsSkipped,
      skipReasons: { ...snapshot.coverage.skipReasons },
      nonNullGammaCount: snapshot.coverage.nonNullGammaCount,
      usableGammaCount: snapshot.coverage.usableGammaCount,
      nonNullGammaCoveragePct: snapshot.coverage.nonNullGammaCoveragePct,
      usableGammaCoveragePct: snapshot.coverage.usableGammaCoveragePct,
      suspectVendorGreeksCount: snapshot.coverage.suspectVendorGreeksCount,
      coverageRatio: coverageRatio(
        snapshot.coverage.contractsUsed,
        snapshot.coverage.contractsIn,
      ),
    },
    condition,
    evidence,
    interpretation,
    changeContext,
  };

  return MarketStructureStateV2.parse(result);
}
