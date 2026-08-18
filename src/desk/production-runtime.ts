import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { CatalystQuery, CatalystFeedResponse } from "@/catalyst/types";
import { fetchOfficialCalendar } from "@/catalyst/fetch-calendar";
import { loadCatalystFeed } from "@/catalyst/load";
import { fetchOfficialResults } from "@/catalyst/results/fetch-results";
import { resolveMarketDataApiToken } from "@/gamma/marketdata-app/config";
import {
  isMarketDataCreditLimitExhausted,
  markMarketDataCreditsExhausted,
  shouldDeferMarketDataGammaRefresh,
} from "@/gamma/marketdata-app/credits";
import { resolveBoundedGammaExpiration } from "@/gamma/marketdata-app/resolve-expiration";
import { runBoundedGammaProvider } from "@/gamma/marketdata-app/run";
import { boundedGammaArtifactRelativePath, boundedGammaLatestPath } from "@/gamma/marketdata-app/paths";
import {
  artifactSourceLabel,
  createFilesystemRuntimeJsonStore,
  readJson,
  resolveEphemeralDataRoot,
  resolveRuntimeJsonStore,
  type RuntimeJsonStore,
} from "./runtime-store";
import {
  isBoundedGammaSessionStale,
  resolveBoundedGammaTargetSession,
} from "./bounded-gamma-freshness";
import {
  resolveCurrentMarketSessionDate,
  resolveLastCompletedMarketSessionDate,
} from "@/ai-study/session";
import { runDailyPipeline } from "@/pipeline/run-daily";
import { loadMacroDesk, loadMacroDeskAsync } from "./load-macro-desk";
import { loadSessionDriver, loadSessionDriverAsync } from "./load-session-driver";
import {
  loadBoundedGammaDeskView,
  type BoundedGammaDeskView,
  type LoadBoundedGammaOptions,
} from "./load-bounded-gamma";
import { resolveDeskRequest, type ResolveDeskRequestOptions } from "./resolve-desk-request";
import type { MacroDeskView } from "./types";

function tiingoToken(env: NodeJS.ProcessEnv): string {
  return (env.TIINGO_TOKEN ?? "").trim().replace(/^["']|["']$/g, "");
}

/** Ephemeral serverless cache TTL — avoids re-fetching every request on warm instances. */
export const RUNTIME_ARTIFACT_TTL_MS = 15 * 60 * 1000;

export function isServerlessHost(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean((env.VERCEL ?? "").trim());
}

export function deskDataRootFromGammaProviderRoot(gammaProviderRoot: string): string {
  return join(gammaProviderRoot, "..", "..", "..");
}

function resolveGammaArtifactStore(
  options: Pick<LoadBoundedGammaOptions, "dataRoot" | "artifactStore">,
  env: NodeJS.ProcessEnv,
): RuntimeJsonStore {
  if (options.artifactStore) return options.artifactStore;
  if (isServerlessHost(env)) return resolveRuntimeJsonStore(env);
  if (options.dataRoot) {
    return createFilesystemRuntimeJsonStore({
      dataRoot: deskDataRootFromGammaProviderRoot(options.dataRoot),
    });
  }
  return resolveRuntimeJsonStore(env);
}

/**
 * Ephemeral scratch for non-durable caches (bars, catalyst, pipeline status).
 * Durable desk artifacts use `resolveRuntimeJsonStore()`.
 */
export function resolveRuntimeDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  return resolveEphemeralDataRoot(env);
}

async function hasMacroDriverForSessionAsync(
  artifactStore: RuntimeJsonStore,
  sessionDate: string,
): Promise<boolean> {
  const loaded = await loadSessionDriverAsync(sessionDate, artifactStore);
  if (!loaded.driver) return false;
  if (
    loaded.issues.some(
      (issue) => issue.severity === "missing" || issue.severity === "mismatched",
    )
  ) {
    return false;
  }
  if (loaded.driver.primaryRegime === "insufficient_data") {
    return false;
  }
  return true;
}

const macroRefreshByRoot = new Map<string, Promise<{ ok: boolean; error?: string }>>();

export async function ensureMacroDriverArtifact(options: {
  readonly dataRoot?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly artifactStore?: RuntimeJsonStore;
} = {}): Promise<{ readonly refreshed: boolean; readonly ok: boolean; readonly error?: string }> {
  const env = options.env ?? process.env;
  const dataRoot = options.dataRoot ?? resolveRuntimeDataRoot(env);
  const artifactStore = options.artifactStore ?? resolveRuntimeJsonStore(env);
  ensureDir(join(dataRoot, "drivers"));
  const sessionDate = resolveLastCompletedMarketSessionDate();

  if (await hasMacroDriverForSessionAsync(artifactStore, sessionDate)) {
    return { refreshed: false, ok: true };
  }

  const token = tiingoToken(env);
  if (!token) {
    return {
      refreshed: false,
      ok: false,
      error: "TIINGO_TOKEN not configured — macro ingest unavailable on serverless host",
    };
  }

  const refreshKey = `${artifactStore.rootLabel}:${sessionDate}`;
  let pending = macroRefreshByRoot.get(refreshKey);
  if (!pending) {
    pending = (async () => {
      try {
        await runDailyPipeline({
          dataRoot,
          token,
          artifactStore,
          force: true,
        });
        return { ok: await hasMacroDriverForSessionAsync(artifactStore, sessionDate) };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, error: message };
      } finally {
        macroRefreshByRoot.delete(refreshKey);
      }
    })();
    macroRefreshByRoot.set(refreshKey, pending);
  }

  const result = await pending;
  return { refreshed: true, ...result };
}

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

export async function resolveDeskRequestAsync(
  options: ResolveDeskRequestOptions = {},
): Promise<MacroDeskView> {
  const env = process.env;
  const publicDemo = options.publicDemo === true || options.demoPath === true;
  if (publicDemo || options.source === "fixture") {
    return resolveDeskRequest(options);
  }

  const dataRoot = options.dataRoot ?? resolveRuntimeDataRoot(env);
  const artifactStore = resolveRuntimeJsonStore(env);
  const sync = await loadMacroDeskAsync({
    ...options,
    dataRoot,
    artifactStore,
  });

  const currentSession = resolveCurrentMarketSessionDate();
  const macroSessionStale =
    sync.driver !== null && sync.driver.marketSessionDate !== currentSession;

  if (
    sync.status !== "empty" &&
    options.source !== "live" &&
    !macroSessionStale &&
    !sync.sessionStale
  ) {
    return sync;
  }

  const refresh = await ensureMacroDriverArtifact({ dataRoot, env, artifactStore });
  if (!refresh.ok) {
    return {
      ...sync,
      error: {
        code: "empty",
        message:
          refresh.error ??
          "no drivers under data/drivers; run npm run daily or configure TIINGO_TOKEN for serverless refresh",
      },
    };
  }

  return loadMacroDeskAsync({
    ...options,
    dataRoot,
    artifactStore,
  });
}

const catalystRefreshByRoot = new Map<string, Promise<void>>();

async function ensureCatalystCaches(dataRoot: string, env: NodeJS.ProcessEnv): Promise<void> {
  let pending = catalystRefreshByRoot.get(dataRoot);
  if (!pending) {
    pending = (async () => {
      ensureDir(join(dataRoot, "catalyst"));
      await fetchOfficialCalendar({
        dataRoot,
        publicDemo: false,
        write: true,
      });
      try {
        await fetchOfficialResults({
          dataRoot,
          publicDemo: false,
          write: true,
          calendarDataRoot: dataRoot,
        });
      } catch {
        // Calendar-only feed is still useful when BLS results fetch fails.
      }
    })().finally(() => {
      catalystRefreshByRoot.delete(dataRoot);
    });
    catalystRefreshByRoot.set(dataRoot, pending);
  }
  await pending;
}

export async function loadCatalystFeedAsync(
  query: CatalystQuery = {},
  options: {
    readonly publicDemo?: boolean;
    readonly now?: Date;
    readonly dataRoot?: string;
    readonly forceSynthetic?: boolean;
    readonly env?: NodeJS.ProcessEnv;
  } = {},
): Promise<CatalystFeedResponse> {
  const env = options.env ?? process.env;
  const dataRoot = options.dataRoot ?? resolveRuntimeDataRoot(env);
  const sync = loadCatalystFeed(query, {
    ...options,
    dataRoot,
    publicDemo: options.publicDemo ?? false,
  });

  if (
    options.publicDemo ||
    options.forceSynthetic ||
    sync.mode === "official_calendar"
  ) {
    return sync;
  }

  if (sync.mode === "stale_calendar" || sync.mode === "live_unavailable") {
    try {
      await ensureCatalystCaches(dataRoot, env);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ...sync,
        disclaimer: `${sync.disclaimer} Runtime calendar fetch failed: ${message}`,
      };
    }

    return loadCatalystFeed(query, {
      ...options,
      dataRoot,
      publicDemo: false,
    });
  }

  return sync;
}

function parseOptionalNumber(raw: string | undefined): number | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function resolveGammaStrikeParams(
  symbol: string,
  env: NodeJS.ProcessEnv,
): {
  readonly strikeMin: number;
  readonly strikeMax: number;
} {
  const envMin = parseOptionalNumber(env.GAMMA_BOUNDED_STRIKE_MIN);
  const envMax = parseOptionalNumber(env.GAMMA_BOUNDED_STRIKE_MAX);
  if (envMin !== null && envMax !== null) {
    return { strikeMin: envMin, strikeMax: envMax };
  }
  if (symbol === "QQQ") {
    return { strikeMin: 660, strikeMax: 780 };
  }
  return { strikeMin: 700, strikeMax: 820 };
}

function boundedGammaNeedsRefresh(
  view: BoundedGammaDeskView,
  targetSession: string,
): boolean {
  if (view.status === "empty") return true;
  const snap = view.snapshot;
  if (!snap) return true;
  if (snap.status === "unavailable") return true;
  if (isBoundedGammaSessionStale(snap.sessionDate, targetSession)) {
    return true;
  }
  return false;
}

const gammaRefreshByKey = new Map<string, Promise<void>>();

function cachedGammaCreditLimitMessage(sessionDate: string | null | undefined): string {
  const label = sessionDate ?? "cached";
  return `MarketData.app daily credits exhausted — showing cached snapshot (${label}) until 9:30 AM ET reset.`;
}

async function ensureBoundedGammaSnapshot(options: {
  readonly symbol: string;
  readonly dataRoot: string;
  readonly env: NodeJS.ProcessEnv;
  readonly artifactStore: RuntimeJsonStore;
  readonly targetSession: string;
}): Promise<{ readonly ok: boolean; readonly error?: string }> {
  const artifactRelativePath = boundedGammaArtifactRelativePath(options.symbol);
  const key = `${options.artifactStore.rootLabel}:${options.symbol}:${artifactRelativePath}:${options.targetSession}`;

  const token = resolveMarketDataApiToken(options.env);
  if (!token) {
    return {
      ok: false,
      error: "MARKETDATA_API_TOKEN not configured — bounded gamma fetch unavailable",
    };
  }

  if (shouldDeferMarketDataGammaRefresh()) {
    return {
      ok: false,
      error:
        "MarketData.app daily credits exhausted — refresh deferred until 9:30 AM ET reset",
    };
  }

  const params = resolveGammaStrikeParams(options.symbol, options.env);
  const sessionDate = options.targetSession;

  let expiration: Awaited<ReturnType<typeof resolveBoundedGammaExpiration>>;
  try {
    expiration = await resolveBoundedGammaExpiration({
      symbol: options.symbol,
      sessionDate,
      configuredExpiration: options.env.GAMMA_BOUNDED_EXPIRATION,
      token,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (isMarketDataCreditLimitExhausted({ message })) {
      markMarketDataCreditsExhausted();
    }
    return { ok: false, error: message };
  }

  let pending = gammaRefreshByKey.get(key);
  if (!pending) {
    pending = (async () => {
      ensureDir(options.dataRoot);
      const result = await runBoundedGammaProvider({
        symbol: options.symbol,
        expiration: expiration.expiration,
        strikeMin: params.strikeMin,
        strikeMax: params.strikeMax,
        strikeStep: 1,
        write: true,
        dataRoot: options.dataRoot,
        token,
        env: options.env,
        sessionDate,
        artifactStore: options.artifactStore,
      });
      if (!result.ok) {
        if (
          result.code === "credit_limit" ||
          isMarketDataCreditLimitExhausted({ message: result.error })
        ) {
          markMarketDataCreditsExhausted();
        }
        throw new Error(result.error);
      }
    })().finally(() => {
      gammaRefreshByKey.delete(key);
    });
    gammaRefreshByKey.set(key, pending);
  }

  try {
    await pending;
    return { ok: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}

export async function loadBoundedGammaDeskViewAsync(
  options: LoadBoundedGammaOptions = {},
): Promise<BoundedGammaDeskView> {
  const env = options.env ?? process.env;
  const symbol = (options.symbol ?? "SPY").toUpperCase();
  const artifactStore = resolveGammaArtifactStore(options, env);
  const dataRoot =
    options.dataRoot ??
    join(resolveRuntimeDataRoot(env), "gamma", "providers", "marketdata-app");
  const targetSession =
    options.targetSession ??
    resolveBoundedGammaTargetSession(options.now ?? new Date());
  const artifactRelativePath = boundedGammaArtifactRelativePath(symbol);
  const prefetched = await readJson(artifactStore, artifactRelativePath);

  const sync = loadBoundedGammaDeskView({
    ...options,
    dataRoot,
    publicDemo: options.publicDemo ?? false,
    targetSession,
    prefetchedSnapshot: prefetched ?? undefined,
    prefetchedSourceLabel: prefetched
      ? artifactSourceLabel(artifactStore, artifactRelativePath)
      : undefined,
  });

  if (
    options.publicDemo ||
    options.forceFixture ||
    !boundedGammaNeedsRefresh(sync, targetSession)
  ) {
    return sync;
  }

  const now = options.now ?? new Date();
  if (shouldDeferMarketDataGammaRefresh(now)) {
    if (sync.snapshot !== null) {
      return {
        ...sync,
        error: {
          code: "credit_limit_deferred",
          message: cachedGammaCreditLimitMessage(sync.snapshot.sessionDate),
        },
      };
    }
    return sync;
  }

  const refresh = await ensureBoundedGammaSnapshot({
    symbol,
    dataRoot,
    env,
    artifactStore,
    targetSession,
  });

  const refreshedRaw = await readJson(artifactStore, artifactRelativePath);
  const reloaded = loadBoundedGammaDeskView({
    ...options,
    dataRoot,
    publicDemo: false,
    targetSession,
    prefetchedSnapshot: refreshedRaw ?? prefetched ?? undefined,
    prefetchedSourceLabel:
      refreshedRaw || prefetched
        ? artifactSourceLabel(artifactStore, artifactRelativePath)
        : undefined,
  });

  if (!refresh.ok) {
    if (reloaded.snapshot !== null) {
      const sessionLabel = reloaded.snapshot.sessionDate;
      const creditDeferred = isMarketDataCreditLimitExhausted({
        message: refresh.error,
      });
      return {
        ...reloaded,
        error: {
          code: creditDeferred ? "credit_limit_deferred" : "refresh_failed",
          message: creditDeferred
            ? cachedGammaCreditLimitMessage(sessionLabel)
            : `${refresh.error ?? "Bounded gamma refresh failed"} — showing cached snapshot (${sessionLabel}).`,
        },
      };
    }

    return {
      ...reloaded,
      status: "empty",
      snapshot: null,
      withheldSnapshot: null,
      error: {
        code: "empty",
        message:
          refresh.error ??
          "No bounded gamma snapshot — configure MARKETDATA_API_TOKEN and GAMMA_BOUNDED_* env vars",
      },
    };
  }

  return reloaded;
}
