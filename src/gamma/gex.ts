import { GEX_PCT_MOVE } from "./methodology";
import type {
  ContractGexContribution,
  ContractSkipReason,
  OptionsContract,
  OptionsChainSnapshot,
} from "./types";

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
  },
): ContractScore {
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
  if (contract.openInterest <= 0) {
    return { ok: false, contract, reason: "non_positive_oi" };
  }
  if (contract.gamma === null) {
    return { ok: false, contract, reason: "missing_gamma" };
  }
  if (!Number.isFinite(contract.gamma)) {
    return { ok: false, contract, reason: "non_finite_gamma" };
  }
  if (contract.gamma <= 0) {
    return { ok: false, contract, reason: "non_positive_gamma" };
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

  const gex =
    contract.right === "put" ? -unsignedUnitGex : unsignedUnitGex;

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

  for (const contract of chain.contracts) {
    const scored = scoreContract(contract, {
      underlying: chain.underlying,
      sessionDate: chain.sessionDate,
      spot: chain.spot,
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
