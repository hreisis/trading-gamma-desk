import { resolveLastCompletedMarketSessionDate } from "@/ai-study/session";
import type { BreadthInternalsSnapshot } from "@/contracts/breadth-internals";
import { BreadthInternalsSnapshot as BreadthInternalsSnapshotSchema } from "@/contracts/breadth-internals";
import type { EtfUniverseArtifact } from "@/contracts/etf-universe-artifact";
import {
  loadAlpacaDailyBarPanel,
  type AlpacaPanelLoadResult,
} from "./bars/alpaca-panel";
import { computeSpyBreadthInternals } from "./compute/breadth";
import {
  loadSpyUniverse,
  type LoadSpyUniverseResult,
} from "./universe/load-spy-universe";
import { BreadthStoreError, publishBreadthSnapshot, type BreadthSnapshotStore } from "./store";

export type ProduceDailySpyBreadthStatus =
  | "published"
  | "skipped"
  | "failed";

export interface ProduceDailySpyBreadthPublished {
  readonly status: "published";
  readonly marketSessionDate: string;
  readonly snapshotIdentity: string;
  readonly publishedAt: string;
}

export interface ProduceDailySpyBreadthSkipped {
  readonly status: "skipped";
  readonly reason: string;
  readonly marketSessionDate: string;
  readonly detail: string | null;
}

export interface ProduceDailySpyBreadthFailed {
  readonly status: "failed";
  readonly reason: string;
  readonly marketSessionDate: string | null;
  readonly detail: string | null;
}

export type ProduceDailySpyBreadthResult =
  | ProduceDailySpyBreadthPublished
  | ProduceDailySpyBreadthSkipped
  | ProduceDailySpyBreadthFailed;

export interface ProduceDailySpyBreadthDeps {
  readonly store: BreadthSnapshotStore;
  readonly now?: () => Date;
  readonly loadUniverse?: (
    options: Parameters<typeof loadSpyUniverse>[0],
  ) => Promise<LoadSpyUniverseResult>;
  readonly loadBarPanel?: (
    input: Parameters<typeof loadAlpacaDailyBarPanel>[0],
  ) => Promise<AlpacaPanelLoadResult>;
  readonly dataRoot?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly fetchImpl?: typeof fetch;
  readonly bootstrapBars?: boolean;
  readonly allowUniversePersistedFallback?: boolean;
}

function upstreamBarsUnavailable(panel: AlpacaPanelLoadResult): boolean {
  return (
    panel.provenance.requestedSymbols > 0 &&
    panel.provenance.returnedSymbols === 0
  );
}

/**
 * Daily SPY breadth producer: official universe → Alpaca bars → compute → validate → publish.
 * Does not run on page requests; intended for cron / manual orchestration only.
 */
export async function produceDailySpyBreadth(
  deps: ProduceDailySpyBreadthDeps,
): Promise<ProduceDailySpyBreadthResult> {
  const now = deps.now?.() ?? new Date();
  const targetMarketSessionDate = resolveLastCompletedMarketSessionDate(now);
  const generatedAt = now.toISOString();
  const dataRoot = deps.dataRoot ?? "data";
  const env = deps.env ?? process.env;
  const loadUniverse = deps.loadUniverse ?? loadSpyUniverse;
  const loadBarPanel = deps.loadBarPanel ?? loadAlpacaDailyBarPanel;

  const universeResult = await loadUniverse({
    fetchedAt: generatedAt,
    targetMarketSessionDate,
    dataRoot,
    fetchImpl: deps.fetchImpl,
    allowPersistedFallback: deps.allowUniversePersistedFallback ?? false,
  });

  if (!universeResult.artifact) {
    return {
      status: "failed",
      reason: "upstream_universe_unavailable",
      marketSessionDate: targetMarketSessionDate,
      detail: universeResult.error ?? "SPY universe unavailable",
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
  });

  if (upstreamBarsUnavailable(panel)) {
    return {
      status: "failed",
      reason: "upstream_bars_unavailable",
      marketSessionDate: targetMarketSessionDate,
      detail: "Alpaca daily bar panel returned zero symbols",
    };
  }

  const snapshot = computeSpyBreadthInternals({
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
