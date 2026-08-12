import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { CatalystQuery, CatalystFeedResponse } from "@/catalyst/types";
import { fetchOfficialCalendar } from "@/catalyst/fetch-calendar";
import { loadCatalystFeed } from "@/catalyst/load";
import { fetchOfficialResults } from "@/catalyst/results/fetch-results";
import { resolveMarketDataApiToken } from "@/gamma/marketdata-app/config";
import { resolveBoundedGammaExpiration } from "@/gamma/marketdata-app/resolve-expiration";
import { runBoundedGammaProvider } from "@/gamma/marketdata-app/run";
import { boundedGammaLatestPath } from "@/gamma/marketdata-app/paths";
import {
  isBoundedGammaSessionStale,
  resolveBoundedGammaTargetSession,
} from "./bounded-gamma-freshness";
import { resolveCurrentMarketSessionDate } from "@/ai-study/session";
import { runDailyPipeline } from "@/pipeline/run-daily";
import { loadMacroDesk } from "./load-macro-desk";
import { loadSessionDriver } from "./load-session-driver";
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

/**
 * Local dev uses gitignored `data/`. Vercel uses writable `/tmp` when local
 * `data/` is absent (true serverless cold start). If `data/` exists locally,
 * prefer it even when VERCEL is set in env — avoids missing cached artifacts.
 */
export function resolveRuntimeDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  const localRoot = join(process.cwd(), "data");
  if (!isServerlessHost(env) || existsSync(localRoot)) {
    return localRoot;
  }
  return join("/tmp", "gammadesk-data");
}

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

function macroDriversDir(dataRoot: string): string {
  return join(dataRoot, "drivers");
}

function hasMacroDriverForSession(
  dataRoot: string,
  sessionDate: string,
): boolean {
  const loaded = loadSessionDriver(sessionDate, dataRoot);
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
} = {}): Promise<{ readonly refreshed: boolean; readonly ok: boolean; readonly error?: string }> {
  const env = options.env ?? process.env;
  const dataRoot = options.dataRoot ?? resolveRuntimeDataRoot(env);
  ensureDir(macroDriversDir(dataRoot));
  const sessionDate = resolveCurrentMarketSessionDate();

  if (hasMacroDriverForSession(dataRoot, sessionDate)) {
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

  let pending = macroRefreshByRoot.get(dataRoot);
  if (!pending) {
    pending = (async () => {
      try {
        await runDailyPipeline({ dataRoot, token });
        return { ok: hasMacroDriverForSession(dataRoot, sessionDate) };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, error: message };
      } finally {
        macroRefreshByRoot.delete(dataRoot);
      }
    })();
    macroRefreshByRoot.set(dataRoot, pending);
  }

  const result = await pending;
  return { refreshed: true, ...result };
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
  const sync = resolveDeskRequest({
    ...options,
    dataRoot,
    publicDemo: false,
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

  const refresh = await ensureMacroDriverArtifact({ dataRoot, env });
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

  return resolveDeskRequest({
    ...options,
    dataRoot,
    publicDemo: false,
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

async function ensureBoundedGammaSnapshot(options: {
  readonly symbol: string;
  readonly dataRoot: string;
  readonly env: NodeJS.ProcessEnv;
}): Promise<{ readonly ok: boolean; readonly error?: string }> {
  const path = boundedGammaLatestPath(options.symbol, options.dataRoot);
  const key = `${options.dataRoot}:${options.symbol}:${path}`;

  const token = resolveMarketDataApiToken(options.env);
  if (!token) {
    return {
      ok: false,
      error: "MARKETDATA_API_TOKEN not configured — bounded gamma fetch unavailable",
    };
  }

  const params = resolveGammaStrikeParams(options.symbol, options.env);
  const sessionDate = resolveBoundedGammaTargetSession();
  const expiration = await resolveBoundedGammaExpiration({
    symbol: options.symbol,
    sessionDate,
    configuredExpiration: options.env.GAMMA_BOUNDED_EXPIRATION,
    token,
  });

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
      });
      if (!result.ok) {
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
  const dataRoot =
    options.dataRoot ??
    join(resolveRuntimeDataRoot(env), "gamma", "providers", "marketdata-app");
  const targetSession =
    options.targetSession ??
    resolveBoundedGammaTargetSession(options.now ?? new Date());

  const sync = loadBoundedGammaDeskView({
    ...options,
    dataRoot,
    publicDemo: options.publicDemo ?? false,
    targetSession,
  });

  if (
    options.publicDemo ||
    options.forceFixture ||
    !boundedGammaNeedsRefresh(sync, targetSession)
  ) {
    return sync;
  }

  const refresh = await ensureBoundedGammaSnapshot({ symbol, dataRoot, env });

  const reloaded = loadBoundedGammaDeskView({
    ...options,
    dataRoot,
    publicDemo: false,
    targetSession,
  });

  if (!refresh.ok) {
    if (reloaded.snapshot !== null) {
      const sessionLabel = reloaded.snapshot.sessionDate;
      return {
        ...reloaded,
        error: {
          code: "refresh_failed",
          message: `${refresh.error ?? "Bounded gamma refresh failed"} — showing cached snapshot (${sessionLabel}).`,
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
