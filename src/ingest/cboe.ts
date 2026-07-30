import { sessionDateFromUs } from "./dates";
import { fetchValidated, type FetchLike } from "./http";
import { IngestError, type RawBar, type SymbolSeries } from "./types";

export const CBOE_VIX_URL =
  "https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv";

/** Pure parser for the CBOE VIX history CSV (ascending DATE,OPEN,HIGH,LOW,CLOSE). */
export function parseVixCsv(body: string): RawBar[] {
  const lines = body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) {
    throw new IngestError("payload_shape", "CBOE VIX CSV is empty");
  }

  const header = lines[0]!.toUpperCase();
  if (!header.includes("DATE") || !header.includes("CLOSE")) {
    throw new IngestError(
      "header_signature",
      `CBOE VIX header missing DATE/CLOSE; got ${JSON.stringify(lines[0])}`,
    );
  }

  const bars: RawBar[] = [];
  for (const line of lines.slice(1)) {
    const [rawDate, , , , closeRaw] = line.split(",").map((c) => c.trim());
    if (!rawDate || closeRaw === undefined || closeRaw === "") continue;
    const close = Number(closeRaw);
    if (!Number.isFinite(close) || close <= 0) continue;
    bars.push({
      sessionDate: sessionDateFromUs(rawDate),
      value: close,
      source: "cboe/VIX_History",
      rawDate,
    });
  }
  return bars;
}

export async function fetchVix(
  startDate: string,
  endDate: string,
  options: { readonly fetchImpl?: FetchLike } = {},
): Promise<SymbolSeries> {
  const validated = await fetchValidated(
    CBOE_VIX_URL,
    {
      label: "CBOE VIX",
      contentTypeIncludes: "text/csv",
      headerIncludes: "DATE",
      minRows: 20,
    },
    { fetchImpl: options.fetchImpl },
  );

  const bars = parseVixCsv(validated.body).filter(
    (b) => b.sessionDate >= startDate && b.sessionDate <= endDate,
  );

  if (bars.length < 20) {
    throw new IngestError(
      "row_count",
      `CBOE VIX produced only ${bars.length} rows in ${startDate}..${endDate}`,
    );
  }

  return {
    symbol: "VIX",
    instrument: "VIX index",
    isProxy: false,
    source: "cboe/VIX_History",
    bars,
  };
}
