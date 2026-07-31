import type { OptionRight } from "../types";
import type {
  ChainDataQuality,
  ContractQualityAudit,
  VendorGreekIssueCode,
} from "../types";
import type { OptionsContract } from "../types";

export const SUSPECT_VENDOR_GREEKS = "suspect_vendor_greeks" as const;
export const QUOTE_BELOW_INTRINSIC = "quote_below_intrinsic" as const;

export const SUSPECT_DELTA_ABS_MIN = 0.999;
export const SUSPECT_IV_MAX = 0.001;

export function callIntrinsic(spot: number, strike: number): number {
  return Math.max(spot - strike, 0);
}

export function putIntrinsic(spot: number, strike: number): number {
  return Math.max(strike - spot, 0);
}

export function contractIntrinsicValue(
  right: OptionRight,
  spot: number,
  strike: number,
): number {
  return right === "call" ? callIntrinsic(spot, strike) : putIntrinsic(spot, strike);
}

export function isSuspectVendorGreeks(input: {
  readonly openInterest: number | null;
  readonly gamma: number | null;
  readonly delta: number | null;
  readonly iv: number | null;
}): boolean {
  if (input.openInterest === null || input.openInterest <= 0) {
    return false;
  }
  if (input.gamma !== 0) {
    return false;
  }
  if (input.delta === null || !Number.isFinite(input.delta)) {
    return false;
  }
  if (Math.abs(input.delta) < SUSPECT_DELTA_ABS_MIN) {
    return false;
  }
  if (input.iv === null || !Number.isFinite(input.iv)) {
    return false;
  }
  return input.iv <= SUSPECT_IV_MAX;
}

export function hasQuoteBelowIntrinsic(
  ask: number | null,
  intrinsicValue: number,
): boolean {
  if (ask === null || !Number.isFinite(ask)) {
    return false;
  }
  return ask < intrinsicValue;
}

export interface AssessContractQualityInput {
  readonly contract: OptionsContract;
  readonly spot: number;
  readonly delta: number | null;
  readonly ask: number | null;
}

export function assessContractQuality(
  input: AssessContractQualityInput,
): ContractQualityAudit {
  const intrinsicValue = contractIntrinsicValue(
    input.contract.right,
    input.spot,
    input.contract.strike,
  );
  const issueCodes: VendorGreekIssueCode[] = [];

  const suspect = isSuspectVendorGreeks({
    openInterest: input.contract.openInterest,
    gamma: input.contract.gamma,
    delta: input.delta,
    iv: input.contract.iv ?? null,
  });
  if (suspect) {
    issueCodes.push(SUSPECT_VENDOR_GREEKS);
  }
  if (hasQuoteBelowIntrinsic(input.ask, intrinsicValue)) {
    issueCodes.push(QUOTE_BELOW_INTRINSIC);
  }

  return {
    symbol: input.contract.symbol,
    right: input.contract.right,
    delta: input.delta,
    ask: input.ask,
    intrinsicValue,
    issueCodes,
    excludedFromGex: suspect,
  };
}

function pct(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    return 0;
  }
  return Math.round((numerator / denominator) * 10000) / 100;
}

export function buildChainDataQuality(
  contracts: readonly OptionsContract[],
  audits: readonly ContractQualityAudit[],
): ChainDataQuality {
  const contractsIn = contracts.length;
  const nonNullGammaCount = contracts.filter((c) => c.gamma !== null).length;
  const suspectVendorGreeksCount = audits.filter((a) =>
    a.issueCodes.includes(SUSPECT_VENDOR_GREEKS),
  ).length;
  const usableGammaCount = contractsIn - suspectVendorGreeksCount;

  return {
    nonNullGammaCount,
    usableGammaCount,
    nonNullGammaCoveragePct: pct(nonNullGammaCount, contractsIn),
    usableGammaCoveragePct: pct(usableGammaCount, contractsIn),
    suspectVendorGreeksCount,
    contractAudits: audits,
  };
}

export function excludedSymbolsFromQuality(
  quality: ChainDataQuality | undefined,
): ReadonlySet<string> {
  if (!quality) {
    return new Set();
  }
  return new Set(
    quality.contractAudits
      .filter((a) => a.excludedFromGex)
      .map((a) => a.symbol),
  );
}

export function suspectExcludedOnSide(
  quality: ChainDataQuality | undefined,
  side: OptionRight,
): boolean {
  if (!quality) {
    return false;
  }
  return quality.contractAudits.some(
    (a) => a.excludedFromGex && a.right === side,
  );
}
