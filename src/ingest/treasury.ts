import type { MacroSymbol } from "@/contracts";
import { sessionDateFromUs } from "./dates";
import { fetchValidated, type FetchLike } from "./http";
import { IngestError, type RawBar, type SymbolSeries } from "./types";

/**
 * FiscalData daily par yield curve. One request per calendar year; a window
 * that crosses 1 January needs two pulls and a merge (verified M1-1).
 */
export function treasuryYearUrl(year: number): string {
  return (
    "https://home.treasury.gov/resource-center/data-chart-center/" +
    `interest-rates/daily-treasury-rates.csv/${year}/all` +
    `?type=daily_treasury_yield_curve&field_tdr_date_value=${year}&_format=csv`
  );
}

const HEADER_2Y = "2 Yr";
const HEADER_10Y = "10 Yr";

interface YieldRow {
  sessionDate: string;
  us2y: number;
  us10y: number;
  rawDate: string;
}

function parseCsvLine(line: string): string[] {
  // Treasury's file is simple CSV without embedded commas in the yield fields.
  return line.split(",").map((cell) => cell.trim().replace(/^"|"$/g, ""));
}

/** Pure parser — used by tests against recorded fixtures. */
export function parseTreasuryCsv(body: string): YieldRow[] {
  const lines = body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) {
    throw new IngestError("payload_shape", "Treasury CSV is empty");
  }

  const header = parseCsvLine(lines[0]!);
  const iDate = header.indexOf("Date");
  const i2 = header.indexOf(HEADER_2Y);
  const i10 = header.indexOf(HEADER_10Y);
  if (iDate < 0 || i2 < 0 || i10 < 0) {
    throw new IngestError(
      "header_signature",
      `Treasury CSV missing Date / 2 Yr / 10 Yr; got ${header.join("|")}`,
    );
  }

  const rows: YieldRow[] = [];
  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line);
    const rawDate = cells[iDate] ?? "";
    const us2yRaw = cells[i2] ?? "";
    const us10yRaw = cells[i10] ?? "";
    if (!rawDate || us2yRaw === "" || us10yRaw === "") {
      // Sparse file: skip blank yield cells rather than forward-filling.
      continue;
    }
    const us2y = Number(us2yRaw);
    const us10y = Number(us10yRaw);
    if (!Number.isFinite(us2y) || !Number.isFinite(us10y)) continue;
    rows.push({
      sessionDate: sessionDateFromUs(rawDate),
      us2y,
      us10y,
      rawDate,
    });
  }
  return rows;
}

/** Merge year files; later years win on duplicate dates. Sorted ascending. */
export function mergeTreasuryYears(
  yearBodies: readonly { year: number; body: string }[],
): YieldRow[] {
  const byDate = new Map<string, YieldRow>();
  const ordered = [...yearBodies].sort((a, b) => a.year - b.year);
  for (const { body } of ordered) {
    for (const row of parseTreasuryCsv(body)) {
      byDate.set(row.sessionDate, row);
    }
  }
  return [...byDate.values()].sort((a, b) =>
    a.sessionDate < b.sessionDate ? -1 : 1,
  );
}

function yearsForRange(startDate: string, endDate: string): number[] {
  const startYear = Number(startDate.slice(0, 4));
  const endYear = Number(endDate.slice(0, 4));
  const years: number[] = [];
  for (let y = startYear; y <= endYear; y += 1) years.push(y);
  return years;
}

export async function fetchTreasuryYields(
  startDate: string,
  endDate: string,
  options: { readonly fetchImpl?: FetchLike } = {},
): Promise<{ us2y: SymbolSeries; us10y: SymbolSeries }> {
  const years = yearsForRange(startDate, endDate);
  const yearBodies: { year: number; body: string }[] = [];

  for (const year of years) {
    const validated = await fetchValidated(
      treasuryYearUrl(year),
      {
        label: `Treasury ${year}`,
        contentTypeIncludes: "text/csv",
        headerIncludes: HEADER_2Y,
        minRows: 1,
      },
      { fetchImpl: options.fetchImpl },
    );
    yearBodies.push({ year, body: validated.body });
  }

  const merged = mergeTreasuryYears(yearBodies).filter(
    (r) => r.sessionDate >= startDate && r.sessionDate <= endDate,
  );

  if (merged.length < 20) {
    throw new IngestError(
      "row_count",
      `Treasury merge produced only ${merged.length} rows in ${startDate}..${endDate}`,
    );
  }

  const toSeries = (
    symbol: MacroSymbol,
    pick: (r: YieldRow) => number,
  ): SymbolSeries => ({
    symbol,
    instrument:
      symbol === "US2Y" ? "UST 2Y par yield" : "UST 10Y par yield",
    isProxy: false,
    source: "treasury.gov/daily_treasury_yield_curve",
    bars: merged.map(
      (r): RawBar => ({
        sessionDate: r.sessionDate,
        value: pick(r),
        source: "treasury.gov/daily_treasury_yield_curve",
        rawDate: r.rawDate,
      }),
    ),
  });

  return {
    us2y: toSeries("US2Y", (r) => r.us2y),
    us10y: toSeries("US10Y", (r) => r.us10y),
  };
}
