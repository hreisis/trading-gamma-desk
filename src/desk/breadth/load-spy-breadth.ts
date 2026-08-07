import type { BreadthInternalsSnapshot } from "@/contracts/breadth-internals";
import { loadAlpacaDailyBarPanel } from "./bars/alpaca-panel";
import { computeSpyBreadthInternals } from "./compute/breadth";
import { loadSpyUniverse } from "./universe/load-spy-universe";

export interface LoadSpyBreadthInternalsOptions {
  readonly targetMarketSessionDate: string;
  readonly generatedAt: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly dataRoot?: string;
  readonly publicDemo?: boolean;
  readonly bootstrapBars?: boolean;
  readonly fetchImpl?: typeof fetch;
}

export async function loadSpyBreadthInternals(
  options: LoadSpyBreadthInternalsOptions,
): Promise<BreadthInternalsSnapshot | null> {
  if (options.publicDemo) {
    return null;
  }

  const universeResult = await loadSpyUniverse({
    fetchedAt: options.generatedAt,
    targetMarketSessionDate: options.targetMarketSessionDate,
    dataRoot: options.dataRoot,
    fetchImpl: options.fetchImpl,
    allowPersistedFallback: true,
  });
  const universe = universeResult.artifact;
  if (!universe) return null;

  const symbols = universe.constituents.map((row) => row.symbol);
  const panel = await loadAlpacaDailyBarPanel({
    symbols,
    env: options.env,
    dataRoot: options.dataRoot,
    bootstrap: options.bootstrapBars ?? false,
    fetchImpl: options.fetchImpl,
  });

  return computeSpyBreadthInternals({
    universe,
    targetMarketSessionDate: options.targetMarketSessionDate,
    asOf: options.generatedAt,
    seriesBySymbol: panel.seriesBySymbol,
    barsProvenance: panel.provenance,
  });
}
