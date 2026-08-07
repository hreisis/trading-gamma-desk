/**
 * V2-3B read-only capability audit — connected providers only.
 * No breadth/leadership metrics are computed until constituent universes
 * and per-symbol panels are available from an approved source.
 */

export const BREADTH_LEADERSHIP_CAPABILITY_AUDIT_VERSION = "0.1.0" as const;

export type ProviderCapabilityStatus =
  | "not_available"
  | "symbol_only"
  | "partial_panel";

export interface ProviderCapabilityRow {
  readonly provider: string;
  readonly endpoint: string;
  readonly feed: string | null;
  readonly coverage: string;
  readonly timestampFields: readonly string[];
  readonly subscriptionLimits: string;
  readonly status: ProviderCapabilityStatus;
}

export interface UniverseRequirement {
  readonly id: string;
  readonly label: string;
  readonly requiredFor: "breadth" | "leadership" | "both";
  readonly providerStatus: "not_available";
  readonly reason: string;
}

export const CONNECTED_PROVIDER_CAPABILITIES: readonly ProviderCapabilityRow[] = [
  {
    provider: "alpaca",
    endpoint: "GET /v2/stocks/snapshots",
    feed: "sip (default) or iex via CATALYST_MARKET_FEED",
    coverage:
      "Only symbols in DEFAULT_ALPACA_WATCHLIST + ALPACA_WATCHLIST env (SPY, QQQ, BTC/USD, optional extras). No index membership or screener.",
    timestampFields: ["latestTrade.t", "minuteBar.t", "dailyBar.t", "fetchedAt"],
    subscriptionLimits:
      "SIP requires paid entitlement; free/paper often limited to IEX. HTTP 403 when feed not entitled. Rate limit HTTP 429.",
    status: "symbol_only",
  },
  {
    provider: "alpaca",
    endpoint: "GET /v2/stocks/{symbol}/bars",
    feed: "sip (default) or iex via CATALYST_MARKET_FEED",
    coverage:
      "Per-symbol historical bars (catalyst uses 1Min). Caller must supply each ticker; no bulk universe fetch.",
    timestampFields: ["bar.t"],
    subscriptionLimits:
      "Paginated (limit 10000). MARKET_CONTEXT_MAX_PER_RUN=12 symbols per catalyst run.",
    status: "symbol_only",
  },
  {
    provider: "tiingo",
    endpoint: "GET /tiingo/daily/{ticker}/prices",
    feed: "n/a (REST token)",
    coverage:
      "Single-ticker EOD only. Repo uses SPY + ETF proxies (GLD, CPER, USO, UUP) and BTC — not constituent panels.",
    timestampFields: ["date", "writtenAt on local cache"],
    subscriptionLimits: "Per-ticker requests; free tier daily limits apply.",
    status: "symbol_only",
  },
  {
    provider: "marketdata_app",
    endpoint: "GET /v1/options/chain/{symbol}/",
    feed: "live/delayed per plan",
    coverage: "Options chain for bounded gamma only — no equity breadth.",
    timestampFields: ["updated", "vendorAsOf"],
    subscriptionLimits: "Credits per contract returned; not usable for stock panels.",
    status: "not_available",
  },
] as const;

export const UNIVERSE_REQUIREMENTS: readonly UniverseRequirement[] = [
  {
    id: "spy_constituents",
    label: "S&P 500 / SPY underlying constituents",
    requiredFor: "breadth",
    providerStatus: "not_available",
    reason:
      "No connected provider exposes S&P 500 membership. Alpaca has no ETF holdings endpoint; Tiingo has no index constituents API.",
  },
  {
    id: "ndx_constituents",
    label: "Nasdaq-100 constituents",
    requiredFor: "breadth",
    providerStatus: "not_available",
    reason:
      "No connected provider exposes Nasdaq-100 membership. QQQ quote is a single ETF snapshot only.",
  },
  {
    id: "high_beta_universe",
    label: "High-beta stock universe",
    requiredFor: "both",
    providerStatus: "not_available",
    reason:
      "No versioned high-beta universe or factor screen exists in the repo; no screener endpoint on connected APIs.",
  },
  {
    id: "semiconductor_universe",
    label: "Semiconductor stock universe",
    requiredFor: "breadth",
    providerStatus: "not_available",
    reason:
      "No SOX/SMH constituent list or sector-classified panel on connected APIs.",
  },
  {
    id: "constituent_daily_panels",
    label: "Per-constituent daily or snapshot panels",
    requiredFor: "both",
    providerStatus: "not_available",
    reason:
      "Alpaca snapshots/bars and Tiingo EOD require an explicit symbol list per request; without universe source, MA20/MA50 and new-high/low windows cannot be computed.",
  },
] as const;

export const BREADTH_INTERNALS_MISSING_REASON =
  "V2-3B blocked: no connected provider supplies SPY or Nasdaq-100 constituent universes with per-stock daily panels. ETF ratio proxies (RSP/SPY, QQQ/SPY) are disallowed for breadth.";

export const LEADERSHIP_ROTATION_MISSING_REASON =
  "V2-3B blocked: no connected provider supplies a versioned leadership universe or cross-sectional relative-strength panel. ETF pairs (SPHB/SPLV, SMH/QQQ) may only be relative-leadership proxies, not implemented here.";

/** Minimal path to unblock V2-3B without violating the no-ETF-proxy-breadth rule. */
export const BREADTH_LEADERSHIP_MINIMAL_UNBLOCK = [
  "Add a versioned universe artifact source (constituent lists with asOf + provider provenance) — requires a new approved vendor or licensed index file ingest, outside current APIs.",
  "Bulk per-symbol EOD or snapshot fetch for each universe (Alpaca bars or Tiingo daily) with explicit coverage thresholds and per-symbol failure isolation.",
  "Deterministic breadth engine: advancing/declining/unchanged, % above MA20/MA50 when history ≥ window, new highs/lows when window sufficient, breadth state improving/stable/deteriorating.",
  "Separate leadership engine on its own universe — never fold into breadth aggregates.",
] as const;

export function breadthLeadershipCapabilityBlocked(): boolean {
  return UNIVERSE_REQUIREMENTS.every((row) => row.providerStatus === "not_available");
}
