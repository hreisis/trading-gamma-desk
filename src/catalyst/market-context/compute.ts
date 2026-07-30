import { createHash } from "node:crypto";
import type {
  EventMarketContext,
  MarketContextSessionMeta,
  MarketContextSymbolSnapshot,
  MarketContextWindow,
  MarketContextWindowKind,
} from "@/contracts";
import {
  BASELINE_LOOKBACK_MS,
  WINDOW_SLACK_MS,
} from "./config";
import {
  findBaselineBar,
  findSessionCloseBar,
  findWindowBar,
  normalizeBars,
  type NormalizedBar,
  type RawMarketBar,
} from "./bars";
import {
  MARKET_CONTEXT_PROXIES,
  marketContextSymbolList,
  type MarketContextProxy,
} from "./proxies";
import { pctChangeFromPrices } from "./returns";
import { classifyEventSession } from "./session";
import { MARKET_CONTEXT_CALCULATION_VERSION } from "./version";

const WINDOW_OFFSETS_MS: ReadonlyArray<{
  kind: MarketContextWindowKind;
  offsetMs: number | "sessionClose";
}> = [
  { kind: "plus5m", offsetMs: 5 * 60 * 1000 },
  { kind: "plus30m", offsetMs: 30 * 60 * 1000 },
  { kind: "plus2h", offsetMs: 2 * 60 * 60 * 1000 },
  { kind: "sessionClose", offsetMs: "sessionClose" },
];

export function marketContextIdFor(parts: {
  readonly catalystId: string;
  readonly eventTimestamp: string;
  readonly provider: string;
  readonly feed: string;
  readonly symbols: string;
  readonly calculationVersion: string;
}): string {
  const digest = createHash("sha256")
    .update(
      [
        parts.catalystId,
        parts.eventTimestamp,
        parts.provider,
        parts.feed,
        parts.symbols,
        parts.calculationVersion,
      ].join("|"),
      "utf8",
    )
    .digest("hex")
    .slice(0, 16);
  return `mctx_${digest}`;
}

export function eventTimestampUtcIso(occurredAt: string): string {
  const ms = Date.parse(occurredAt);
  if (!Number.isFinite(ms)) {
    throw new Error(`invalid event timestamp: ${occurredAt}`);
  }
  return new Date(ms).toISOString();
}

function unavailableWindow(kind: MarketContextWindowKind): MarketContextWindow {
  return {
    kind,
    status: "unavailable",
    pctChange: null,
  };
}

function availableWindow(
  kind: MarketContextWindowKind,
  bar: NormalizedBar,
  baselinePrice: number,
): MarketContextWindow {
  return {
    kind,
    status: "available",
    price: bar.close,
    barTimestamp: bar.timestamp,
    pctChange: pctChangeFromPrices(baselinePrice, bar.close),
  };
}

export function computeSymbolSnapshot(options: {
  readonly proxy: MarketContextProxy;
  readonly bars: readonly RawMarketBar[];
  readonly eventMs: number;
  readonly sessionCloseUtc: Date | null;
  readonly lookbackMs?: number;
  readonly slackMs?: number;
}): { snapshot: MarketContextSymbolSnapshot; warnings: string[] } {
  const lookbackMs = options.lookbackMs ?? BASELINE_LOOKBACK_MS;
  const slackMs = options.slackMs ?? WINDOW_SLACK_MS;
  const { bars, warnings } = normalizeBars(options.bars);
  const baseline = findBaselineBar(bars, options.eventMs, lookbackMs);

  const windows: MarketContextWindow[] = [];
  const missing: MarketContextWindowKind[] = [];

  if (!baseline) {
    for (const w of WINDOW_OFFSETS_MS) {
      windows.push(unavailableWindow(w.kind));
      missing.push(w.kind);
    }
    return {
      snapshot: {
        symbol: options.proxy.symbol,
        instrumentLabel: options.proxy.instrumentLabel,
        proxyRole: options.proxy.proxyRole,
        baseline: null,
        windows,
        missingWindows: missing,
      },
      warnings: [...warnings, "baseline unavailable — no look-ahead used"],
    };
  }

  for (const spec of WINDOW_OFFSETS_MS) {
    let bar: NormalizedBar | null = null;
    if (spec.offsetMs === "sessionClose") {
      if (options.sessionCloseUtc) {
        bar = findSessionCloseBar(bars, options.sessionCloseUtc);
        // Session close must be at/after the event; otherwise unavailable.
        if (bar && bar.timestampMs < options.eventMs) {
          bar = null;
        }
      }
    } else {
      bar = findWindowBar(bars, options.eventMs + spec.offsetMs, slackMs);
    }
    if (!bar) {
      windows.push(unavailableWindow(spec.kind));
      missing.push(spec.kind);
    } else {
      windows.push(availableWindow(spec.kind, bar, baseline.close));
    }
  }

  return {
    snapshot: {
      symbol: options.proxy.symbol,
      instrumentLabel: options.proxy.instrumentLabel,
      proxyRole: options.proxy.proxyRole,
      baseline: {
        price: baseline.close,
        barTimestamp: baseline.timestamp,
      },
      windows,
      missingWindows: missing,
    },
    warnings,
  };
}

export function buildEventMarketContext(options: {
  readonly catalystId: string;
  readonly releaseFamily?: string;
  readonly occurredAt: string;
  readonly provider: string;
  readonly feed: string;
  readonly fetchedAt: string;
  readonly barsBySymbol: ReadonlyMap<string, readonly RawMarketBar[]>;
  readonly proxies?: readonly MarketContextProxy[];
  readonly synthetic?: boolean;
  readonly extraErrors?: readonly string[];
}): EventMarketContext {
  const proxies = options.proxies ?? MARKET_CONTEXT_PROXIES;
  const eventTimestamp = eventTimestampUtcIso(options.occurredAt);
  const eventMs = Date.parse(eventTimestamp);
  const session = classifyEventSession(new Date(eventMs));
  const sessionMeta: MarketContextSessionMeta = {
    easternDate: session.easternDate,
    timezone: "America/New_York",
    isHoliday: session.isHoliday,
    isWeekend: session.isWeekend,
    isEarlyClose: session.isEarlyClose,
    regularSessionOpenEt: session.regularSessionOpenEt,
    regularSessionCloseEt: session.regularSessionCloseEt,
    eventInPremarket: session.eventInPremarket,
    eventInRegularSession: session.eventInRegularSession,
  };

  const errors: string[] = [...(options.extraErrors ?? [])];
  const symbols: MarketContextSymbolSnapshot[] = [];

  for (const proxy of proxies) {
    const raw = options.barsBySymbol.get(proxy.symbol) ?? [];
    const { snapshot, warnings } = computeSymbolSnapshot({
      proxy,
      bars: raw,
      eventMs,
      sessionCloseUtc: session.regularSessionCloseUtc,
    });
    symbols.push(snapshot);
    for (const w of warnings) {
      if (w.includes("malformed") || w.includes("duplicate")) {
        errors.push(`${proxy.symbol}: ${w}`);
      }
    }
  }

  const anyBaseline = symbols.some((s) => s.baseline !== null);
  const anyAvailable = symbols.some((s) =>
    s.windows.some((w) => w.status === "available"),
  );
  const allComplete =
    anyBaseline &&
    symbols.every(
      (s) => s.baseline !== null && s.missingWindows.length === 0,
    );
  const status = !anyAvailable
    ? "unavailable"
    : allComplete
      ? "complete"
      : "partial";

  if (session.isHoliday || session.isWeekend) {
    errors.push(
      `Event falls on ${session.isHoliday ? "holiday" : "weekend"} ${session.easternDate} — regular-session windows unavailable`,
    );
  }

  return {
    schemaVersion: "0.1.0",
    id: marketContextIdFor({
      catalystId: options.catalystId,
      eventTimestamp,
      provider: options.provider,
      feed: options.feed,
      symbols: marketContextSymbolList(proxies),
      calculationVersion: MARKET_CONTEXT_CALCULATION_VERSION,
    }),
    catalystId: options.catalystId,
    releaseFamily: options.releaseFamily,
    eventTimestamp,
    provider: options.provider,
    feed: options.feed,
    calculationVersion: MARKET_CONTEXT_CALCULATION_VERSION,
    timeframe: "1Min",
    timezone: "America/New_York",
    status,
    fetchedAt: options.fetchedAt,
    session: sessionMeta,
    symbols,
    errors,
    synthetic: options.synthetic ?? false,
  };
}

export function unavailableMarketContext(options: {
  readonly catalystId: string;
  readonly releaseFamily?: string;
  readonly occurredAt: string;
  readonly provider: string;
  readonly feed: string;
  readonly fetchedAt: string;
  readonly error: string;
  readonly synthetic?: boolean;
}): EventMarketContext {
  const eventTimestamp = eventTimestampUtcIso(options.occurredAt);
  const session = classifyEventSession(new Date(eventTimestamp));
  const proxies = MARKET_CONTEXT_PROXIES;
  return {
    schemaVersion: "0.1.0",
    id: marketContextIdFor({
      catalystId: options.catalystId,
      eventTimestamp,
      provider: options.provider,
      feed: options.feed,
      symbols: marketContextSymbolList(proxies),
      calculationVersion: MARKET_CONTEXT_CALCULATION_VERSION,
    }),
    catalystId: options.catalystId,
    releaseFamily: options.releaseFamily,
    eventTimestamp,
    provider: options.provider,
    feed: options.feed,
    calculationVersion: MARKET_CONTEXT_CALCULATION_VERSION,
    timeframe: "1Min",
    timezone: "America/New_York",
    status: "unavailable",
    fetchedAt: options.fetchedAt,
    session: {
      easternDate: session.easternDate,
      timezone: "America/New_York",
      isHoliday: session.isHoliday,
      isWeekend: session.isWeekend,
      isEarlyClose: session.isEarlyClose,
      regularSessionOpenEt: session.regularSessionOpenEt,
      regularSessionCloseEt: session.regularSessionCloseEt,
      eventInPremarket: session.eventInPremarket,
      eventInRegularSession: session.eventInRegularSession,
    },
    symbols: proxies.map((p) => ({
      symbol: p.symbol,
      instrumentLabel: p.instrumentLabel,
      proxyRole: p.proxyRole,
      baseline: null,
      windows: [
        unavailableWindow("plus5m"),
        unavailableWindow("plus30m"),
        unavailableWindow("plus2h"),
        unavailableWindow("sessionClose"),
      ],
      missingWindows: ["plus5m", "plus30m", "plus2h", "sessionClose"],
    })),
    errors: [options.error],
    synthetic: options.synthetic ?? false,
  };
}
