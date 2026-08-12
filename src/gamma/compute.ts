import {
  EstimatedGammaStructure,
  ESTIMATED_GAMMA_SCHEMA_VERSION,
  type EstimatedGammaStructure as EstimatedGammaStructureDto,
  type ExpiryGexBreakdown,
  type WallLevel,
} from "@/contracts";
import {
  aggregateByExpiry,
  aggregateByStrike,
  deriveCallWall,
  deriveGammaRegime,
  derivePutWall,
  deriveZeroDte,
  deriveGammaFlipSpotShock,
} from "./aggregate";
import { scoreChain } from "./gex";
import { suspectExcludedOnSide } from "./marketdata-app/quality";
import { gexMethodology } from "./methodology";
import type { OptionsChainSnapshot } from "./types";
import type { SkippedContract } from "./gex";

function skippedCountByExpiry(
  skipped: readonly SkippedContract[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const s of skipped) {
    const exp = s.contract.expiry;
    map.set(exp, (map.get(exp) ?? 0) + 1);
  }
  return map;
}

function suspectCountByExpiry(
  skipped: readonly SkippedContract[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const s of skipped) {
    if (s.reason !== "suspect_vendor_greeks") continue;
    const exp = s.contract.expiry;
    map.set(exp, (map.get(exp) ?? 0) + 1);
  }
  return map;
}

function markExpiryIncompleteWhenSuspect(
  byExpiry: readonly ExpiryGexBreakdown[],
  suspectByExpiry: ReadonlyMap<string, number>,
): ExpiryGexBreakdown[] {
  return byExpiry.map((row) => {
    if ((suspectByExpiry.get(row.expiry) ?? 0) === 0) {
      return row;
    }
    if (row.status === "unavailable") {
      return row;
    }
    return { ...row, status: "incomplete" as const };
  });
}

function degradeWallWhenSuspect(
  wall: WallLevel,
  suspectOnSide: boolean,
): WallLevel {
  if (!suspectOnSide || wall.status === "unavailable") {
    return wall;
  }
  return {
    ...wall,
    status: "incomplete",
    reason:
      wall.reason ??
      "Suspect vendor Greeks excluded from this side — wall may be incomplete",
  };
}

/**
 * Pure: EstimatedGammaStructure from a provider-neutral chain snapshot.
 * No network, no IO, no Macro/Catalyst coupling.
 */
export function computeEstimatedGammaStructure(
  chain: OptionsChainSnapshot,
): EstimatedGammaStructureDto {
  const methodology = gexMethodology();
  const { used, skipped, skipReasons } = scoreChain(chain);
  const byStrike = aggregateByStrike(used);
  const skippedByExpiry = skippedCountByExpiry(skipped);
  const suspectByExpiry = suspectCountByExpiry(skipped);
  let byExpiry = aggregateByExpiry(used, skippedByExpiry);
  byExpiry = markExpiryIncompleteWhenSuspect(byExpiry, suspectByExpiry);

  let callWall = deriveCallWall(byStrike);
  let putWall = derivePutWall(byStrike);
  const suspectCount = chain.dataQuality?.suspectVendorGreeksCount ?? 0;
  if (suspectCount > 0) {
    callWall = degradeWallWhenSuspect(
      callWall,
      suspectExcludedOnSide(chain.dataQuality, "call"),
    );
    putWall = degradeWallWhenSuspect(
      putWall,
      suspectExcludedOnSide(chain.dataQuality, "put"),
    );
  }

  const limitations: string[] = [...methodology.assumptions];

  if (chain.spot === null) {
    limitations.push("Spot unavailable — all contracts skipped.");
  }
  if (chain.contracts.length === 0) {
    limitations.push("Empty options chain.");
  }
  if (skipped.length > 0) {
    limitations.push(
      `${skipped.length} contract(s) excluded (see coverage.skipReasons).`,
    );
  }
  if (suspectCount > 0) {
    limitations.push(
      `${suspectCount} contract(s) with positive OI excluded as suspect_vendor_greeks (vendor gamma=0 with collapsed delta/IV). Original vendor Greeks preserved in chain.dataQuality audit.`,
    );
  }
  if (callWall.status === "unavailable") {
    limitations.push(`Call wall unavailable: ${callWall.reason ?? "unknown"}`);
  }
  if (putWall.status === "unavailable") {
    limitations.push(`Put wall unavailable: ${putWall.reason ?? "unknown"}`);
  }
  if (callWall.status === "incomplete") {
    limitations.push(
      `Call wall incomplete: ${callWall.reason ?? "suspect vendor Greek exclusions"}`,
    );
  }
  if (putWall.status === "incomplete") {
    limitations.push(
      `Put wall incomplete: ${putWall.reason ?? "suspect vendor Greek exclusions"}`,
    );
  }

  let status: EstimatedGammaStructureDto["status"];
  let totalGex: number | null;

  if (used.length === 0) {
    status = "unavailable";
    totalGex = null;
  } else {
    totalGex = used.reduce((acc, r) => acc + r.gex, 0);
    const wallGap =
      callWall.status === "unavailable" || putWall.status === "unavailable";
    if (suspectCount > 0) {
      status = "incomplete";
    } else if (skipped.length > 0 || wallGap) {
      status = "partial";
    } else {
      status = "available";
    }
  }

  const dq = chain.dataQuality;

  const result: EstimatedGammaStructureDto = {
    kind: "EstimatedGammaStructure",
    schemaVersion: ESTIMATED_GAMMA_SCHEMA_VERSION,
    underlying: chain.underlying,
    asOf: chain.asOf,
    sessionDate: chain.sessionDate,
    spot: chain.spot,
    dataDelay: chain.dataDelay,
    source: {
      provider: chain.source.provider,
      name: chain.source.name,
      fetchedAt: chain.source.fetchedAt,
    },
    methodology,
    status,
    limitations,
    totalGex,
    gammaRegime: deriveGammaRegime(totalGex, byStrike),
    callWall,
    putWall,
    gammaFlip: deriveGammaFlipSpotShock(chain, used),
    byStrike,
    byExpiry,
    zeroDte: deriveZeroDte(chain.sessionDate, byExpiry, byStrike),
    coverage: {
      contractsIn: chain.contracts.length,
      contractsUsed: used.length,
      contractsSkipped: skipped.length,
      skipReasons: { ...skipReasons },
      ...(dq
        ? {
            nonNullGammaCount: dq.nonNullGammaCount,
            usableGammaCount: dq.usableGammaCount,
            nonNullGammaCoveragePct: dq.nonNullGammaCoveragePct,
            usableGammaCoveragePct: dq.usableGammaCoveragePct,
            suspectVendorGreeksCount: dq.suspectVendorGreeksCount,
          }
        : {}),
    },
    synthetic: chain.synthetic,
  };

  return EstimatedGammaStructure.parse(result);
}
