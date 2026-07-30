import {
  EstimatedGammaStructure,
  type EstimatedGammaStructure as EstimatedGammaStructureDto,
} from "@/contracts";
import {
  aggregateByExpiry,
  aggregateByStrike,
  deriveCallWall,
  deriveGammaRegime,
  derivePutWall,
  deriveZeroDte,
  unavailableGammaFlip,
} from "./aggregate";
import { scoreChain } from "./gex";
import { gexMethodology } from "./methodology";
import type { OptionsChainSnapshot } from "./types";

function skippedCountByExpiry(
  skipped: ReturnType<typeof scoreChain>["skipped"],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const s of skipped) {
    const exp = s.contract.expiry;
    map.set(exp, (map.get(exp) ?? 0) + 1);
  }
  return map;
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
  const byExpiry = aggregateByExpiry(used, skippedByExpiry);

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

  let status: EstimatedGammaStructureDto["status"];
  let totalGex: number | null;

  if (used.length === 0) {
    status = "unavailable";
    totalGex = null;
  } else if (skipped.length > 0) {
    status = "partial";
    totalGex = used.reduce((acc, r) => acc + r.gex, 0);
  } else {
    status = "available";
    totalGex = used.reduce((acc, r) => acc + r.gex, 0);
  }

  const result: EstimatedGammaStructureDto = {
    kind: "EstimatedGammaStructure",
    schemaVersion: "0.1.0",
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
    callWall: deriveCallWall(byStrike),
    putWall: derivePutWall(byStrike),
    gammaFlip: unavailableGammaFlip(),
    byStrike,
    byExpiry,
    zeroDte: deriveZeroDte(chain.sessionDate, byExpiry, byStrike),
    coverage: {
      contractsIn: chain.contracts.length,
      contractsUsed: used.length,
      contractsSkipped: skipped.length,
      skipReasons: { ...skipReasons },
    },
    synthetic: chain.synthetic,
  };

  return EstimatedGammaStructure.parse(result);
}
