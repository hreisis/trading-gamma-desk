import { writeJsonAtomic } from "@/desk/atomic-write";
import { isPublicDemoMode } from "@/desk/public-demo";
import type { Catalyst, EventMarketContext } from "@/contracts";
import { loadCalendarCache } from "../cache";
import { loadResultsCache } from "../results/cache";
import { materializeResultsFeed } from "../results/link";
import { createAlpacaMarketDataProvider } from "./alpaca";
import { loadMarketContextCache } from "./cache";
import {
  BASELINE_LOOKBACK_MS,
  loadMarketContextConfig,
  MARKET_CONTEXT_FEED_DAYS,
  type MarketContextRuntimeConfig,
} from "./config";
import {
  buildEventMarketContext,
  eventTimestampUtcIso,
  marketContextIdFor,
  unavailableMarketContext,
} from "./compute";
import type { RawMarketBar } from "./bars";
import {
  filterMarketContextForFeed,
  isEligibleReleasedCatalyst,
} from "./materialize";
import {
  MARKET_CONTEXT_PROXIES,
  marketContextSymbolList,
} from "./proxies";
import type { MarketDataProvider } from "./provider";
import { classifyEventSession } from "./session";
import {
  DEFAULT_MARKET_CONTEXT_DATA_ROOT,
  marketContextLatestPath,
} from "./paths";
import type {
  CatalystMarketContextCache,
  MarketContextBuildError,
  MarketContextInputRef,
  MarketContextRevisionRecord,
} from "./types";
import { MARKET_CONTEXT_CALCULATION_VERSION } from "./version";

export {
  DEFAULT_MARKET_CONTEXT_DATA_ROOT,
  MARKET_CONTEXT_LATEST_RELATIVE,
  marketContextLatestPath,
} from "./paths";

export interface FetchMarketContextOptions {
  readonly now?: Date;
  readonly dataRoot?: string;
  readonly calendarDataRoot?: string;
  readonly resultsDataRoot?: string;
  readonly publicDemo?: boolean;
  readonly write?: boolean;
  readonly force?: boolean;
  readonly provider?: MarketDataProvider;
  readonly config?: Partial<MarketContextRuntimeConfig>;
  /** Test injection — skip calendar/results load. */
  readonly catalysts?: readonly Catalyst[];
  readonly maxPerRun?: number;
}

export interface FetchMarketContextResult {
  readonly cache: CatalystMarketContextCache;
  readonly path: string | null;
}

async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let i = 0;
  async function worker(): Promise<void> {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]!);
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

function barWindowForEvent(occurredAt: string): {
  start: string;
  end: string;
  sessionCloseUtc: Date | null;
} {
  const eventMs = Date.parse(occurredAt);
  const session = classifyEventSession(new Date(eventMs));
  const startMs = eventMs - BASELINE_LOOKBACK_MS;
  const endCandidates = [
    eventMs + 2 * 60 * 60 * 1000 + 5 * 60 * 1000,
    session.regularSessionCloseUtc?.getTime() ?? 0,
  ];
  const endMs = Math.max(...endCandidates, eventMs + 5 * 60 * 1000);
  return {
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString(),
    sessionCloseUtc: session.regularSessionCloseUtc,
  };
}

function loadEligibleCatalysts(options: {
  readonly now: Date;
  readonly calendarRoot: string;
  readonly resultsRoot: string;
  readonly injected?: readonly Catalyst[];
}): Catalyst[] {
  if (options.injected) {
    return options.injected.filter((c) =>
      isEligibleReleasedCatalyst(c, options.now, MARKET_CONTEXT_FEED_DAYS),
    );
  }
  const calendar = loadCalendarCache({
    dataRoot: options.calendarRoot,
    now: options.now,
  });
  const results = loadResultsCache({
    dataRoot: options.resultsRoot,
    now: options.now,
  });
  const scheduled = calendar.ok ? calendar.cache.catalysts : [];
  const releases = results.ok ? results.cache.releases : [];
  const linked = materializeResultsFeed({
    scheduled,
    releases,
    calendarAvailable: calendar.ok,
  });
  return linked.catalysts.filter((c) =>
    isEligibleReleasedCatalyst(c, options.now, MARKET_CONTEXT_FEED_DAYS),
  );
}

/**
 * Fetch observed ETF market context around released catalysts.
 * Reads local calendar + results caches only — never triggers other workflows.
 */
export async function fetchOfficialMarketContext(
  options: FetchMarketContextOptions = {},
): Promise<FetchMarketContextResult> {
  const publicDemo = options.publicDemo ?? isPublicDemoMode();
  if (publicDemo) {
    throw new Error(
      "Market context fetch is disabled in public demo (GAMMADESK_PUBLIC_DEMO). " +
        "Public demo serves synthetic market-context fixtures only.",
    );
  }

  const now = options.now ?? new Date();
  const fetchedAt = now.toISOString();
  const dataRoot = options.dataRoot ?? DEFAULT_MARKET_CONTEXT_DATA_ROOT;
  const calendarRoot = options.calendarDataRoot ?? dataRoot;
  const resultsRoot = options.resultsDataRoot ?? dataRoot;
  const runtime = loadMarketContextConfig(process.env, options.config ?? {});
  const provider =
    options.provider ??
    createAlpacaMarketDataProvider({ config: runtime });
  const symbolsKey = marketContextSymbolList();

  const eligible = loadEligibleCatalysts({
    now,
    calendarRoot,
    resultsRoot,
    injected: options.catalysts,
  }).slice(0, options.maxPerRun ?? runtime.maxPerRun);

  const prior = loadMarketContextCache({ dataRoot, now });
  const priorByCatalyst = new Map<string, EventMarketContext>();
  if (prior.ok) {
    for (const s of prior.cache.snapshots) {
      priorByCatalyst.set(s.catalystId, s);
    }
  }

  if (!runtime.credentials && !options.provider) {
    const unavailableCache: CatalystMarketContextCache = {
      kind: "CatalystMarketContextCache",
      schemaVersion: "0.1.0",
      fetchedAt,
      provider: provider.providerId,
      feed: runtime.feed,
      calculationVersion: MARKET_CONTEXT_CALCULATION_VERSION,
      buildStatus: "unavailable",
      inputRefs: prior.ok ? prior.cache.inputRefs : [],
      snapshots: prior.ok ? prior.cache.snapshots : [],
      revisions: prior.ok ? prior.cache.revisions : [],
      errors: [
        {
          catalystId: "*",
          error:
            "APCA_API_KEY_ID / APCA_API_SECRET_KEY missing — market context unavailable",
          status: "unavailable",
        },
      ],
      warnings: [
        "Alpaca credentials missing — prior market-context cache preserved; UI shows no live context.",
      ],
    };
    return { cache: unavailableCache, path: null };
  }

  const outSnapshots: EventMarketContext[] = prior.ok
    ? [
        ...prior.cache.snapshots.filter(
          (s) => !eligible.some((e) => e.id === s.catalystId),
        ),
      ]
    : [];
  const inputRefs: MarketContextInputRef[] = prior.ok
    ? [...prior.cache.inputRefs]
    : [];
  const revisions: MarketContextRevisionRecord[] = prior.ok
    ? [...prior.cache.revisions]
    : [];
  const errors: MarketContextBuildError[] = [];
  const warnings: string[] = [];

  const results = await mapPool(
    eligible,
    runtime.maxConcurrency,
    async (catalyst) => {
      const eventTimestamp = eventTimestampUtcIso(catalyst.occurredAt);
      const expectedId = marketContextIdFor({
        catalystId: catalyst.id,
        eventTimestamp,
        provider: provider.providerId,
        feed: runtime.feed,
        symbols: symbolsKey,
        calculationVersion: MARKET_CONTEXT_CALCULATION_VERSION,
      });
      const previous = priorByCatalyst.get(catalyst.id);
      if (
        !options.force &&
        previous &&
        previous.id === expectedId &&
        (previous.status === "complete" || previous.status === "partial")
      ) {
        return { kind: "reuse" as const, snapshot: previous };
      }

      const window = barWindowForEvent(catalyst.occurredAt);
      const barsBySymbol = new Map<string, readonly RawMarketBar[]>();
      const symbolErrors: string[] = [];
      let authFail = false;

      for (const proxy of MARKET_CONTEXT_PROXIES) {
        try {
          const fetched = await provider.fetchBars({
            symbol: proxy.symbol,
            start: window.start,
            end: window.end,
            timeframe: "1Min",
            feed: runtime.feed,
          });
          if (!fetched.ok) {
            symbolErrors.push(`${proxy.symbol}: ${fetched.error}`);
            if (fetched.unavailable || fetched.statusCode === 403) {
              authFail = true;
            }
            continue;
          }
          barsBySymbol.set(proxy.symbol, fetched.bars);
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          symbolErrors.push(`${proxy.symbol}: ${message}`);
        }
      }

      if (authFail && barsBySymbol.size === 0) {
        const snap = unavailableMarketContext({
          catalystId: catalyst.id,
          releaseFamily: catalyst.releaseFamily,
          occurredAt: catalyst.occurredAt,
          provider: provider.providerId,
          feed: runtime.feed,
          fetchedAt,
          error: symbolErrors.join("; ") || "provider unavailable",
          synthetic: catalyst.synthetic,
        });
        return {
          kind: "done" as const,
          snapshot: snap,
          error: snap.errors[0],
        };
      }

      const snapshot = buildEventMarketContext({
        catalystId: catalyst.id,
        releaseFamily: catalyst.releaseFamily,
        occurredAt: catalyst.occurredAt,
        provider: provider.providerId,
        feed: runtime.feed,
        fetchedAt,
        barsBySymbol,
        synthetic: catalyst.synthetic,
        extraErrors: symbolErrors,
      });

      return {
        kind: "done" as const,
        snapshot,
        error:
          snapshot.status === "unavailable"
            ? snapshot.errors.join("; ") || "unavailable"
            : symbolErrors.length > 0
              ? symbolErrors.join("; ")
              : undefined,
        previous,
      };
    },
  );

  let successCount = 0;
  let failCount = 0;
  for (let i = 0; i < eligible.length; i += 1) {
    const catalyst = eligible[i]!;
    const result = results[i]!;
    const snapshot = result.snapshot;
    outSnapshots.push(snapshot);
    inputRefs.push({
      catalystId: catalyst.id,
      eventTimestamp: snapshot.eventTimestamp,
      provider: provider.providerId,
      feed: runtime.feed,
      symbols: symbolsKey,
      calculationVersion: MARKET_CONTEXT_CALCULATION_VERSION,
    });
    if (
      result.kind === "done" &&
      result.previous &&
      result.previous.id !== snapshot.id
    ) {
      revisions.push({
        catalystId: catalyst.id,
        previousId: result.previous.id,
        currentId: snapshot.id,
        observedAt: fetchedAt,
        reason: options.force ? "force refresh" : "identity changed",
      });
    }
    if (snapshot.status === "complete" || snapshot.status === "partial") {
      successCount += 1;
    } else {
      failCount += 1;
      if (result.kind === "done" && result.error) {
        errors.push({
          catalystId: catalyst.id,
          error: result.error,
          status: snapshot.status,
        });
      }
    }
  }

  const byCatalyst = new Map<string, EventMarketContext>();
  for (const s of outSnapshots) byCatalyst.set(s.catalystId, s);
  const deduped = [...byCatalyst.values()];

  const allFailed = eligible.length > 0 && successCount === 0;
  const providerTotalFailure =
    allFailed &&
    errors.every((e) =>
      /missing|timed out|HTTP 5|HTTP 403|HTTP 429|provider failure|unavailable/i.test(
        e.error,
      ),
    );

  const buildStatus: CatalystMarketContextCache["buildStatus"] =
    eligible.length === 0
      ? prior.ok
        ? prior.cache.buildStatus
        : "ok"
      : allFailed
        ? "failed"
        : failCount > 0
          ? "partial"
          : "ok";

  const cache: CatalystMarketContextCache = {
    kind: "CatalystMarketContextCache",
    schemaVersion: "0.1.0",
    fetchedAt,
    provider: provider.providerId,
    feed: runtime.feed,
    calculationVersion: MARKET_CONTEXT_CALCULATION_VERSION,
    buildStatus,
    inputRefs: dedupeInputRefs(inputRefs),
    snapshots: deduped,
    revisions: revisions.slice(-100),
    errors,
    warnings,
  };

  const shouldWrite =
    options.write !== false &&
    !(providerTotalFailure && prior.ok && prior.cache.snapshots.length > 0);

  let path: string | null = null;
  if (shouldWrite) {
    path = marketContextLatestPath(dataRoot);
    writeJsonAtomic(path, cache);
  } else if (providerTotalFailure) {
    warnings.push(
      "Provider-wide failure — prior market-context cache left untouched.",
    );
  }

  return { cache, path };
}

function dedupeInputRefs(
  refs: readonly MarketContextInputRef[],
): MarketContextInputRef[] {
  const map = new Map<string, MarketContextInputRef>();
  for (const r of refs) map.set(r.catalystId, r);
  return [...map.values()];
}

export { filterMarketContextForFeed, isEligibleReleasedCatalyst };
