import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DailyResearchArchive,
  StudyDefinition,
  StudyForwardOutcome,
  StudyPriceSeries,
  buildOutcomeId,
  buildStudyId,
} from "@/contracts";
import {
  buildStudyDefinition,
  buildStudyForwardOutcome,
  StudyOutcomeError,
  StudySessionError,
  buildSessionCalendar,
} from "@/studies";

const ARCHIVE_PATH =
  "fixtures/studies/archive/2026-07-29/daily-research.json";
const PRICE_PATH = "fixtures/studies/prices/spy.m52.json";

function loadArchive() {
  return DailyResearchArchive.parse(
    JSON.parse(readFileSync(join(process.cwd(), ARCHIVE_PATH), "utf8")),
  );
}

function loadPrices() {
  return StudyPriceSeries.parse(
    JSON.parse(readFileSync(join(process.cwd(), PRICE_PATH), "utf8")),
  );
}

function buildDefinition() {
  return buildStudyDefinition({
    archive: loadArchive(),
    symbol: "SPY",
    archiveRelativePath: ARCHIVE_PATH,
    builtAt: "2026-07-30T12:00:00.000Z",
    synthetic: true,
  });
}

describe("M5-2 StudyDefinition", () => {
  it("builds deterministic studyId from exact archiveId + symbol", () => {
    const def = buildDefinition();
    expect(StudyDefinition.safeParse(def).success).toBe(true);
    expect(def.studyId).toBe(
      buildStudyId("research|2026-07-29|0.1.0", "SPY"),
    );
    expect(def.archiveId).toBe("research|2026-07-29|0.1.0");
    expect(def.sessionDate).toBe("2026-07-29");
    expect(def.limitations.join(" ")).toMatch(/never merge/i);
  });
});

describe("M5-2 forward returns and MFE/MAE", () => {
  it("computes mature 1D/5D/20D returns at full sample asOf", () => {
    const outcome = buildStudyForwardOutcome({
      definition: buildDefinition(),
      priceSeries: loadPrices(),
      priceSeriesAsOfSessionDate: "2026-08-29",
      computedAt: "2026-08-30T12:00:00.000Z",
      priceRelativePath: PRICE_PATH,
    });
    expect(StudyForwardOutcome.safeParse(outcome).success).toBe(true);
    expect(outcome.pitIsolation).toBe(true);
    expect(outcome.outcomeId).toBe(
      buildOutcomeId(
        buildStudyId("research|2026-07-29|0.1.0", "SPY"),
        "2026-08-29",
      ),
    );

    expect(outcome.returns.d1).toMatchObject({
      status: "available",
      entryPrice: 105,
      exitPrice: 106,
      value: 106 / 105 - 1,
    });
    expect(outcome.returns.d5).toMatchObject({
      status: "available",
      entryPrice: 105,
      exitPrice: 109,
      value: 109 / 105 - 1,
    });
    expect(outcome.returns.d20).toMatchObject({
      status: "available",
      entryPrice: 105,
      exitPrice: 122,
      value: 122 / 105 - 1,
    });

    expect(outcome.excursion.d5).toMatchObject({
      status: "available",
      mfe: 109 / 105 - 1,
      mae: 104 / 105 - 1,
    });

    expect(outcome.maturity.every((m) => m.status === "mature")).toBe(true);
  });

  it("marks immature horizons when asOf is too early", () => {
    const outcome = buildStudyForwardOutcome({
      definition: buildDefinition(),
      priceSeries: loadPrices(),
      priceSeriesAsOfSessionDate: "2026-07-30",
      computedAt: "2026-07-31T12:00:00.000Z",
      priceRelativePath: PRICE_PATH,
    });
    expect(outcome.returns.d1.status).toBe("available");
    expect(outcome.returns.d5.status).toBe("unavailable");
    expect(outcome.returns.d20.status).toBe("unavailable");
    expect(outcome.maturity.find((m) => m.horizon === "5D")?.status).toBe(
      "immature",
    );
  });

  it("skips weekends/holidays via sparse session calendar (adjClose)", () => {
    const prices = loadPrices();
    const def = buildStudyDefinition({
      archive: loadArchive(),
      symbol: "SPY",
      archiveRelativePath: ARCHIVE_PATH,
      builtAt: "2026-07-30T12:00:00.000Z",
      synthetic: true,
    });
    // Override entry to Friday before weekend gap in fixture (07-31 -> 08-03).
    const fridayDef = { ...def, sessionDate: "2026-07-31" as const };
    const outcome = buildStudyForwardOutcome({
      definition: fridayDef,
      priceSeries: prices,
      priceSeriesAsOfSessionDate: "2026-08-05",
      computedAt: "2026-08-06T12:00:00.000Z",
      priceRelativePath: PRICE_PATH,
    });
    expect(outcome.returns.d1).toMatchObject({
      status: "available",
      entrySessionDate: "2026-07-31",
      exitSessionDate: "2026-08-03",
      entryPrice: 104,
      exitPrice: 107,
      value: 107 / 104 - 1,
    });
    expect(outcome.excursion.d1).toMatchObject({
      status: "available",
      mfe: 107 / 104 - 1,
      mae: 107 / 104 - 1,
    });
  });

  it("rejects missing entry session in price series", () => {
    const prices = loadPrices();
    const filtered = {
      ...prices,
      bars: prices.bars.filter((b) => b.sessionDate !== "2026-07-29"),
    };
    const outcome = buildStudyForwardOutcome({
      definition: buildDefinition(),
      priceSeries: filtered,
      priceSeriesAsOfSessionDate: "2026-08-29",
      computedAt: "2026-08-30T12:00:00.000Z",
      priceRelativePath: PRICE_PATH,
    });
    expect(outcome.returns.d1.status).toBe("unavailable");
    expect(outcome.maturity[0]?.status).toBe("unavailable");
  });
});

describe("M5-2 leakage and validation", () => {
  it("rejects entry session after priceSeriesAsOfSessionDate", () => {
    expect(() =>
      buildStudyForwardOutcome({
        definition: buildDefinition(),
        priceSeries: loadPrices(),
        priceSeriesAsOfSessionDate: "2026-07-28",
        computedAt: "2026-07-29T12:00:00.000Z",
        priceRelativePath: PRICE_PATH,
      }),
    ).toThrow(StudyOutcomeError);
    expect(() =>
      buildStudyForwardOutcome({
        definition: buildDefinition(),
        priceSeries: loadPrices(),
        priceSeriesAsOfSessionDate: "2026-07-28",
        computedAt: "2026-07-29T12:00:00.000Z",
        priceRelativePath: PRICE_PATH,
      }),
    ).toThrow(/lookahead|after priceSeriesAsOfSessionDate/i);
  });

  it("rejects asOf not in series — no latest fallback", () => {
    expect(() =>
      buildStudyForwardOutcome({
        definition: buildDefinition(),
        priceSeries: loadPrices(),
        priceSeriesAsOfSessionDate: "2026-09-01",
        computedAt: "2026-09-02T12:00:00.000Z",
        priceRelativePath: PRICE_PATH,
      }),
    ).toThrow(/not in price series/);
  });

  it("rejects symbol mismatch between definition and price series", () => {
    expect(() =>
      buildStudyForwardOutcome({
        definition: buildDefinition(),
        priceSeries: { ...loadPrices(), symbol: "QQQ" },
        priceSeriesAsOfSessionDate: "2026-08-29",
        computedAt: "2026-08-30T12:00:00.000Z",
        priceRelativePath: PRICE_PATH,
      }),
    ).toThrow(/symbol QQQ != definition symbol SPY/);
  });

  it("rejects invalid price data at calendar build", () => {
    expect(() =>
      buildSessionCalendar([
        { sessionDate: "2026-07-29", adjClose: 105 },
        { sessionDate: "2026-07-29", adjClose: 106 },
      ]),
    ).toThrow(StudySessionError);
    expect(() =>
      buildSessionCalendar([{ sessionDate: "2026-07-29", adjClose: -1 }]),
    ).toThrow(/invalid adjClose/);
  });

  it("DailyResearchArchive schema excludes outcome fields", () => {
    const archive = loadArchive();
    expect(archive).not.toHaveProperty("returns");
    expect(archive).not.toHaveProperty("pitIsolation");
    expect(Object.keys(archive)).not.toContain("outcomeId");
  });
});

describe("M5-2 determinism", () => {
  it("produces identical outcomes for identical inputs", () => {
    const input = {
      definition: buildDefinition(),
      priceSeries: loadPrices(),
      priceSeriesAsOfSessionDate: "2026-08-05",
      computedAt: "2026-08-06T12:00:00.000Z",
      priceRelativePath: PRICE_PATH,
    };
    const a = buildStudyForwardOutcome(input);
    const b = buildStudyForwardOutcome(input);
    expect(a).toEqual(b);
  });
});
