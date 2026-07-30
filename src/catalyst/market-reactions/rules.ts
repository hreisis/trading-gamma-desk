import type { ReactionProxySymbol, ReactionWindowId } from "@/contracts";

/**
 * Versioned deadbands / thresholds for M2-4B.
 *
 * These are deterministic *display* deadbands for classifying observed ETF
 * proxy moves — not statistical significance, volatility forecasts, or trade
 * signals. Values are conservative and uncalibrated.
 */

export type ProxyClass = "equity" | "treasury" | "dollar" | "gold";

export const PROXY_CLASS_BY_SYMBOL: Record<ReactionProxySymbol, ProxyClass> = {
  SPY: "equity",
  QQQ: "equity",
  IWM: "equity",
  TLT: "treasury",
  UUP: "dollar",
  GLD: "gold",
};

/** Deadband (%) by proxy class × window. */
export const DEADBAND_PCT: Record<
  ProxyClass,
  Record<ReactionWindowId, number>
> = {
  equity: {
    "5m": 0.05,
    "30m": 0.08,
    "2h": 0.1,
    session_close: 0.12,
  },
  treasury: {
    "5m": 0.08,
    "30m": 0.1,
    "2h": 0.12,
    session_close: 0.15,
  },
  dollar: {
    "5m": 0.03,
    "30m": 0.05,
    "2h": 0.06,
    session_close: 0.08,
  },
  gold: {
    "5m": 0.05,
    "30m": 0.08,
    "2h": 0.1,
    session_close: 0.12,
  },
};

/** QQQ−SPY / IWM−SPY leadership spread threshold (percentage points). */
export const LEADERSHIP_THRESHOLD_PCT = 0.1;

/**
 * Development path thresholds (percentage points of cumulative % change).
 * extended: |later| ≥ |earlier| + extendDelta
 * faded: same direction and |later| ≤ |earlier| − fadeDelta
 * held: same direction and | |later| − |earlier| | ≤ holdBand
 */
export const DEVELOPMENT_EXTEND_DELTA_PCT = 0.05;
export const DEVELOPMENT_FADE_DELTA_PCT = 0.05;
export const DEVELOPMENT_HOLD_BAND_PCT = 0.04;

export const EQUITY_SYMBOLS: readonly ReactionProxySymbol[] = [
  "SPY",
  "QQQ",
  "IWM",
];

export const ALL_REACTION_SYMBOLS: readonly ReactionProxySymbol[] = [
  "SPY",
  "QQQ",
  "IWM",
  "TLT",
  "UUP",
  "GLD",
];

export const REACTION_WINDOWS: readonly ReactionWindowId[] = [
  "5m",
  "30m",
  "2h",
  "session_close",
];

export function deadbandFor(
  symbol: ReactionProxySymbol,
  window: ReactionWindowId,
): number {
  return DEADBAND_PCT[PROXY_CLASS_BY_SYMBOL[symbol]][window];
}

export const PROXY_LABELS: Record<ReactionProxySymbol, string> = {
  SPY: "SPY ETF (US equities proxy)",
  QQQ: "QQQ ETF (Nasdaq-100 / growth proxy)",
  IWM: "IWM ETF (small-cap proxy)",
  TLT: "TLT ETF (long-duration Treasuries proxy)",
  UUP: "UUP ETF (US dollar proxy)",
  GLD: "GLD ETF (gold proxy)",
};
