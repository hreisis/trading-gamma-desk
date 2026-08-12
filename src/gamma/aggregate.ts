import type {
  ExpiryGexBreakdown,
  GammaFlipLevel,
  GammaRegime,
  StrikeGexLevel,
  WallLevel,
  ZeroDteGexBreakdown,
} from "@/contracts";
import { NEAR_ZERO_GROSS_SHARE } from "./methodology";
import { grossGex, modeledGexAtSpot, buildSpotShockGrid } from "./gex";
import { GEX_RISK_FREE_RATE } from "./methodology";
import { normalizeShareOfGrossGex } from "./share";
import type {
  ContractGexContribution,
  OptionsChainSnapshot,
} from "./types";

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

/**
 * Call wall: maximize callGex among strikes with callGex > 0.
 * Tie-break: lowest strike (deterministic).
 * All-zero / no positive call GEX → unavailable (never fabricate).
 */
export function deriveCallWall(byStrike: readonly StrikeGexLevel[]): WallLevel {
  let best: StrikeGexLevel | null = null;
  for (const row of byStrike) {
    if (!(row.callGex > 0)) continue;
    if (
      !best ||
      row.callGex > best.callGex ||
      (row.callGex === best.callGex && row.strike < best.strike)
    ) {
      best = row;
    }
  }
  if (!best) {
    return {
      status: "unavailable",
      reason: "No positive call GEX at any strike",
    };
  }
  return { status: "available", strike: best.strike, gex: best.callGex };
}

/**
 * Put wall: minimize putGex among strikes with putGex < 0.
 * Tie-break: highest strike (deterministic).
 * All-zero / no negative put GEX → unavailable (never fabricate).
 */
export function derivePutWall(byStrike: readonly StrikeGexLevel[]): WallLevel {
  let best: StrikeGexLevel | null = null;
  for (const row of byStrike) {
    if (!(row.putGex < 0)) continue;
    if (
      !best ||
      row.putGex < best.putGex ||
      (row.putGex === best.putGex && row.strike > best.strike)
    ) {
      best = row;
    }
  }
  if (!best) {
    return {
      status: "unavailable",
      reason: "No negative put GEX at any strike",
    };
  }
  return { status: "available", strike: best.strike, gex: best.putGex };
}

export function deriveGammaRegime(
  totalGex: number | null,
  byStrike: readonly StrikeGexLevel[],
): GammaRegime {
  if (totalGex === null || !Number.isFinite(totalGex)) return "unavailable";
  const gross = grossGex(byStrike);
  if (gross === 0) return "near_zero";
  if (Math.abs(totalGex) / gross <= NEAR_ZERO_GROSS_SHARE) return "near_zero";
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
      shareOfGrossGex: null,
      contractsUsed: 0,
      reason: "No contracts with expiry equal to sessionDate",
    };
  }
  if (
    slice.status === "unavailable" ||
    slice.callGex === null ||
    slice.putGex === null ||
    slice.netGex === null
  ) {
    return {
      status: "unavailable",
      sessionDate,
      expiry: sessionDate,
      callGex: null,
      putGex: null,
      netGex: null,
      shareOfGrossGex: null,
      contractsUsed: slice.contractsUsed,
      reason: "0DTE expiry present but no usable GEX contributions",
    };
  }

  const grossTotal = grossGex(byStrike);
  const grossZeroDte = Math.abs(slice.callGex) + Math.abs(slice.putGex);
  const shareRaw = grossTotal > 0 ? grossZeroDte / grossTotal : null;
  const share = shareRaw === null ? null : normalizeShareOfGrossGex(shareRaw);

  return {
    status: slice.status,
    sessionDate,
    expiry: sessionDate,
    callGex: slice.callGex,
    putGex: slice.putGex,
    netGex: slice.netGex,
    shareOfGrossGex: share,
    contractsUsed: slice.contractsUsed,
  };
}

/** Flip unavailable — explicit reason for audit. */
export function unavailableGammaFlip(reason?: string): GammaFlipLevel {
  return {
    status: "unavailable",
    reason:
      reason ??
      "Gamma Flip unavailable — insufficient spot-shock modeled net GEX inputs",
  };
}

const FLIP_MIN_MODELED_SHARE = 0.5;

function interpolateZeroCrossing(
  spotLow: number,
  gexLow: number,
  spotHigh: number,
  gexHigh: number,
): number | null {
  if (gexLow === 0) return spotLow;
  if (gexHigh === 0) return spotHigh;
  if (gexLow * gexHigh > 0) return null;
  const t = -gexLow / (gexHigh - gexLow);
  if (!Number.isFinite(t)) return null;
  return spotLow + t * (spotHigh - spotLow);
}

/**
 * Spot-shock gamma flip: recompute BS gamma GEX across shocked spots for contracts
 * already used in the bounded aggregate; linearly interpolate the zero crossing.
 */
export function deriveGammaFlipSpotShock(
  chain: OptionsChainSnapshot,
  used: readonly ContractGexContribution[],
): GammaFlipLevel {
  const spot = chain.spot;
  if (spot === null || !Number.isFinite(spot) || spot <= 0) {
    return unavailableGammaFlip("Gamma Flip unavailable — spot missing or invalid");
  }
  if (used.length === 0) {
    return unavailableGammaFlip(
      "Gamma Flip unavailable — no usable contracts in bounded aggregate",
    );
  }

  const ivFallback = extractRepresentativeIvFromChain(chain).value;
  let modeledAtSpot = 0;
  for (const row of used) {
    if (
      modeledGexAtSpot(
        row.contract,
        spot,
        chain.sessionDate,
        GEX_RISK_FREE_RATE,
        ivFallback,
      ) !== null
    ) {
      modeledAtSpot += 1;
    }
  }
  if (modeledAtSpot / used.length < FLIP_MIN_MODELED_SHARE) {
    return unavailableGammaFlip(
      "Gamma Flip unavailable — fewer than 50% of used contracts have IV for BS gamma recompute",
    );
  }

  const shockSpots = buildSpotShockGrid(spot);
  const totals: number[] = [];

  for (const shockedSpot of shockSpots) {
    let total = 0;
    for (const row of used) {
      const gex = modeledGexAtSpot(
        row.contract,
        shockedSpot,
        chain.sessionDate,
        GEX_RISK_FREE_RATE,
        ivFallback,
      );
      if (gex !== null) total += gex;
    }
    totals.push(total);
  }

  let bestFlip: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bracketLow: number | null = null;
  let bracketHigh: number | null = null;

  for (let index = 0; index < shockSpots.length - 1; index += 1) {
    const s0 = shockSpots[index]!;
    const s1 = shockSpots[index + 1]!;
    const g0 = totals[index]!;
    const g1 = totals[index + 1]!;
    const cross = interpolateZeroCrossing(s0, g0, s1, g1);
    if (cross === null || !Number.isFinite(cross) || cross <= 0) continue;
    const distance = Math.abs(cross - spot);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestFlip = cross;
      bracketLow = s0;
      bracketHigh = s1;
    }
  }

  if (bestFlip === null) {
    return unavailableGammaFlip(
      "Gamma Flip unavailable — no net GEX sign change in spot-shock grid",
    );
  }

  const rounded =
    bestFlip >= 100
      ? Math.round(bestFlip * 10) / 10
      : Math.round(bestFlip * 100) / 100;

  return {
    status: "available",
    strike: rounded,
    level: rounded,
    method: "spot_shock_bs_gamma",
    lowerStrike: bracketLow ?? undefined,
    upperStrike: bracketHigh ?? undefined,
  };
}

/**
 * Nearest-strike mean of vendor IV at the chain spot — one representative decimal IV.
 */
export function extractRepresentativeIvFromChain(
  chain: OptionsChainSnapshot,
): {
  readonly status: "available" | "unavailable";
  readonly value: number | null;
} {
  const spot = chain.spot;
  if (spot === null || !Number.isFinite(spot) || spot <= 0) {
    return { status: "unavailable", value: null };
  }

  const withIv = chain.contracts.filter(
    (contract) =>
      contract.iv !== null &&
      contract.iv !== undefined &&
      Number.isFinite(contract.iv) &&
      contract.iv > 0,
  );
  if (withIv.length === 0) {
    return { status: "unavailable", value: null };
  }

  let nearestStrike = withIv[0]!.strike;
  let nearestDistance = Math.abs(withIv[0]!.strike - spot);
  for (const contract of withIv) {
    const distance = Math.abs(contract.strike - spot);
    if (
      distance < nearestDistance ||
      (distance === nearestDistance && contract.strike < nearestStrike)
    ) {
      nearestStrike = contract.strike;
      nearestDistance = distance;
    }
  }

  const ivs = withIv
    .filter((contract) => contract.strike === nearestStrike)
    .map((contract) => contract.iv!)
    .filter((iv) => iv > 0);
  if (ivs.length === 0) {
    return { status: "unavailable", value: null };
  }

  const value = ivs.reduce((sum, iv) => sum + iv, 0) / ivs.length;
  return { status: "available", value };
}
