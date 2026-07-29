import { z } from "zod";

export const CONTRACT_SCHEMA_VERSION = "0.2.1";

export const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

export const IsoDateTime = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/,
    "expected ISO-8601 with offset or Z",
  );

export const SemVer = z.string().regex(/^\d+\.\d+\.\d+$/, "expected semver");

/** Regimes that cross-asset prices alone can support. */
export const Regime = z.enum([
  "fed_rates",
  "inflation",
  "growth",
  "liquidity",
  "risk_sentiment",
]);

/**
 * Honest outcomes when the data cannot support a driver claim. These are not
 * regimes; UI must not render them as "the market is trading X".
 */
export const RegimeFallback = z.enum([
  "mixed_unresolved",
  "single_asset_shock",
  "insufficient_data",
]);

export const PrimaryRegime = z.union([Regime, RegimeFallback]);

export const Polarity = z.enum(["positive", "negative"]);
export const RiskDirection = z.enum(["risk_on", "risk_off", "mixed"]);
export const AssetRole = z.enum([
  "confirming",
  "contradicting",
  "neutral",
  "missing",
]);
export const Unit = z.enum(["pct", "bps"]);
export const SessionAlignment = z.enum(["aligned", "partial", "stale"]);
export const InterpretationGenerator = z.enum(["template", "llm"]);

export const FeatureFlag = z.enum([
  "volUnavailable",
  "repeatedPrints",
  "sigmaFloorApplied",
  "gapSkipped",
  "stale",
  "missing",
]);

export type Regime = z.infer<typeof Regime>;
export type RegimeFallback = z.infer<typeof RegimeFallback>;
export type PrimaryRegime = z.infer<typeof PrimaryRegime>;
export type Unit = z.infer<typeof Unit>;
export type FeatureFlag = z.infer<typeof FeatureFlag>;

// --- Asset registry -------------------------------------------------------
//
// `symbol` is the canonical macro concept. `instrument` is what was actually
// measured. Keeping them separate is what lets the UI say "Gold (via GLD)"
// instead of passing an ETF off as the underlying.

export const MacroSymbol = z.enum([
  "US2Y",
  "US10Y",
  "GOLD",
  "COPPER",
  "OIL",
  "USD",
  "VIX",
  "BTC",
]);
export type MacroSymbol = z.infer<typeof MacroSymbol>;

/**
 * Correlation blocks cap how much independent confirmation a group of
 * redundant inputs can contribute. Only genuinely substitutable inputs share
 * a block: 2Y/10Y move together, and copper/oil share the growth impulse.
 * Gold carries haven and real-rate information that neither of those does, so
 * it stands alone rather than being averaged into a commodity bucket.
 */
export const CorrelationBlock = z.enum([
  "rates",
  "growth_commodities",
  "haven",
  "usd",
  "volatility",
  "crypto",
]);
export type CorrelationBlock = z.infer<typeof CorrelationBlock>;

export interface AssetDefinition {
  readonly symbol: MacroSymbol;
  readonly label: string;
  readonly unit: Unit;
  readonly block: CorrelationBlock;
  /** M1 instrument actually measured. */
  readonly instrument: string;
  readonly isProxy: boolean;
  /** Core assets gate `isCompleteSession` and the insufficient-data rule. */
  readonly core: boolean;
}

export const ASSET_REGISTRY: Readonly<Record<MacroSymbol, AssetDefinition>> = {
  US2Y: {
    symbol: "US2Y",
    label: "US 2Y",
    unit: "bps",
    block: "rates",
    instrument: "UST 2Y par yield",
    isProxy: false,
    core: true,
  },
  US10Y: {
    symbol: "US10Y",
    label: "US 10Y",
    unit: "bps",
    block: "rates",
    instrument: "UST 10Y par yield",
    isProxy: false,
    core: true,
  },
  GOLD: {
    symbol: "GOLD",
    label: "Gold",
    unit: "pct",
    block: "haven",
    instrument: "GLD",
    isProxy: true,
    core: true,
  },
  COPPER: {
    symbol: "COPPER",
    label: "Copper",
    unit: "pct",
    block: "growth_commodities",
    instrument: "CPER",
    isProxy: true,
    core: true,
  },
  OIL: {
    symbol: "OIL",
    label: "Oil",
    unit: "pct",
    block: "growth_commodities",
    instrument: "USO",
    isProxy: true,
    core: true,
  },
  USD: {
    symbol: "USD",
    label: "USD",
    unit: "pct",
    block: "usd",
    instrument: "UUP",
    isProxy: true,
    core: true,
  },
  VIX: {
    symbol: "VIX",
    label: "VIX",
    unit: "pct",
    block: "volatility",
    instrument: "VIX index",
    isProxy: false,
    core: true,
  },
  BTC: {
    symbol: "BTC",
    label: "BTC",
    unit: "pct",
    block: "crypto",
    instrument: "btcusd",
    isProxy: false,
    core: true,
  },
};

export const ALL_SYMBOLS = Object.keys(ASSET_REGISTRY) as MacroSymbol[];
export const CORE_SYMBOLS = ALL_SYMBOLS.filter((s) => ASSET_REGISTRY[s].core);
export const CORE_RATE_SYMBOLS: MacroSymbol[] = ["US2Y", "US10Y"];

export function expectedUnit(symbol: MacroSymbol): Unit {
  return ASSET_REGISTRY[symbol].unit;
}

export function blockOf(symbol: MacroSymbol): CorrelationBlock {
  return ASSET_REGISTRY[symbol].block;
}

// --- Timing and provenance ------------------------------------------------

/**
 * Separating the session described from the moment of computation is not
 * cosmetic: upstream sources publish on different lags, so one timestamp
 * cannot state which session the numbers belong to.
 */
export const Timing = z.object({
  marketSessionDate: IsoDate,
  generatedAt: IsoDateTime,
  sessionAlignment: SessionAlignment,
  isCompleteSession: z.boolean(),
  // Partial: an asset that was never retrieved has no source date to report,
  // and inventing one would be indistinguishable from a forward fill.
  sourceDateByAsset: z.partialRecord(MacroSymbol, IsoDate),
  staleDaysByAsset: z.partialRecord(MacroSymbol, z.number().int().min(0)),
});
export type Timing = z.infer<typeof Timing>;

export const APPROX_EPSILON = 1e-9;

export function sumsToOne(values: number[]): boolean {
  const total = values.reduce((acc, v) => acc + v, 0);
  return Math.abs(total - 1) <= APPROX_EPSILON;
}
