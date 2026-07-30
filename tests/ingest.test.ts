import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ALL_SYMBOLS,
  RegimeSignatureConfig,
  type MacroSymbol,
} from "@/contracts";
import { defaultSessionCalendar } from "@/macro";
import {
  assertValidResponse,
  assembleSnapshot,
  chooseMarketSession,
  mergeTreasuryYears,
  parseTiingoBtcRows,
  parseTiingoEtfRows,
  parseTreasuryCsv,
  parseVixCsv,
  sessionDateFromIsoPrefix,
  sessionDistance,
  writeBars,
  writeSnapshot,
  type SymbolSeries,
} from "@/ingest";

const config = RegimeSignatureConfig.parse(
  JSON.parse(
    readFileSync(
      new URL(
        "../fixtures/macro/regime-signature.sig-2026-07-01.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ),
);

function fixture(name: string): string {
  return readFileSync(
    new URL(`../fixtures/macro/ingest/${name}`, import.meta.url),
    "utf8",
  );
}

/** Build 24 equity sessions ending at `end`, with a mild random walk. */
function syntheticSeries(
  symbol: MacroSymbol,
  end: string,
  startLevel: number,
): SymbolSeries {
  const sessions: string[] = [end];
  let cursor = end;
  while (sessions.length < 24) {
    const previous = defaultSessionCalendar.previousSession(cursor);
    if (previous === null) break;
    sessions.unshift(previous);
    cursor = previous;
  }

  let level = startLevel;
  const bars = sessions.map((sessionDate, i) => {
    if (i > 0) level *= 1 + ((i % 2 === 0 ? 0.4 : -0.3) + (symbol === "US2Y" ? -0.02 : 0)) / 100;
    // Yields stay in percent levels around startLevel.
    if (symbol === "US2Y" || symbol === "US10Y") {
      level = startLevel + (i % 5) * 0.01 - 0.02;
    }
    return {
      sessionDate,
      value: level,
      source: "fixture",
      rawDate: sessionDate,
    };
  });

  return {
    symbol,
    instrument: symbol,
    isProxy: false,
    source: "fixture",
    bars,
  };
}

describe("date slicing never goes through a local Date", () => {
  it("takes the UTC calendar day from either Tiingo serialisation", () => {
    expect(sessionDateFromIsoPrefix("2026-07-29T00:00:00.000Z")).toBe(
      "2026-07-29",
    );
    expect(sessionDateFromIsoPrefix("2026-07-29T00:00:00+00:00")).toBe(
      "2026-07-29",
    );
  });

  it("would otherwise shift a day in America/Los_Angeles", () => {
    const shifted = new Date("2026-07-29T00:00:00.000Z").toLocaleDateString(
      "en-CA",
      { timeZone: "America/Los_Angeles" },
    );
    expect(shifted).toBe("2026-07-28");
    expect(sessionDateFromIsoPrefix("2026-07-29T00:00:00.000Z")).not.toBe(
      shifted,
    );
  });
});

describe("response validation (Stooq lesson)", () => {
  it("rejects an HTML body that arrived under HTTP 200", () => {
    expect(() =>
      assertValidResponse(
        {
          status: 200,
          contentType: "text/html; charset=utf-8",
          body: "<html><script>challenge()</script></html>",
        },
        { label: "Stooq", contentTypeIncludes: "text/csv", headerIncludes: "Date" },
      ),
    ).toThrow(/content-type/);
  });

  it("rejects a CSV whose header signature does not match", () => {
    expect(() =>
      assertValidResponse(
        {
          status: 200,
          contentType: "text/csv",
          body: "foo,bar\n1,2\n",
        },
        {
          label: "Treasury",
          contentTypeIncludes: "text/csv",
          headerIncludes: "2 Yr",
        },
      ),
    ).toThrow(/first line missing/);
  });
});

describe("Treasury year-boundary merge", () => {
  it("parses 2 Yr / 10 Yr and keeps the file sparse", () => {
    const rows = parseTreasuryCsv(fixture("treasury-2026-sample.csv"));
    expect(rows.map((r) => r.sessionDate)).toEqual([
      "2026-01-05",
      "2026-01-02",
    ]);
    expect(rows[0]!.us2y).toBeCloseTo(4.0, 5);
  });

  it("merges two years without forward-fill and sorts ascending", () => {
    const merged = mergeTreasuryYears([
      { year: 2025, body: fixture("treasury-2025-sample.csv") },
      { year: 2026, body: fixture("treasury-2026-sample.csv") },
    ]);
    expect(merged.map((r) => r.sessionDate)).toEqual([
      "2025-12-30",
      "2025-12-31",
      "2026-01-02",
      "2026-01-05",
    ]);
    // 2026-01-01 is a holiday and never appears — the upstream file is sparse.
    expect(merged.some((r) => r.sessionDate === "2026-01-01")).toBe(false);
  });
});

describe("CBOE VIX parser", () => {
  it("reads CLOSE and converts US dates", () => {
    const bars = parseVixCsv(fixture("vix-sample.csv"));
    expect(bars.map((b) => b.sessionDate)).toEqual([
      "2026-01-02",
      "2026-01-05",
      "2026-01-06",
    ]);
    expect(bars[0]!.value).toBeCloseTo(15.2, 5);
  });
});

describe("Tiingo parsers", () => {
  it("prefers adjClose over close", () => {
    const rows = JSON.parse(fixture("tiingo-gld-sample.json")) as Record<
      string,
      unknown
    >[];
    const bars = parseTiingoEtfRows(rows, "tiingo/daily/gld");
    expect(bars.at(-1)!.sessionDate).toBe("2026-07-29");
    expect(bars.at(-1)!.value).toBeCloseTo(181.5, 5);
    expect(bars.at(-1)!.value).not.toBeCloseTo(181.0, 5);
  });

  it("snaps BTC onto equity sessions and drops the in-progress UTC day", () => {
    const envelope = JSON.parse(fixture("tiingo-btc-sample.json"));
    const bars = parseTiingoBtcRows(envelope, { todayUtc: "2026-07-30" });

    expect(bars.map((b) => b.sessionDate)).toEqual([
      "2026-07-24",
      "2026-07-27",
      "2026-07-28",
      "2026-07-29",
    ]);
    // Weekend bars (25–26) and the in-progress 30th are gone.
    expect(bars.some((b) => b.sessionDate === "2026-07-25")).toBe(false);
    expect(bars.some((b) => b.sessionDate === "2026-07-30")).toBe(false);
  });
});

describe("assembleSnapshot", () => {
  const end = "2026-07-28";

  function allSeries(): SymbolSeries[] {
    return ALL_SYMBOLS.map((symbol, i) =>
      syntheticSeries(symbol, end, symbol.includes("Y") ? 4.0 : 100 + i),
    );
  }

  it("marks a complete aligned session when every core asset prints that day", () => {
    const snapshot = assembleSnapshot(allSeries(), config, {
      marketSessionDate: end,
      generatedAt: "2026-07-29T08:15:00-04:00",
    });

    expect(snapshot.kind).toBe("MacroComputeSnapshot");
    expect(snapshot.marketSessionDate).toBe(end);
    expect(snapshot.isCompleteSession).toBe(true);
    expect(snapshot.sessionAlignment).toBe("aligned");
    expect(snapshot.methodology.signatureVersion).toBe(config.signatureVersion);
    expect(snapshot.features).toHaveLength(8);
    expect(snapshot.classification.confidence.calibrated).toBe(false);
  });

  it("reports VIX as stale when it lags the market session by one day", () => {
    const series = allSeries();
    const vix = series.find((s) => s.symbol === "VIX")!;
    const lagged: SymbolSeries = {
      ...vix,
      bars: vix.bars.filter((b) => b.sessionDate < end),
    };
    const replaced = series.map((s) => (s.symbol === "VIX" ? lagged : s));

    const snapshot = assembleSnapshot(replaced, config, {
      marketSessionDate: end,
      generatedAt: "2026-07-29T08:15:00-04:00",
    });

    expect(snapshot.isCompleteSession).toBe(false);
    expect(snapshot.sessionAlignment).toBe("partial");
    expect(snapshot.staleDaysByAsset.VIX).toBe(1);
    expect(snapshot.sourceDateByAsset.VIX).toBe(
      defaultSessionCalendar.previousSession(end),
    );
  });

  it("chooses the latest session shared by both core rates", () => {
    const series = allSeries();
    expect(chooseMarketSession(new Map(series.map((s) => [s.symbol, s])))).toBe(
      end,
    );
  });
});

describe("sessionDistance", () => {
  it("counts sessions across a weekend", () => {
    // Friday 24 → Monday 27 is one session step.
    expect(sessionDistance("2026-07-24", "2026-07-27")).toBe(1);
  });
});

describe("immutable snapshot writer", () => {
  it("refuses to overwrite an existing snapshot", () => {
    const root = mkdtempSync(join(tmpdir(), "gammadesk-"));
    try {
      const series = syntheticSeries("GOLD", "2026-07-28", 100);
      writeBars(series, root);
      writeSnapshot("2026-07-28", { ok: true }, root);
      expect(() => writeSnapshot("2026-07-28", { ok: false }, root)).toThrow(
        /already exists/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
