/**
 * Gamma Cone — volatility-derived probability ranges with gamma-structure overlay.
 * Statistical bands use symbol representative IV only; walls/flip are overlays.
 */

import type { AlpacaMarketQuote } from "@/contracts/alpaca-market";
import type { BoundedGammaProviderSnapshot } from "@/contracts";
import type { BoundedGammaDeskView } from "./load-bounded-gamma";
import { wallStrikeWhenAvailable } from "./bounded-gamma-freshness";
import {
  computeRestOfDayConeBands,
  dealerFlowRegimeLabel,
  estimateWallTouchProbabilities,
  formatOptionsIvCloseLabel,
  fullSessionConeBands,
  readGammaFlipStrike,
  summarizeVolMispricing,
  ANNUAL_TRADING_DAYS,
  type GammaConeRangeBand,
  type RestOfDayConeBands,
} from "./format-gamma";
import { resolveLastCompletedMarketSessionDate } from "@/ai-study/session";

export type GammaConeStatus = "available" | "unavailable" | "partial";

export type GammaConeVrpRegime =
  | "rich_implied"
  | "normal"
  | "cheap_implied";

export interface GammaConeVolatility {
  readonly ivPct: number | null;
  readonly hv20Pct: number | null;
  readonly vrpVolPts: number | null;
  readonly vrpRegime: GammaConeVrpRegime | null;
}

export interface GammaConeFullSession {
  readonly sigmaPoints: number | null;
  readonly coreRange50: GammaConeRangeBand | null;
  readonly expectedRange90: GammaConeRangeBand | null;
}

export interface GammaConeRestOfDay {
  readonly status: "available" | "unavailable";
  readonly remainingSessionFraction: number | null;
  readonly sigmaPoints: number | null;
  readonly coreRange50: GammaConeRangeBand | null;
  readonly expectedRange90: GammaConeRangeBand | null;
}

export interface GammaConeStructure {
  readonly callWall: number | null;
  readonly gammaFlip: number | null;
  readonly spot: number | null;
  readonly putWall: number | null;
  readonly gammaRegime: BoundedGammaProviderSnapshot["gammaRegime"] | null;
  readonly dealerFlowRegime: string | null;
}

export interface GammaConeWallTouch {
  readonly callWallPercent: number | null;
  readonly putWallPercent: number | null;
}

export interface GammaConeInterpretation {
  readonly regime: string | null;
  readonly rangeReliability: string | null;
  readonly warnings: readonly string[];
}

export interface GammaConeProvenance {
  readonly ivSource: "bounded_representative_iv" | "unavailable";
  readonly ivSessionDate: string | null;
  readonly ivAsOf: string | null;
  readonly ivDataLabel: string | null;
  readonly optionsSessionDate: string | null;
  readonly isFixture: boolean;
  readonly fullSessionMode: "annual_iv_over_sqrt_252";
  readonly restOfDayMode: "sqrt_remaining_session_fraction";
}

export interface GammaConeResult {
  readonly status: GammaConeStatus;
  readonly symbol: "SPY" | "QQQ";
  readonly spot: number | null;
  readonly volatility: GammaConeVolatility;
  readonly fullSession: GammaConeFullSession;
  readonly restOfDay: GammaConeRestOfDay;
  readonly structure: GammaConeStructure;
  readonly wallTouch: GammaConeWallTouch;
  readonly interpretation: GammaConeInterpretation;
  readonly provenance: GammaConeProvenance;
}

const EMPTY_FULL_SESSION: GammaConeFullSession = {
  sigmaPoints: null,
  coreRange50: null,
  expectedRange90: null,
};

const EMPTY_REST_OF_DAY: GammaConeRestOfDay = {
  status: "unavailable",
  remainingSessionFraction: null,
  sigmaPoints: null,
  coreRange50: null,
  expectedRange90: null,
};

const EMPTY_WALL_TOUCH: GammaConeWallTouch = {
  callWallPercent: null,
  putWallPercent: null,
};

function resolveConeSpot(
  symbol: "SPY" | "QQQ",
  marketQuotes: readonly AlpacaMarketQuote[] | undefined,
  gammaSpot: number | null,
): number | null {
  const quote = marketQuotes?.find((row) => row.symbol === symbol);
  if (
    quote?.status === "available" &&
    quote.latestPrice !== null &&
    Number.isFinite(quote.latestPrice) &&
    quote.latestPrice > 0
  ) {
    return quote.latestPrice;
  }
  if (gammaSpot !== null && Number.isFinite(gammaSpot) && gammaSpot > 0) {
    return gammaSpot;
  }
  return null;
}

function classifyVrpRegime(spreadVolPts: number | null): GammaConeVrpRegime | null {
  if (spreadVolPts === null || !Number.isFinite(spreadVolPts)) return null;
  if (spreadVolPts > 2) return "rich_implied";
  if (spreadVolPts < -2) return "cheap_implied";
  return "normal";
}

function buildGammaRegimeInterpretation(input: {
  readonly regime: BoundedGammaProviderSnapshot["gammaRegime"] | null;
  readonly spot: number | null;
  readonly flipStrike: number | null;
}): { readonly regime: string | null; readonly warnings: string[] } {
  const warnings: string[] = [];
  let regimeLabel: string | null = null;

  switch (input.regime) {
    case "positive":
      regimeLabel =
        "Positive gamma — stabilizing dealer flow; mean-reversion / compression context";
      break;
    case "negative":
      regimeLabel =
        "Negative gamma — amplifying dealer flow; trend-amplification context (not a directional call)";
      break;
    case "near_zero":
      regimeLabel = "Near flip / transition — fragile gamma regime";
      warnings.push("Gamma near flip — regime transition risk");
      break;
    case "unavailable":
      regimeLabel = null;
      break;
    default:
      regimeLabel = null;
  }

  if (
    input.spot !== null &&
    input.flipStrike !== null &&
    Number.isFinite(input.spot) &&
    Number.isFinite(input.flipStrike) &&
    input.spot < input.flipStrike
  ) {
    warnings.push("Spot below gamma flip — volatility expansion risk");
  }

  return { regime: regimeLabel, warnings };
}

function rangeReliabilityLabel(input: {
  readonly vrpRegime: GammaConeVrpRegime | null;
  readonly gammaFresh: boolean;
  readonly ivAvailable: boolean;
}): string | null {
  if (!input.ivAvailable) return null;
  if (!input.gammaFresh) {
    return "Dated options IV — intraday cone may be stale";
  }
  if (input.vrpRegime === "cheap_implied") {
    return "IV below HV20 — realized moves may exceed the implied cone";
  }
  if (input.vrpRegime === "rich_implied") {
    return "IV above HV20 — implied range may look generous vs recent realized vol";
  }
  return "IV and HV20 aligned — implied cone near recent realized volatility";
}

function unavailableCone(
  symbol: "SPY" | "QQQ",
  isFixture: boolean,
): GammaConeResult {
  return {
    status: "unavailable",
    symbol,
    spot: null,
    volatility: {
      ivPct: null,
      hv20Pct: null,
      vrpVolPts: null,
      vrpRegime: null,
    },
    fullSession: EMPTY_FULL_SESSION,
    restOfDay: EMPTY_REST_OF_DAY,
    structure: {
      callWall: null,
      gammaFlip: null,
      spot: null,
      putWall: null,
      gammaRegime: null,
      dealerFlowRegime: null,
    },
    wallTouch: EMPTY_WALL_TOUCH,
    interpretation: {
      regime: null,
      rangeReliability: null,
      warnings: [],
    },
    provenance: {
      ivSource: "unavailable",
      ivSessionDate: null,
      ivAsOf: null,
      ivDataLabel: null,
      optionsSessionDate: null,
      isFixture,
      fullSessionMode: "annual_iv_over_sqrt_252",
      restOfDayMode: "sqrt_remaining_session_fraction",
    },
  };
}

export function buildGammaCone(input: {
  readonly symbol: "SPY" | "QQQ";
  readonly view: BoundedGammaDeskView;
  readonly now: Date;
  readonly marketQuotes?: readonly AlpacaMarketQuote[];
  readonly equityBarsBySymbol?: ReadonlyMap<
    string,
    readonly { sessionDate: string; close: number }[]
  >;
}): GammaConeResult {
  const snapshot = input.view.snapshot ?? input.view.withheldSnapshot;
  if (!snapshot) {
    return unavailableCone(input.symbol, input.view.isFixture);
  }

  const spot = resolveConeSpot(
    input.symbol,
    input.marketQuotes,
    snapshot.spot,
  );
  const ivField = snapshot.representativeIv;
  const ivDecimal =
    ivField?.status === "available" &&
    ivField.value !== null &&
    Number.isFinite(ivField.value) &&
    ivField.value > 0
      ? ivField.value
      : null;

  const volMispricing = summarizeVolMispricing({
    representativeIv: ivField,
    hv20Bars: input.equityBarsBySymbol?.get(input.symbol),
    isFixture: input.view.isFixture,
  });

  const vrpVolPts = volMispricing.spreadVolPts;
  const vrpRegime = classifyVrpRegime(vrpVolPts);

  const warnings: string[] = [];
  if (vrpRegime === "cheap_implied") {
    warnings.push(
      "Negative VRP (IV below HV20) — realized movement may exceed the implied statistical cone",
    );
  }

  const callWall = wallStrikeWhenAvailable(snapshot.boundedCallWall);
  const putWall = wallStrikeWhenAvailable(snapshot.boundedPutWall);
  const flipStrike = readGammaFlipStrike(snapshot);
  const gammaRegime = snapshot.gammaRegime;

  const regimeInterp = buildGammaRegimeInterpretation({
    regime: gammaRegime,
    spot,
    flipStrike,
  });
  warnings.push(...regimeInterp.warnings);

  const targetSession = resolveLastCompletedMarketSessionDate(input.now);
  const gammaFresh =
    input.view.freshness === "fresh" &&
    snapshot.sessionDate === targetSession;

  let fullSession: GammaConeFullSession = EMPTY_FULL_SESSION;
  let restOfDay: GammaConeRestOfDay = EMPTY_REST_OF_DAY;
  let coneStatus: GammaConeStatus = "unavailable";

  if (spot !== null && ivDecimal !== null) {
    const full = fullSessionConeBands(spot, ivDecimal);
    if (full) {
      fullSession = {
        sigmaPoints: full.sigmaPoints,
        coreRange50: full.coreRange50,
        expectedRange90: full.expectedRange90,
      };
      coneStatus = gammaFresh ? "available" : "partial";
    }

    const rodBands: RestOfDayConeBands = computeRestOfDayConeBands({
      spot,
      ivDecimal,
      now: input.now,
    });
    restOfDay = {
      status: rodBands.status,
      remainingSessionFraction: rodBands.remainingSessionFraction,
      sigmaPoints: rodBands.sigmaPoints,
      coreRange50: rodBands.coreRange50,
      expectedRange90: rodBands.expectedRange90,
    };
  }

  const dailyVolPct =
    ivDecimal !== null ? ivDecimal / Math.sqrt(ANNUAL_TRADING_DAYS) : 0;

  const wallTouchResult =
    gammaFresh &&
    spot !== null &&
    dailyVolPct > 0 &&
    snapshot.sessionDate === targetSession
      ? estimateWallTouchProbabilities({
          spot,
          callWallStrike: callWall,
          callWallAvailable: snapshot.boundedCallWall.status === "available",
          putWallStrike: putWall,
          putWallAvailable: snapshot.boundedPutWall.status === "available",
          sessionDate: snapshot.sessionDate,
          symbol: input.symbol,
          now: input.now,
          dailyVolPct,
        })
      : null;

  const wallTouch: GammaConeWallTouch = {
    callWallPercent:
      wallTouchResult?.callWallTouch.status === "available"
        ? wallTouchResult.callWallTouch.percent
        : null,
    putWallPercent:
      wallTouchResult?.putWallTouch.status === "available"
        ? wallTouchResult.putWallTouch.percent
        : null,
  };

  return {
    status: coneStatus,
    symbol: input.symbol,
    spot,
    volatility: {
      ivPct: volMispricing.ivPct,
      hv20Pct: volMispricing.hv20Pct,
      vrpVolPts,
      vrpRegime,
    },
    fullSession,
    restOfDay,
    structure: {
      callWall,
      gammaFlip: flipStrike,
      spot,
      putWall,
      gammaRegime,
      dealerFlowRegime: dealerFlowRegimeLabel(gammaRegime),
    },
    wallTouch,
    interpretation: {
      regime: regimeInterp.regime,
      rangeReliability: rangeReliabilityLabel({
        vrpRegime,
        gammaFresh,
        ivAvailable: ivDecimal !== null,
      }),
      warnings,
    },
    provenance: {
      ivSource:
        ivDecimal !== null ? "bounded_representative_iv" : "unavailable",
      ivSessionDate: ivField?.sessionDate ?? null,
      ivAsOf: ivField?.asOf ?? null,
      ivDataLabel: ivField
        ? formatOptionsIvCloseLabel(ivField.sessionDate, input.view.isFixture)
        : null,
      optionsSessionDate: snapshot.sessionDate,
      isFixture: input.view.isFixture,
      fullSessionMode: "annual_iv_over_sqrt_252",
      restOfDayMode: "sqrt_remaining_session_fraction",
    },
  };
}
