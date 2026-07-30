import type {
  ExpiryGexBreakdown,
  GammaRegime,
  StrikeGexLevel,
  WallLevel,
  ZeroDteGexBreakdown,
} from "@/contracts";
import { NEAR_ZERO_ABS_SHARE } from "./methodology";
import type { ContractGexContribution } from "./types";

export function aggregateByStrike(
  used: readonly ContractGexContribution[],
): StrikeGexLevel[] {
  const byStrike = new Map<
    number,
    {
      callGex: number;
      putGex: number;
      callOpenInterest: number;
      putOpenInterest: number;
      callContractsUsed: number;
      putContractsUsed: number;
    }
  >();

  for (const row of used) {
    const cur = byStrike.get(row.contract.strike) ?? {
      callGex: 0,
      putGex: 0,
      callOpenInterest: 0,
      putOpenInterest: 0,
      callContractsUsed: 0,
      putContractsUsed: 0,
    };
    if (row.contract.right === "call") {
      cur.callGex += row.gex;
      cur.callOpenInterest += row.contract.openInterest ?? 0;
      cur.callContractsUsed += 1;
    } else {
      cur.putGex += row.gex;
      cur.putOpenInterest += row.contract.openInterest ?? 0;
      cur.putContractsUsed += 1;
    }
    byStrike.set(row.contract.strike, cur);
  }

  return [...byStrike.entries()]
    .map(([strike, v]) => ({
      strike,
      callGex: v.callGex,
      putGex: v.putGex,
      netGex: v.callGex + v.putGex,
      callOpenInterest: v.callOpenInterest,
      putOpenInterest: v.putOpenInterest,
      callContractsUsed: v.callContractsUsed,
      putContractsUsed: v.putContractsUsed,
    }))
    .sort((a, b) => a.strike - b.strike);
}

export function aggregateByExpiry(
  used: readonly ContractGexContribution[],
  skippedByExpiry: ReadonlyMap<string, number>,
): ExpiryGexBreakdown[] {
  const byExpiry = new Map<
    string,
    { callGex: number; putGex: number; contractsUsed: number }
  >();

  for (const row of used) {
    const exp = row.contract.expiry;
    const cur = byExpiry.get(exp) ?? {
      callGex: 0,
      putGex: 0,
      contractsUsed: 0,
    };
    if (row.contract.right === "call") cur.callGex += row.gex;
    else cur.putGex += row.gex;
    cur.contractsUsed += 1;
    byExpiry.set(exp, cur);
  }

  const expiries = new Set([
    ...byExpiry.keys(),
    ...skippedByExpiry.keys(),
  ]);

  return [...expiries]
    .sort()
    .map((expiry) => {
      const v = byExpiry.get(expiry);
      const skipped = skippedByExpiry.get(expiry) ?? 0;
      if (!v || v.contractsUsed === 0) {
        return {
          expiry,
          status: "unavailable" as const,
          callGex: null,
          putGex: null,
          netGex: null,
          contractsUsed: 0,
          contractsSkipped: skipped,
        };
      }
      return {
        expiry,
        status: skipped > 0 ? ("partial" as const) : ("available" as const),
        callGex: v.callGex,
        putGex: v.putGex,
        netGex: v.callGex + v.putGex,
        contractsUsed: v.contractsUsed,
        contractsSkipped: skipped,
      };
    });
}

export function deriveCallWall(byStrike: readonly StrikeGexLevel[]): WallLevel {
  let best: StrikeGexLevel | null = null;
  for (const row of byStrike) {
    if (row.callContractsUsed === 0) continue;
    if (!best || row.callGex > best.callGex) best = row;
  }
  if (!best) {
    return { status: "unavailable", reason: "No call GEX contributions" };
  }
  return { status: "available", strike: best.strike, gex: best.callGex };
}

export function derivePutWall(byStrike: readonly StrikeGexLevel[]): WallLevel {
  let best: StrikeGexLevel | null = null;
  for (const row of byStrike) {
    if (row.putContractsUsed === 0) continue;
    // Most negative put GEX (largest magnitude under put-negative convention).
    if (!best || row.putGex < best.putGex) best = row;
  }
  if (!best) {
    return { status: "unavailable", reason: "No put GEX contributions" };
  }
  return { status: "available", strike: best.strike, gex: best.putGex };
}

export function deriveGammaRegime(
  totalGex: number | null,
  byStrike: readonly StrikeGexLevel[],
): GammaRegime {
  if (totalGex === null || !Number.isFinite(totalGex)) return "unavailable";
  const sumAbs = byStrike.reduce((acc, r) => acc + Math.abs(r.netGex), 0);
  if (sumAbs === 0) return "near_zero";
  if (Math.abs(totalGex) / sumAbs <= NEAR_ZERO_ABS_SHARE) return "near_zero";
  return totalGex > 0 ? "positive" : "negative";
}

export function deriveZeroDte(
  sessionDate: string,
  byExpiry: readonly ExpiryGexBreakdown[],
  byStrike: readonly StrikeGexLevel[],
): ZeroDteGexBreakdown {
  const slice = byExpiry.find((e) => e.expiry === sessionDate);
  if (!slice) {
    return {
      status: "unavailable",
      sessionDate,
      callGex: null,
      putGex: null,
      netGex: null,
      shareOfAbsStrikeGex: null,
      contractsUsed: 0,
      reason: "No contracts with expiry equal to sessionDate",
    };
  }
  if (slice.status === "unavailable" || slice.netGex === null) {
    return {
      status: "unavailable",
      sessionDate,
      expiry: sessionDate,
      callGex: null,
      putGex: null,
      netGex: null,
      shareOfAbsStrikeGex: null,
      contractsUsed: slice.contractsUsed,
      reason: "0DTE expiry present but no usable GEX contributions",
    };
  }

  const sumAbs = byStrike.reduce((acc, r) => acc + Math.abs(r.netGex), 0);
  const share =
    sumAbs > 0 ? Math.min(1, Math.abs(slice.netGex) / sumAbs) : null;

  return {
    status: slice.status,
    sessionDate,
    expiry: sessionDate,
    callGex: slice.callGex,
    putGex: slice.putGex,
    netGex: slice.netGex,
    shareOfAbsStrikeGex: share,
    contractsUsed: slice.contractsUsed,
  };
}

/** Reserved: Flip requires gamma recompute from spot/IV/rates/TTE — not strike interpolation. */
export function unavailableGammaFlip() {
  return {
    status: "unavailable" as const,
    reason:
      "Gamma Flip is not estimated in M4-1; requires recomputing gamma from spot, IV, rates, and time-to-expiry rather than interpolating strike GEX",
  };
}
