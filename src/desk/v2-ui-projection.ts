import type { DailyBar } from "./breadth/bars/types";

export const TECHNOLOGY_INTERNAL_ETFS = [
  ["SMH", "Semiconductors"],
  ["IGV", "Software"],
  ["CLOU", "Cloud"],
  ["HACK", "Cybersecurity"],
  ["AIQ", "AI Infrastructure"],
] as const;

export const MAG7_SYMBOLS = ["AAPL", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "TSLA"] as const;

export const TECH_LEADER_UNIVERSE = [
  "NVDA",
  "AMD",
  "AVGO",
  "MSFT",
  "AAPL",
  "META",
  "AMZN",
  "GOOGL",
  "MU",
  "MRVL",
  "CRM",
  "ORCL",
  "INTC",
  "TSLA",
] as const;

export interface V2TechnologyInternalRow {
  readonly symbol: string;
  readonly label: string;
  readonly rs5dVsXlk: number;
}

export interface V2TechnologyInternalSummary {
  readonly status: "available" | "partial" | "unavailable";
  readonly rows: readonly V2TechnologyInternalRow[];
  readonly benchmark: "XLK";
  readonly sessionDate: string | null;
  readonly missingReason: string | null;
}

export interface V2TechLeaderRow {
  readonly symbol: string;
  readonly return1dPct: number;
  readonly sessionDate: string;
}

export interface V2TechLeadersLaggardsSummary {
  readonly status: "available" | "partial" | "unavailable";
  readonly leaders: readonly V2TechLeaderRow[];
  readonly laggards: readonly V2TechLeaderRow[];
  readonly sessionDate: string | null;
  readonly missingReason: string | null;
}

type AlignedReturn = { value: number; sessionDate: string };

export function technologyUiBarSymbols(): readonly string[] {
  return [
    "XLK",
    ...TECHNOLOGY_INTERNAL_ETFS.map(([symbol]) => symbol),
    ...MAG7_SYMBOLS,
    ...TECH_LEADER_UNIVERSE,
  ];
}

function alignedReturnPct(
  bars: readonly DailyBar[] | undefined,
  lookbackSessions: number,
): AlignedReturn | null {
  if (!bars || bars.length < lookbackSessions + 1) return null;
  const recent = bars.slice(-(lookbackSessions + 1));
  const start = recent[0]?.close;
  const end = recent.at(-1)?.close;
  const sessionDate = recent.at(-1)?.sessionDate;
  if (
    start == null ||
    end == null ||
    !sessionDate ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start <= 0
  ) {
    return null;
  }
  return { value: ((end / start) - 1) * 100, sessionDate };
}

export function buildTechnologyInternalSummary(
  barsBySymbol: ReadonlyMap<string, readonly DailyBar[]>,
): V2TechnologyInternalSummary {
  const xlk = alignedReturnPct(barsBySymbol.get("XLK"), 5);
  if (!xlk) {
    return {
      status: "unavailable",
      rows: [],
      benchmark: "XLK",
      sessionDate: null,
      missingReason: "XLK history unavailable for technology-internal comparison.",
    };
  }

  const rows: V2TechnologyInternalRow[] = [];
  const mag7 = MAG7_SYMBOLS.flatMap((symbol) => {
    const result = alignedReturnPct(barsBySymbol.get(symbol), 5);
    return result !== null && result.sessionDate === xlk.sessionDate
      ? [{ symbol, result }]
      : [];
  });

  if (mag7.length >= 5) {
    const average =
      mag7.reduce((sum, item) => sum + item.result.value, 0) / mag7.length;
    rows.push({
      symbol: "MAG7",
      label: "MAG7 Basket",
      rs5dVsXlk: average - xlk.value,
    });
  }

  for (const [symbol, label] of TECHNOLOGY_INTERNAL_ETFS) {
    const result = alignedReturnPct(barsBySymbol.get(symbol), 5);
    if (result === null || result.sessionDate !== xlk.sessionDate) continue;
    rows.push({ symbol, label, rs5dVsXlk: result.value - xlk.value });
  }

  if (rows.length === 0) {
    return {
      status: "unavailable",
      rows: [],
      benchmark: "XLK",
      sessionDate: xlk.sessionDate,
      missingReason: "Technology ETF history unavailable for the XLK-aligned session.",
    };
  }

  return {
    status: rows.length >= 5 ? "available" : "partial",
    rows,
    benchmark: "XLK",
    sessionDate: xlk.sessionDate,
    missingReason: rows.length >= 5 ? null : "Technology-internal coverage is partial.",
  };
}

export function buildTechLeadersLaggardsSummary(
  barsBySymbol: ReadonlyMap<string, readonly DailyBar[]>,
): V2TechLeadersLaggardsSummary {
  const candidates = TECH_LEADER_UNIVERSE.flatMap((symbol) => {
    const result = alignedReturnPct(barsBySymbol.get(symbol), 1);
    return result === null ? [] : [{ symbol, result }];
  });

  if (candidates.length === 0) {
    return {
      status: "unavailable",
      leaders: [],
      laggards: [],
      sessionDate: null,
      missingReason: "Technology leader/laggard bars unavailable.",
    };
  }

  const sessionDate = candidates
    .map((item) => item.result.sessionDate)
    .sort()
    .at(-1)!;
  const aligned = candidates
    .filter((item) => item.result.sessionDate === sessionDate)
    .map((item) => ({
      symbol: item.symbol,
      return1dPct: item.result.value,
      sessionDate,
    }))
    .sort((left, right) => right.return1dPct - left.return1dPct);

  if (aligned.length === 0) {
    return {
      status: "unavailable",
      leaders: [],
      laggards: [],
      sessionDate,
      missingReason: "No technology symbols align to the latest session.",
    };
  }

  const leaders = aligned.filter((row) => row.return1dPct > 0).slice(0, 5);
  const laggards = [...aligned]
    .filter((row) => row.return1dPct < 0)
    .sort((left, right) => left.return1dPct - right.return1dPct)
    .slice(0, 5);

  return {
    status: aligned.length >= 8 ? "available" : "partial",
    leaders,
    laggards,
    sessionDate,
    missingReason: aligned.length >= 8 ? null : "Technology leader/laggard coverage is partial.",
  };
}
