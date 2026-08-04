import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { CatalystQuery, CatalystFeedResponse } from "@/catalyst/types";
import { fetchOfficialCalendar } from "@/catalyst/fetch-calendar";
import { loadCatalystFeed } from "@/catalyst/load";
import { fetchOfficialResults } from "@/catalyst/results/fetch-results";
import { resolveMarketDataApiToken } from "@/gamma/marketdata-app/config";
import { runBoundedGammaProvider } from "@/gamma/marketdata-app/run";
import { boundedGammaLatestPath } from "@/gamma/marketdata-app/paths";
import { sessionDateFromIso } from "@/gamma/marketdata-app/time";
import { resolveCurrentMarketSessionDate } from "@/ai-study/session";
import { runDailyPipeline } from "@/pipeline/run-daily";
import { loadMacroDesk } from "./load-macro-desk";
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
 * Local dev uses gitignored `data/`. Vercel uses writable `/tmp` (not durable
 * across cold starts, but sufficient for request-scoped provider refresh).
 */
export function resolveRuntimeDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  if (isServerlessHost(env)) {
    return join("/tmp", "gammadesk-data");
  }
  return join(process.cwd(), "data");
}

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

function macroDriversDir(dataRoot: string): string {
  return join(dataRoot, "drivers");
}

function hasMacroDriver(dataRoot: string): boolean {
  const view = loadMacroDesk({
    dataRoot,
    allowFixture: false,
    preferFixture: false,
  });
  return view.status === "ready" && view.driver !== null;
}

const macroRefreshByRoot = new Map<string, Promise<{ ok: boolean; error?: string }>>();

export async function ensureMacroDriverArtifact(options: {
  readonly dataRoot?: string;
  readonly env?: NodeJS.ProcessEnv;
} = {}): Promise<{ readonly refreshed: boolean; readonly ok: boolean; readonly error?: string }> {
  const env = options.env ?? process.env;
  const dataRoot = options.dataRoot ?? resolveRuntimeDataRoot(env);
  ensureDir(macroDriversDir(dataRoot));

  if (hasMacroDriver(dataRoot)) {
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
        return { ok: hasMacroDriver(dataRoot) };
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

  if (sync.status !== "empty" || options.source === "live") {
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
    sync.mode === "official_calendar" ||
    sync.mode === "stale_calendar"
  ) {
    return sync;
  }

  if (sync.mode !== "live_unavailable") {
    return sync;
  }

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

function parseOptionalNumber(raw: string | undefined): number | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function resolveGammaFetchParams(env: NodeJS.ProcessEnv): {
  readonly expiration: string;
  readonly strikeMin: number;
  readonly strikeMax: number;
} {
  const sessionDate = resolveCurrentMarketSessionDate();
  const configuredExpiration = (env.GAMMA_BOUNDED_EXPIRATION ?? "").trim();
  const expiration =
    configuredExpiration ||
    sessionDateFromIso(
      new Date(
        Date.parse(`${sessionDate}T12:00:00-04:00`) + 86_400_000,
      ).toISOString(),
    );

  const strikeMin = parseOptionalNumber(env.GAMMA_BOUNDED_STRIKE_MIN) ?? 620;
  const strikeMax = parseOptionalNumber(env.GAMMA_BOUNDED_STRIKE_MAX) ?? 720;

  return { expiration, strikeMin, strikeMax };
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

  const params = resolveGammaFetchParams(options.env);

  let pending = gammaRefreshByKey.get(key);
  if (!pending) {
    pending = (async () => {
      ensureDir(options.dataRoot);
      const result = await runBoundedGammaProvider({
        symbol: options.symbol,
        expiration: params.expiration,
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

  const sync = loadBoundedGammaDeskView({
    ...options,
    dataRoot,
    publicDemo: options.publicDemo ?? false,
  });

  if (
    options.publicDemo ||
    options.forceFixture ||
    sync.status !== "empty"
  ) {
    return sync;
  }

  const refresh = await ensureBoundedGammaSnapshot({ symbol, dataRoot, env });
  if (!refresh.ok) {
    return {
      ...sync,
      error: {
        code: "empty",
        message:
          refresh.error ??
          "No bounded gamma snapshot — configure MARKETDATA_API_TOKEN and GAMMA_BOUNDED_* env vars",
      },
    };
  }

  return loadBoundedGammaDeskView({
    ...options,
    dataRoot,
    publicDemo: false,
  });
}
