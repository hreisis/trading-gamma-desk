import {
  GEX_PCT_MOVE,
  FLIP_SHOCK_GRID_MAX_PCT,
  FLIP_SHOCK_GRID_MIN_PCT,
  FLIP_SHOCK_GRID_STEP_PCT,
} from "./methodology";
import { excludedSymbolsFromQuality } from "./marketdata-app/quality";
import type {
  ContractGexContribution,
  ContractSkipReason,
  OptionsContract,
  OptionsChainSnapshot,
} from "./types";
import type { StrikeGexLevel } from "@/contracts";

export interface ScoredContract {
  readonly ok: true;
  readonly contribution: ContractGexContribution;
}

export interface SkippedContract {
  readonly ok: false;
  readonly contract: OptionsContract;
  readonly reason: ContractSkipReason;
}

export type ContractScore = ScoredContract | SkippedContract;

/** Pure: classify whether a contract can enter the GEX sum. */
export function scoreContract(
  contract: OptionsContract,
  options: {
    readonly underlying: string;
    readonly sessionDate: string;
    readonly spot: number | null;
    readonly excludedSymbols?: ReadonlySet<string>;
  },
): ContractScore {
  if (options.excludedSymbols?.has(contract.symbol)) {
    return { ok: false, contract, reason: "suspect_vendor_greeks" };
  }
  if (contract.underlying !== options.underlying) {
    return { ok: false, contract, reason: "underlying_mismatch" };
  }
  if (options.spot === null || !Number.isFinite(options.spot) || options.spot <= 0) {
    return { ok: false, contract, reason: "missing_spot" };
  }
  if (!Number.isFinite(contract.strike) || contract.strike <= 0) {
    return { ok: false, contract, reason: "invalid_strike" };
  }
  if (!Number.isFinite(contract.multiplier) || contract.multiplier <= 0) {
    return { ok: false, contract, reason: "invalid_multiplier" };
  }
  if (contract.expiry < options.sessionDate) {
    return { ok: false, contract, reason: "expired" };
  }
  if (contract.openInterest === null) {
    return { ok: false, contract, reason: "missing_oi" };
  }
  if (!Number.isFinite(contract.openInterest)) {
    return { ok: false, contract, reason: "non_finite_oi" };
  }
  if (contract.openInterest < 0) {
    return { ok: false, contract, reason: "negative_oi" };
  }
  if (contract.gamma === null) {
    return { ok: false, contract, reason: "missing_gamma" };
  }
  if (!Number.isFinite(contract.gamma)) {
    return { ok: false, contract, reason: "non_finite_gamma" };
  }
  if (contract.gamma < 0) {
    return { ok: false, contract, reason: "negative_gamma" };
  }

  const unsignedUnitGex =
    contract.gamma *
    contract.openInterest *
    contract.multiplier *
    options.spot *
    options.spot *
    GEX_PCT_MOVE;

  if (!Number.isFinite(unsignedUnitGex)) {
    return { ok: false, contract, reason: "non_finite_gamma" };
  }

  const signed =
    contract.right === "put" ? -unsignedUnitGex : unsignedUnitGex;
  // Normalize -0 from put×zero so downstream equality checks stay clean.
  const gex = signed === 0 ? 0 : signed;

  return {
    ok: true,
    contribution: {
      contract,
      gex,
      unsignedUnitGex,
    },
  };
}

export function scoreChain(
  chain: OptionsChainSnapshot,
): {
  readonly used: readonly ContractGexContribution[];
  readonly skipped: readonly SkippedContract[];
  readonly skipReasons: Readonly<Record<string, number>>;
} {
  const used: ContractGexContribution[] = [];
  const skipped: SkippedContract[] = [];
  const skipReasons: Record<string, number> = {};

  const excludedSymbols = excludedSymbolsFromQuality(chain.dataQuality);

  for (const contract of chain.contracts) {
    const scored = scoreContract(contract, {
      underlying: chain.underlying,
      sessionDate: chain.sessionDate,
      spot: chain.spot,
      excludedSymbols,
    });
    if (scored.ok) {
      used.push(scored.contribution);
    } else {
      skipped.push(scored);
      skipReasons[scored.reason] = (skipReasons[scored.reason] ?? 0) + 1;
    }
  }

  return { used, skipped, skipReasons };
}

/** Gross GEX mass: Σ(|callGex| + |putGex|) over strikes. */
export function grossGex(byStrike: readonly StrikeGexLevel[]): number {
  return byStrike.reduce(
    (acc, r) => acc + Math.abs(r.callGex) + Math.abs(r.putGex),
    0,
  );
}

/** Pure: unsigned unit GEX for known-good numeric inputs (test helper). */
export function unsignedUnitGex(input: {
  readonly gamma: number;
  readonly openInterest: number;
  readonly multiplier: number;
  readonly spot: number;
}): number {
  return (
    input.gamma *
    input.openInterest *
    input.multiplier *
    input.spot *
    input.spot *
    GEX_PCT_MOVE
  );
}

const SQRT_TWO_PI = Math.sqrt(2 * Math.PI);

function normalPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / SQRT_TWO_PI;
}

/** Calendar year fraction between session and expiry (minimum one day). */
export function calendarYearFraction(
  sessionDate: string,
  expiry: string,
): number | null {
  const start = Date.parse(`${sessionDate}T12:00:00Z`);
  const end = Date.parse(`${expiry}T12:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const days = (end - start) / 86400000;
  if (!Number.isFinite(days) || days < 0) return null;
  return Math.max(days / 365, 1 / 365);
}

/** Black–Scholes gamma (∂Δ/∂S) per option unit at a shocked spot. */
export function blackScholesGammaPerUnit(
  spot: number,
  strike: number,
  yearFraction: number,
  riskFreeRate: number,
  iv: number,
): number | null {
  if (!Number.isFinite(spot) || spot <= 0) return null;
  if (!Number.isFinite(strike) || strike <= 0) return null;
  if (!Number.isFinite(iv) || iv <= 0) return null;
  if (!Number.isFinite(yearFraction) || yearFraction <= 0) return null;

  const sigma = iv;
  const sqrtT = Math.sqrt(yearFraction);
  const d1 =
    (Math.log(spot / strike) +
      (riskFreeRate + 0.5 * sigma * sigma) * yearFraction) /
    (sigma * sqrtT);
  const pdf = normalPdf(d1);
  const gamma = pdf / (spot * sigma * sqrtT);
  return Number.isFinite(gamma) && gamma >= 0 ? gamma : null;
}

export function buildSpotShockGrid(spot: number): number[] {
  const shocks: number[] = [];
  for (
    let pct = FLIP_SHOCK_GRID_MIN_PCT;
    pct <= FLIP_SHOCK_GRID_MAX_PCT + 1e-9;
    pct += FLIP_SHOCK_GRID_STEP_PCT
  ) {
    shocks.push(spot * pct);
  }
  return shocks;
}

/** Modeled signed GEX for one contract at a shocked spot using BS gamma. */
export function modeledGexAtSpot(
  contract: OptionsContract,
  shockedSpot: number,
  sessionDate: string,
  riskFreeRate: number,
  ivFallback: number | null,
): number | null {
  const iv =
    contract.iv !== null &&
    contract.iv !== undefined &&
    Number.isFinite(contract.iv) &&
    contract.iv > 0
      ? contract.iv
      : ivFallback;
  if (iv === null || iv <= 0) return null;

  const yearFraction = calendarYearFraction(sessionDate, contract.expiry);
  if (yearFraction === null) return null;

  const gamma = blackScholesGammaPerUnit(
    shockedSpot,
    contract.strike,
    yearFraction,
    riskFreeRate,
    iv,
  );
  if (gamma === null) return null;

  const oi = contract.openInterest;
  if (oi === null || !Number.isFinite(oi) || oi < 0) return null;
  const mult = contract.multiplier;
  if (!Number.isFinite(mult) || mult <= 0) return null;

  const unsigned =
    gamma * oi * mult * shockedSpot * shockedSpot * GEX_PCT_MOVE;
  if (!Number.isFinite(unsigned)) return null;
  const signed = contract.right === "put" ? -unsigned : unsigned;
  return signed === 0 ? 0 : signed;
}
