import { createHash } from "node:crypto";
import type {
  EventMarketContext,
  EventMarketReaction,
  MarketContextWindowKind,
  ReactionDevelopment,
  ReactionInstrument,
  ReactionProxySymbol,
  ReactionWindowClassification,
  ReactionWindowId,
} from "@/contracts";
import { breadthToCrossAssetLeg, classifyEquityBreadth } from "./breadth";
import { classifyDirection } from "./direction";
import {
  aggregateEquityDevelopment,
  classifyDevelopmentPath,
} from "./development";
import { classifyEquityLeadership } from "./leadership";
import { buildObservations } from "./observations";
import { officialEventFactsIdentityFromContext } from "./official-identity";
import {
  ALL_REACTION_SYMBOLS,
  deadbandFor,
  EQUITY_SYMBOLS,
  PROXY_LABELS,
  REACTION_WINDOWS,
} from "./rules";
import { REACTION_RULES_VERSION } from "./version";

export {
  briefIdentityLine,
  officialEventFactsIdentity,
  officialEventFactsIdentityForCatalyst,
  officialEventFactsIdentityFromContext,
  officialFactsIdentityIndex,
  releaseResultFingerprint,
} from "./official-identity";

const WINDOW_MAP: Record<ReactionWindowId, MarketContextWindowKind> = {
  "5m": "plus5m",
  "30m": "plus30m",
  "2h": "plus2h",
  session_close: "sessionClose",
};

export function marketContextIdentity(ctx: EventMarketContext): string {
  return [
    ctx.id,
    ctx.catalystId,
    ctx.eventTimestamp,
    ctx.provider,
    ctx.feed,
    ctx.calculationVersion,
    ctx.status,
  ].join("|");
}

export function reactionIdFor(parts: {
  readonly catalystId: string;
  readonly marketContextId: string;
  readonly marketContextIdentity: string;
  readonly officialFactsIdentity: string;
  readonly reactionRulesVersion: string;
}): string {
  const digest = createHash("sha256")
    .update(
      [
        parts.catalystId,
        parts.marketContextId,
        parts.marketContextIdentity,
        parts.officialFactsIdentity,
        parts.reactionRulesVersion,
      ].join("|"),
      "utf8",
    )
    .digest("hex")
    .slice(0, 16);
  return `mrxn_${digest}`;
}

function getPct(
  ctx: EventMarketContext,
  symbol: ReactionProxySymbol,
  window: ReactionWindowId,
): {
  pct: number | null;
  baselineTs?: string;
  windowTs?: string;
} {
  const sym = ctx.symbols.find((s) => s.symbol === symbol);
  if (!sym || !sym.baseline) {
    return { pct: null };
  }
  const kind = WINDOW_MAP[window];
  const w = sym.windows.find((x) => x.kind === kind);
  if (!w || w.status !== "available" || w.pctChange === null) {
    return {
      pct: null,
      baselineTs: sym.baseline.barTimestamp,
    };
  }
  return {
    pct: w.pctChange,
    baselineTs: sym.baseline.barTimestamp,
    windowTs: w.barTimestamp,
  };
}

function classifyWindow(
  ctx: EventMarketContext,
  window: ReactionWindowId,
): ReactionWindowClassification {
  const instruments: ReactionInstrument[] = [];
  const missingSymbols: string[] = [];

  for (const symbol of ALL_REACTION_SYMBOLS) {
    const deadbandPct = deadbandFor(symbol, window);
    const { pct, baselineTs, windowTs } = getPct(ctx, symbol, window);
    const direction = classifyDirection(pct, deadbandPct);
    if (direction === "unavailable") missingSymbols.push(symbol);
    instruments.push({
      symbol,
      proxyLabel: PROXY_LABELS[symbol],
      changePct: pct ?? undefined,
      direction,
      deadbandPct,
      sourceBaselineTimestamp: baselineTs,
      sourceWindowTimestamp: windowTs,
    });
  }

  const equityDirs = EQUITY_SYMBOLS.map(
    (s) => instruments.find((i) => i.symbol === s)!.direction,
  );
  const equityBreadth = classifyEquityBreadth(equityDirs);
  const spyPct = instruments.find((i) => i.symbol === "SPY")?.changePct;
  const qqqPct = instruments.find((i) => i.symbol === "QQQ")?.changePct;
  const iwmPct = instruments.find((i) => i.symbol === "IWM")?.changePct;
  const equityLeadership = classifyEquityLeadership({
    spyPct,
    qqqPct,
    iwmPct,
  });

  const tlt = instruments.find((i) => i.symbol === "TLT")!.direction;
  const uup = instruments.find((i) => i.symbol === "UUP")!.direction;
  const gld = instruments.find((i) => i.symbol === "GLD")!.direction;

  return {
    window,
    instruments,
    equityBreadth,
    equityLeadership,
    crossAssetSignature: {
      equities: breadthToCrossAssetLeg(equityBreadth),
      longTreasuryEtf: tlt,
      dollarEtf: uup,
      goldEtf: gld,
    },
    coverage: {
      available: ALL_REACTION_SYMBOLS.length - missingSymbols.length,
      expected: ALL_REACTION_SYMBOLS.length,
      missingSymbols,
    },
  };
}

function instrumentState(
  window: ReactionWindowClassification,
  symbol: ReactionProxySymbol,
): { pct: number | null; direction: ReactionDirection } {
  const inst = window.instruments.find((i) => i.symbol === symbol)!;
  return {
    pct: inst.changePct ?? null,
    direction: inst.direction,
  };
}

type ReactionDirection = import("@/contracts").ReactionDirection;

function developmentBetween(
  earlier: ReactionWindowClassification,
  later: ReactionWindowClassification,
  symbol: ReactionProxySymbol,
): ReactionDevelopment {
  const a = instrumentState(earlier, symbol);
  const b = instrumentState(later, symbol);
  return classifyDevelopmentPath({
    earlierPct: a.pct,
    laterPct: b.pct,
    earlierDirection: a.direction,
    laterDirection: b.direction,
  });
}

function sessionCloseChronologyValid(ctx: EventMarketContext): boolean {
  const eventMs = Date.parse(ctx.eventTimestamp);
  if (!Number.isFinite(eventMs)) return false;
  // Event on holiday/weekend → no meaningful same-day regular close path.
  if (ctx.session.isHoliday || ctx.session.isWeekend) return false;

  const spy = ctx.symbols.find((s) => s.symbol === "SPY");
  const close = spy?.windows.find((w) => w.kind === "sessionClose");
  if (!close || close.status !== "available" || !close.barTimestamp) {
    return false;
  }
  const closeMs = Date.parse(close.barTimestamp);
  if (!Number.isFinite(closeMs)) return false;
  // Close must be after the event; do not invent next-day continuity.
  if (closeMs <= eventMs) return false;

  // Require close on the same Eastern calendar date as the event.
  if (ctx.session.easternDate) {
    // bar timestamps are UTC; session.easternDate already describes event day.
    // Reject if close is more than ~18h after event (guards overnight bleed).
    if (closeMs - eventMs > 18 * 60 * 60 * 1000) return false;
  }
  return true;
}

/**
 * Classify a single EventMarketContext into EventMarketReaction.
 */
export function classifyMarketReaction(
  ctx: EventMarketContext,
  options: {
    readonly generatedAt?: string;
    /** When omitted, derived from market-context event fields + facts:none. */
    readonly officialFactsIdentity?: string;
  } = {},
): EventMarketReaction {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const identity = marketContextIdentity(ctx);
  const factsIdentity =
    options.officialFactsIdentity ??
    officialEventFactsIdentityFromContext(ctx);
  const limitations: string[] = [];

  if (ctx.status === "unavailable") {
    limitations.push(
      "Source market context is unavailable — reaction classification insufficient.",
    );
  }
  if (ctx.status === "partial") {
    limitations.push(
      "Source market context is partial — some windows or symbols may be missing.",
    );
  }
  if (ctx.session.eventInPremarket) {
    limitations.push(
      "Event occurred in premarket — session-close window spans a longer observation period.",
    );
  }
  if (ctx.session.isHoliday || ctx.session.isWeekend) {
    limitations.push(
      "Event falls on a holiday/weekend — regular-session development paths unavailable.",
    );
  }

  const windows = REACTION_WINDOWS.map((w) => classifyWindow(ctx, w));
  const byId = new Map(windows.map((w) => [w.window, w]));
  const w5 = byId.get("5m")!;
  const w30 = byId.get("30m")!;
  const w2h = byId.get("2h")!;
  const wClose = byId.get("session_close")!;

  const bySymbol: EventMarketReaction["development"]["bySymbol"] = {};
  for (const symbol of ALL_REACTION_SYMBOLS) {
    bySymbol[symbol] = {
      shortToMedium: developmentBetween(w5, w30, symbol),
      mediumToClose: sessionCloseChronologyValid(ctx)
        ? developmentBetween(w2h, wClose, symbol)
        : "unavailable",
    };
  }

  const from5mTo30m = aggregateEquityDevelopment(
    EQUITY_SYMBOLS.map((s) => bySymbol[s]!.shortToMedium),
  );
  const from30mTo2h = aggregateEquityDevelopment(
    EQUITY_SYMBOLS.map((s) =>
      developmentBetween(w30, w2h, s),
    ),
  );
  const intoSessionClose = sessionCloseChronologyValid(ctx)
    ? aggregateEquityDevelopment(
        EQUITY_SYMBOLS.map((s) => bySymbol[s]!.mediumToClose),
      )
    : "unavailable";

  if (!sessionCloseChronologyValid(ctx)) {
    limitations.push(
      "intoSessionClose unavailable — close missing, before event, holiday, or chronology invalid.",
    );
  }

  const spy5 = instrumentState(w5, "SPY");
  const spyClose = instrumentState(wClose, "SPY");
  const observations = buildObservations({
    windows,
    from5mTo30m,
    intoSessionClose,
    spy5m: spy5.pct ?? undefined,
    spyClose: spyClose.pct ?? undefined,
    spy5mDir: spy5.direction,
    spyCloseDir: spyClose.direction,
  });

  const availableWindows = windows.filter((w) => w.coverage.available > 0);
  const fullyCovered = windows.every(
    (w) => w.coverage.missingSymbols.length === 0,
  );
  let status: EventMarketReaction["status"];
  if (availableWindows.length === 0 || ctx.status === "unavailable") {
    status = "insufficient";
  } else if (fullyCovered && ctx.status === "complete") {
    status = "complete";
  } else {
    status = "partial";
  }

  limitations.push(
    "Deadbands are deterministic display thresholds — not statistical significance.",
  );
  limitations.push(
    "Observed co-movement does not establish that the catalyst caused the moves.",
  );

  return {
    schemaVersion: "0.1.0",
    id: reactionIdFor({
      catalystId: ctx.catalystId,
      marketContextId: ctx.id,
      marketContextIdentity: identity,
      officialFactsIdentity: factsIdentity,
      reactionRulesVersion: REACTION_RULES_VERSION,
    }),
    catalystId: ctx.catalystId,
    marketContextId: ctx.id,
    marketContextIdentity: identity,
    officialFactsIdentity: factsIdentity,
    reactionRulesVersion: REACTION_RULES_VERSION,
    eventTimestamp: ctx.eventTimestamp,
    provider: ctx.provider,
    feed: ctx.feed,
    status,
    windows,
    development: {
      from5mTo30m,
      from30mTo2h,
      intoSessionClose,
      bySymbol,
    },
    observations,
    limitations,
    generatedAt,
    synthetic: ctx.synthetic,
  };
}
