import type { FetchLike } from "@/ingest/http";
import {
  ALPACA_MARKET_PANEL_SCHEMA_VERSION,
  type AlpacaHealthStatus,
  type AlpacaMarketPanel,
  type AlpacaMarketQuote,
} from "@/contracts/alpaca-market";
import { isPublicDemoMode } from "@/desk/public-demo";
import { AlpacaClientError, createAlpacaClient, mapAlpacaClientErrorToCredentialState } from "./client";
import {
  loadAlpacaClientConfig,
  resolveAlpacaWatchlist,
  type AlpacaClientConfig,
} from "./config";
import { fetchAlpacaMarketQuotes } from "./fetch-quotes";
import { loadSyntheticAlpacaMarketPanel } from "./demo-fixtures";

export interface LoadAlpacaMarketPanelOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly now?: Date;
  readonly config?: AlpacaClientConfig;
  readonly fetchImpl?: FetchLike;
  readonly publicDemo?: boolean;
}

function healthFromState(input: {
  readonly checkedAt: string;
  readonly configured: boolean;
  readonly credentialState: AlpacaHealthStatus["credentialState"];
  readonly reachable: boolean;
  readonly message: string;
  readonly isPublicDemo: boolean;
  readonly source: AlpacaHealthStatus["source"];
}): AlpacaHealthStatus {
  return {
    kind: "AlpacaHealthStatus",
    schemaVersion: ALPACA_MARKET_PANEL_SCHEMA_VERSION,
    checkedAt: input.checkedAt,
    configured: input.configured,
    credentialState: input.credentialState,
    reachable: input.reachable,
    message: input.message,
    isPublicDemo: input.isPublicDemo,
    source: input.source,
  };
}

export async function loadAlpacaHealth(
  options: LoadAlpacaMarketPanelOptions = {},
): Promise<AlpacaHealthStatus> {
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const checkedAt = now.toISOString();
  const isPublicDemo = options.publicDemo ?? isPublicDemoMode(env);

  if (isPublicDemo) {
    return healthFromState({
      checkedAt,
      configured: false,
      credentialState: "missing",
      reachable: false,
      message: "Public demo uses synthetic market fixtures — Alpaca not called",
      isPublicDemo: true,
      source: "synthetic_demo",
    });
  }

  const config = options.config ?? loadAlpacaClientConfig(env);
  if (!config.credentials) {
    return healthFromState({
      checkedAt,
      configured: false,
      credentialState: "missing",
      reachable: false,
      message: "Alpaca not configured",
      isPublicDemo: false,
      source: "unavailable",
    });
  }

  const client = createAlpacaClient({
    config,
    fetchImpl: options.fetchImpl,
  });

  try {
    await client.getJson<Record<string, unknown>>("/v2/stocks/snapshots", {
      symbols: "SPY",
      feed: config.feed,
    });
    return healthFromState({
      checkedAt,
      configured: true,
      credentialState: "configured",
      reachable: true,
      message: "Alpaca market data reachable",
      isPublicDemo: false,
      source: "alpaca",
    });
  } catch (error: unknown) {
    if (error instanceof AlpacaClientError) {
      return healthFromState({
        checkedAt,
        configured: true,
        credentialState: mapAlpacaClientErrorToCredentialState(error.code),
        reachable: false,
        message: error.message,
        isPublicDemo: false,
        source: "unavailable",
      });
    }
    return healthFromState({
      checkedAt,
      configured: true,
      credentialState: "configured",
      reachable: false,
      message:
        error instanceof Error ? error.message : "Alpaca health check failed",
      isPublicDemo: false,
      source: "unavailable",
    });
  }
}

export async function loadAlpacaMarketPanel(
  options: LoadAlpacaMarketPanelOptions = {},
): Promise<AlpacaMarketPanel> {
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const fetchedAt = now.toISOString();
  const isPublicDemo = options.publicDemo ?? isPublicDemoMode(env);
  const watchlist = resolveAlpacaWatchlist(env);

  if (isPublicDemo) {
    return loadSyntheticAlpacaMarketPanel({ fetchedAt, watchlist });
  }

  const config = options.config ?? loadAlpacaClientConfig(env);
  const health = await loadAlpacaHealth({ ...options, config, publicDemo: false });

  if (!config.credentials) {
    return {
      kind: "AlpacaMarketPanel",
      schemaVersion: ALPACA_MARKET_PANEL_SCHEMA_VERSION,
      fetchedAt,
      configured: false,
      status: "not_configured",
      message: "Alpaca not configured",
      health,
      quotes: watchlist.map(
        (symbol): AlpacaMarketQuote => ({
          symbol,
          latestPrice: null,
          dailyChangePct: null,
          timestamp: null,
          source: "unavailable",
          status: "unavailable",
          error: "Alpaca not configured",
        }),
      ),
      watchlist,
    };
  }

  const client = createAlpacaClient({
    config,
    fetchImpl: options.fetchImpl,
  });

  try {
    const quotes = await fetchAlpacaMarketQuotes({
      client,
      config,
      symbols: watchlist,
      now,
    });
    const anyAvailable = quotes.some((q) => q.status === "available");
    const anyStale = quotes.some((q) => q.status === "stale");
    const allFailed = quotes.every((q) => q.status === "unavailable");
    const firstError = quotes.find((q) => q.error)?.error;

    return {
      kind: "AlpacaMarketPanel",
      schemaVersion: ALPACA_MARKET_PANEL_SCHEMA_VERSION,
      fetchedAt,
      configured: true,
      status: allFailed
        ? "error"
        : anyAvailable
          ? "ready"
          : anyStale
            ? "partial"
            : "partial",
      message: allFailed
        ? (firstError ?? health.message)
        : anyStale
          ? "Some Alpaca quotes are stale"
          : "Alpaca market data loaded",
      health,
      quotes,
      watchlist,
    };
  } catch (error: unknown) {
    const message =
      error instanceof AlpacaClientError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Alpaca market fetch failed";

    return {
      kind: "AlpacaMarketPanel",
      schemaVersion: ALPACA_MARKET_PANEL_SCHEMA_VERSION,
      fetchedAt,
      configured: true,
      status: "error",
      message,
      health,
      quotes: watchlist.map(
        (symbol): AlpacaMarketQuote => ({
          symbol,
          latestPrice: null,
          dailyChangePct: null,
          timestamp: null,
          source: "unavailable",
          status: "unavailable",
          error: message,
        }),
      ),
      watchlist,
    };
  }
}
