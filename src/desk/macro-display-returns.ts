import {
  ASSET_REGISTRY,
  type DominantDriver,
  type Evidence,
  type MacroSymbol,
} from "@/contracts";
import type { AlpacaMarketQuote } from "@/contracts/alpaca-market";
import {
  assetDisplayName,
  formatChange,
  formatZ,
} from "@/interpret/format";
import { remainingRegularSessionFraction } from "./format-gamma";

/** ETF proxies aligned with macro driver instruments (Tiingo ingest mapping). */
export const MACRO_ALPACA_PROXY_SYMBOLS = [
  "GLD",
  "CPER",
  "USO",
  "UUP",
] as const;

const MACRO_ALPACA_PROXY_SET = new Set<string>(MACRO_ALPACA_PROXY_SYMBOLS);

export function isMacroAlpacaProxySymbol(symbol: string): boolean {
  return MACRO_ALPACA_PROXY_SET.has(symbol.toUpperCase());
}

export function mergeMacroAlpacaWatchlist(
  base: readonly string[],
): string[] {
  return [...new Set([...base, ...MACRO_ALPACA_PROXY_SYMBOLS])];
}

export function isMacroIntradaySession(now: Date): boolean {
  const remaining = remainingRegularSessionFraction(now);
  return remaining !== null && remaining > 0;
}

function completedSessionBasisLabel(sourceDate: string): string {
  return `${sourceDate} session close-to-close`;
}

function liveSincePriorCloseLabel(): string {
  return "since prior close (live)";
}

function quoteForInstrument(
  quotes: readonly AlpacaMarketQuote[],
  instrument: string,
): AlpacaMarketQuote | undefined {
  const target = instrument.toUpperCase();
  return quotes.find((q) => q.symbol.toUpperCase() === target);
}

function againstSuffix(statement: string): string {
  const againstIdx = statement.indexOf(", against the");
  if (againstIdx < 0) return "";
  return statement.slice(againstIdx);
}

function formatCompletedStatement(
  symbol: MacroSymbol,
  change: number,
  unit: Evidence["unit"],
  zScore: number | null,
  sourceDate: string,
  against = "",
): string {
  const zPart = zScore !== null ? ` (${formatZ(zScore)})` : "";
  return `${assetDisplayName(symbol)} ${formatChange(change, unit)}${zPart} · ${completedSessionBasisLabel(sourceDate)}${against}`;
}

/**
 * Display-only evidence rows: intraday ETF proxies use Alpaca since prior close;
 * completed-session Tiingo/CBOE rows keep driver z-scores with explicit session basis.
 */
export function patchMacroEvidenceForDisplay(
  driver: DominantDriver,
  options: {
    readonly marketQuotes?: readonly AlpacaMarketQuote[];
    readonly now?: Date;
  } = {},
): Evidence[] {
  const now = options.now ?? new Date();
  const intraday = isMacroIntradaySession(now);
  const quotes = options.marketQuotes ?? [];

  return driver.evidence.map((row) => {
    const def = ASSET_REGISTRY[row.symbol];
    const sourceDate = row.sourceDate ?? driver.marketSessionDate;
    const against = againstSuffix(row.statement);

    if (
      intraday &&
      def.isProxy &&
      isMacroAlpacaProxySymbol(def.instrument)
    ) {
      const quote = quoteForInstrument(quotes, def.instrument);
      if (
        quote?.status === "available" &&
        quote.dailyChangePct !== null &&
        Number.isFinite(quote.dailyChangePct)
      ) {
        return {
          ...row,
          statement: `${assetDisplayName(row.symbol)} ${formatChange(
            quote.dailyChangePct,
            row.unit,
          )} · ${liveSincePriorCloseLabel()}`,
          value: quote.dailyChangePct,
          zScore: null,
          sourceDate: driver.marketSessionDate,
        };
      }
    }

    if (row.value === null) return row;

    if (row.statement.includes("session close-to-close")) {
      return row;
    }

    return {
      ...row,
      statement: formatCompletedStatement(
        row.symbol,
        row.value,
        row.unit,
        row.zScore,
        sourceDate,
        against,
      ),
    };
  });
}

/**
 * Rebuild macro interpretation for the command center using patched evidence
 * statements (string replace preserves template risk/confidence tail).
 */
export function buildMacroDisplayInterpretation(
  driver: DominantDriver,
  patchedEvidence: readonly Evidence[],
  now: Date,
): string {
  const intraday = isMacroIntradaySession(now);
  const sessionNote =
    intraday
      ? `Macro classification uses ${driver.marketSessionDate} completed-session inputs; ETF proxy lines marked live are since prior close. `
      : driver.marketSessionDate
        ? `Macro inputs as of ${driver.marketSessionDate} session close. `
        : "";

  let text = driver.interpretation.text.trim();
  for (const original of driver.evidence) {
    const patched = patchedEvidence.find((row) => row.id === original.id);
    if (patched && patched.statement !== original.statement) {
      text = text.replace(original.statement, patched.statement);
    }
  }

  return `${sessionNote}${text}`.trim();
}
