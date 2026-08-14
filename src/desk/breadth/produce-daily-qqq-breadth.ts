import { resolveLastCompletedMarketSessionDate } from "@/ai-study/session";
import type { BreadthInternalsSnapshot } from "@/contracts/breadth-internals";
import { BreadthInternalsSnapshot as BreadthInternalsSnapshotSchema } from "@/contracts/breadth-internals";
import type { EtfUniverseArtifact } from "@/contracts/etf-universe-artifact";
import {
  loadAlpacaDailyBarPanel,
  type AlpacaPanelLoadResult,
} from "./bars/alpaca-panel";
import { computeQqqBreadthInternals } from "./compute/breadth";
import {
  loadQqqUniverse,
  type LoadQqqUniverseResult,
} from "./universe/load-qqq-universe";
import { BreadthStoreError, publishBreadthSnapshot, type BreadthSnapshotStore } from "./store";
import type { ProduceDailySpyBreadthResult } from "./produce-daily-spy-breadth";

export interface ProduceDailyQqqBreadthDeps {
  readonly store: BreadthSnapshotStore;
  readonly now?: () => Date;
  readonly loadUniverse?: (
    options: Parameters<typeof loadQqqUniverse>[0],
  ) => Promise<LoadQqqUniverseResult>;
  readonly loadBarPanel?: (
    input: Parameters<typeof loadAlpacaDailyBarPanel>[0],
  ) => Promise<AlpacaPanelLoadResult>;
  readonly dataRoot?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly fetchImpl?: typeof fetch;
  readonly bootstrapBars?: boolean;
  readonly allowUniversePersistedFallback?: boolean;
  readonly persistUniverse?: boolean;
  readonly persistBars?: boolean;
}

function upstreamBarsUnavailable(panel: AlpacaPanelLoadResult): boolean {
  return (
    panel.provenance.requestedSymbols > 0 &&
    panel.provenance.returnedSymbols === 0
  );
}

/**
 * Daily QQQ breadth producer: official Invesco universe → Alpaca bars → compute → publish.
 */
export async function produceDailyQqqBreadth(
  deps: ProduceDailyQqqBreadthDeps,
): Promise<ProduceDailySpyBreadthResult> {
  const now = deps.now?.() ?? new Date();
  const targetMarketSessionDate = resolveLastCompletedMarketSessionDate(now);
  const generatedAt = now.toISOString();
  const dataRoot = deps.dataRoot ?? "data";
  const env = deps.env ?? process.env;
  const loadUniverse = deps.loadUniverse ?? loadQqqUniverse;
  const loadBarPanel = deps.loadBarPanel ?? loadAlpacaDailyBarPanel;

  const universeResult = await loadUniverse({
    fetchedAt: generatedAt,
    targetMarketSessionDate,
    dataRoot,
    fetchImpl: deps.fetchImpl,
    env,
    allowPersistedFallback: deps.allowUniversePersistedFallback ?? false,
    persistToFilesystem: deps.persistUniverse,
  });

  if (!universeResult.artifact) {
    return {
      status: "failed",
      reason: "upstream_universe_unavailable",
      marketSessionDate: targetMarketSessionDate,
      detail: universeResult.error ?? "QQQ universe unavailable",
    };
  }

  const universe: EtfUniverseArtifact = universeResult.artifact;
  const symbols = universe.constituents.map((row) => row.symbol);
  const panel = await loadBarPanel({
    symbols,
    env,
    dataRoot,
    bootstrap: deps.bootstrapBars ?? false,
    fetchImpl: deps.fetchImpl,
    persistToFilesystem: deps.persistBars,
  });

  if (upstreamBarsUnavailable(panel)) {
    return {
      status: "failed",
      reason: "upstream_bars_unavailable",
      marketSessionDate: targetMarketSessionDate,
      detail: "Alpaca daily bar panel returned zero symbols",
    };
  }

  const snapshot = computeQqqBreadthInternals({
    universe,
    targetMarketSessionDate,
    asOf: generatedAt,
    seriesBySymbol: panel.seriesBySymbol,
    barsProvenance: panel.provenance,
  });

  let validated: BreadthInternalsSnapshot;
  try {
    validated = BreadthInternalsSnapshotSchema.parse(snapshot);
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "breadth snapshot schema validation failed";
    return {
      status: "failed",
      reason: "invalid_snapshot",
      marketSessionDate: targetMarketSessionDate,
      detail,
    };
  }

  if (validated.status === "unavailable") {
    return {
      status: "skipped",
      reason: "breadth_unavailable",
      marketSessionDate: targetMarketSessionDate,
      detail: validated.missingReason,
    };
  }

  const publishedAt = new Date().toISOString();

  try {
    const pointer = await publishBreadthSnapshot(deps.store, validated, publishedAt);
    return {
      status: "published",
      marketSessionDate: pointer.marketSessionDate,
      snapshotIdentity: pointer.snapshotIdentity,
      publishedAt: pointer.publishedAt,
    };
  } catch (error) {
    if (error instanceof BreadthStoreError) {
      return {
        status: "failed",
        reason: error.code,
        marketSessionDate: targetMarketSessionDate,
        detail: error.message,
      };
    }
    const detail = error instanceof Error ? error.message : String(error);
    return {
      status: "failed",
      reason: "publish_failed",
      marketSessionDate: targetMarketSessionDate,
      detail,
    };
  }
}
