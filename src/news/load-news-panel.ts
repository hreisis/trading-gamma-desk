import type { FetchLike } from "@/ingest/http";
import {
  MARKET_NEWS_PANEL_SCHEMA_VERSION,
  type MarketNewsPanel,
} from "@/contracts/market-news";
import { isPublicDemoMode } from "@/desk/public-demo";
import {
  AlpacaClientError,
  createAlpacaClient,
  mapAlpacaClientErrorToCredentialState,
} from "@/alpaca/client";
import {
  buildNewsSections,
  distributeNewsItems,
} from "./categorize";
import { loadSyntheticMarketNewsPanel } from "./demo-fixture";
import { fetchAlpacaNewsBundle } from "./fetch-news";
import {
  loadAlpacaClientConfig,
  resolveNewsSymbolQuery,
  resolveNewsWatchlistExtras,
  type AlpacaClientConfig,
} from "./config";

export interface LoadMarketNewsPanelOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly now?: Date;
  readonly config?: AlpacaClientConfig;
  readonly fetchImpl?: FetchLike;
  readonly publicDemo?: boolean;
}

function panelStatusFromSections(
  sections: MarketNewsPanel["sections"],
  configured: boolean,
): MarketNewsPanel["status"] {
  if (!configured) return "not_configured";
  const anyReady = sections.some((section) => section.status === "ready");
  const anyError = sections.some((section) => section.status === "error");
  const allEmptyOrError = sections.every(
    (section) =>
      section.status === "empty" ||
      section.status === "error" ||
      section.status === "unavailable",
  );
  if (anyReady && (anyError || sections.some((s) => s.status === "empty"))) {
    return "partial";
  }
  if (anyReady) return "ready";
  if (anyError && allEmptyOrError) return "error";
  return "partial";
}

export async function loadMarketNewsPanel(
  options: LoadMarketNewsPanelOptions = {},
): Promise<MarketNewsPanel> {
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const fetchedAt = now.toISOString();
  const isPublicDemo = options.publicDemo ?? isPublicDemoMode(env);

  if (isPublicDemo) {
    return loadSyntheticMarketNewsPanel({ fetchedAt });
  }

  const config = options.config ?? loadAlpacaClientConfig(env);
  const watchlistExtras = resolveNewsWatchlistExtras(env);

  if (!config.credentials) {
    const sections = buildNewsSections({
      buckets: {
        macro: [],
        indices: [],
        crypto: [],
        watchlist: [],
      },
      unavailable: true,
    });
    return {
      kind: "MarketNewsPanel",
      schemaVersion: MARKET_NEWS_PANEL_SCHEMA_VERSION,
      fetchedAt,
      configured: false,
      status: "not_configured",
      message: "Alpaca not configured — set APCA_API_KEY_ID and APCA_API_SECRET_KEY",
      provider: "unavailable",
      sections,
    };
  }

  const client = createAlpacaClient({
    config,
    fetchImpl: options.fetchImpl,
  });

  try {
    const { macroItems, symbolItems } = await fetchAlpacaNewsBundle({
      client,
      symbolQuery: resolveNewsSymbolQuery(env),
      now,
    });
    const buckets = distributeNewsItems({
      macroItems,
      symbolItems,
      watchlistExtras,
    });
    const sections = buildNewsSections({ buckets });
    const status = panelStatusFromSections(sections, true);
    const anyStale = sections.some((section) =>
      section.items.some((item) => item.status === "stale"),
    );
    const categorizedCounts = {
      macro: buckets.macro.length,
      indices: buckets.indices.length,
      crypto: buckets.crypto.length,
      watchlist: buckets.watchlist.length,
    };
    const totalCategorized =
      categorizedCounts.macro +
      categorizedCounts.indices +
      categorizedCounts.crypto +
      categorizedCounts.watchlist;
    const totalRaw = macroItems.length + symbolItems.length;
    const diagnosticsMessage =
      totalRaw === 0
        ? "Alpaca returned zero articles for macro and symbol queries"
        : totalCategorized === 0
          ? `Alpaca returned ${totalRaw} articles but categorization matched none of the configured topics`
          : totalCategorized < totalRaw
            ? `Alpaca returned ${totalRaw} articles; ${totalCategorized} matched configured topics after dedupe/categorization`
            : undefined;

    return {
      kind: "MarketNewsPanel",
      schemaVersion: MARKET_NEWS_PANEL_SCHEMA_VERSION,
      fetchedAt,
      configured: true,
      status,
      message:
        status === "ready"
          ? anyStale
            ? "Alpaca news loaded — some headlines are stale"
            : "Alpaca news loaded"
          : status === "partial"
            ? diagnosticsMessage ?? "Alpaca news partially loaded"
            : diagnosticsMessage ??
              "No recent Alpaca headlines matched the configured topics",
      provider: "alpaca",
      sections,
      diagnostics: {
        macroRawCount: macroItems.length,
        symbolRawCount: symbolItems.length,
        categorizedCounts,
        providerStatus: status,
        providerError: diagnosticsMessage,
      },
    };
  } catch (error: unknown) {
    const message =
      error instanceof AlpacaClientError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Alpaca news fetch failed";
    const errorCode =
      error instanceof AlpacaClientError ? error.code : "unknown";
    const httpStatus =
      error instanceof AlpacaClientError ? error.statusCode ?? null : null;

    const credentialHint =
      error instanceof AlpacaClientError
        ? mapAlpacaClientErrorToCredentialState(error.code)
        : null;

    const sections = buildNewsSections({
      buckets: {
        macro: [],
        indices: [],
        crypto: [],
        watchlist: [],
      },
      sectionErrors: {
        macro: message,
        indices: message,
        crypto: message,
        watchlist: message,
      },
    });

    return {
      kind: "MarketNewsPanel",
      schemaVersion: MARKET_NEWS_PANEL_SCHEMA_VERSION,
      fetchedAt,
      configured: true,
      status: "error",
      message:
        credentialHint === "invalid"
          ? `${message} — check APCA credentials`
          : message,
      provider: "unavailable",
      sections,
      diagnostics: {
        macroRawCount: 0,
        symbolRawCount: 0,
        categorizedCounts: {
          macro: 0,
          indices: 0,
          crypto: 0,
          watchlist: 0,
        },
        providerStatus: "error",
        providerError: httpStatus
          ? `${message} (code=${errorCode}, http=${httpStatus})`
          : `${message} (code=${errorCode})`,
      },
    };
  }
}
