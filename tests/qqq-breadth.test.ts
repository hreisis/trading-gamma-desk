import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import fixtureDriver from "../fixtures/macro/dominant-driver.rates-led-easing.json";
import type { DominantDriver } from "@/contracts";
import type { EventGateSnapshot } from "@/contracts/event-gate";
import type { EtfUniverseArtifact } from "@/contracts/etf-universe-artifact";
import { computeQqqBreadthInternals } from "@/desk/breadth/compute/breadth";
import { parseQqqHoldingsPayload } from "@/desk/breadth/holdings/parse-qqq-holdings";
import { applyUniverseFreshness } from "@/desk/breadth/universe/persist";
import { produceDailyQqqBreadth } from "@/desk/breadth/produce-daily-qqq-breadth";
import { createFilesystemBreadthSnapshotStore } from "@/desk/breadth/store";
import {
  deriveBreadthActionableSignal,
  summarizeSpyBreadthFromDurable,
} from "@/desk/v2-command-center";
import {
  buildRiskComponentDivergence,
  deriveRiskDecisionV1_1,
  unavailableQqqBreadthSummary,
} from "@/desk/risk-decision-v1-1";
import type { V2GammaSummary, V2SpyBreadthSummary } from "@/desk/v2-command-center";
import { tradingDaysEndingAt, barSeries } from "./helpers/breadth-fixtures";

const driver = fixtureDriver as DominantDriver;

function sampleQqqPayload() {
  return {
    effectiveDate: "2026-08-10",
    totalNumberOfHoldings: 5,
    holdings: [
      {
        ticker: "NVDA",
        issuerName: "NVIDIA Corp",
        units: 100,
        percentageOfTotalNetAssets: 8.5,
        securityTypeCode: "COM",
        cusip: "67066G104",
      },
      {
        ticker: "AAPL",
        issuerName: "Apple Inc",
        units: 100,
        percentageOfTotalNetAssets: 7,
        securityTypeCode: "COM",
        cusip: "037833100",
      },
      {
        ticker: "MSFT",
        issuerName: "Microsoft Corp",
        units: 100,
        percentageOfTotalNetAssets: 6,
        securityTypeCode: "COM",
        cusip: "594918104",
      },
      {
        ticker: "CASH",
        issuerName: "Cash",
        units: 0,
        percentageOfTotalNetAssets: 0.1,
        securityTypeCode: "CURR",
        cusip: null,
      },
      {
        ticker: "NVDA",
        issuerName: "Duplicate NVDA",
        units: 1,
        percentageOfTotalNetAssets: 0.01,
        securityTypeCode: "COM",
        cusip: "67066G104",
      },
    ],
  };
}

function qqqUniverse(fetchedAt = "2026-08-10T20:00:00.000Z"): EtfUniverseArtifact {
  return parseQqqHoldingsPayload({
    payload: sampleQqqPayload(),
    fetchedAt,
  });
}

function qqqPanel(targetSession: string) {
  const historyDays = 50;
  const historyDates = tradingDaysEndingAt(targetSession, historyDays);
  const seriesBySymbol = new Map([
    [
      "NVDA",
      barSeries(
        "NVDA",
        historyDates.map((date, index) => ({ date, close: 100 + index })),
      ),
    ],
    [
      "AAPL",
      barSeries(
        "AAPL",
        historyDates.map((date, index) => ({ date, close: 80 + index })),
      ),
    ],
    [
      "MSFT",
      barSeries(
        "MSFT",
        historyDates.map((date) => ({ date, close: 60 })),
      ),
    ],
  ]);
  return {
    seriesBySymbol,
    provenance: {
      provider: "alpaca" as const,
      priceFeed: "iex" as const,
      isConsolidated: false,
      adjustment: "split" as const,
      requestedSymbols: 3,
      returnedSymbols: 3,
      coverage: 1,
      pages: 1,
      fetchedAt: `${targetSession}T22:00:00.000Z`,
      latestSessionDate: targetSession,
      failedSymbols: [],
    },
  };
}

function gammaSummary(symbol: "SPY" | "QQQ"): V2GammaSummary {
  return {
    symbol,
    status: "ready",
    freshness: "fresh",
    sessionDate: "2026-08-10",
    expiration: "2026-08-11",
    spot: 500,
    putWall: 480,
    callWall: 520,
    gammaFlip: 495,
    netGex: 1_000_000,
    regime: "positive",
    dataLabel: "fixture",
    dealerFlowRegime: "Stabilizing",
    contextLines: [],
    callWallTouch: { status: "unavailable", percent: null },
    putWallTouch: { status: "unavailable", percent: null },
    restOfDayRange: {
      status: "unavailable",
      lower: null,
      upper: null,
      confidencePct: null,
    },
    volMispricing: {
      status: "available",
      ivPct: 18,
      hv20Pct: 14,
      spreadVolPts: 4,
      signal: "vol_expensive",
      ivDataLabel: "fixture",
    },
    quality: "fixture",
    source: "fixture",
    isFixture: true,
  };
}

const clearEventGate: EventGateSnapshot = {
  kind: "EventGate",
  schemaVersion: "0.1.0",
  state: "clear",
  asOf: "2026-08-10T14:00:00.000Z",
  marketSessionDate: "2026-08-10",
  activeEvents: [],
  nextEvent: null,
  windowStart: null,
  windowEnd: null,
  source: {
    provider: "official_calendar",
    artifact: "fixture",
    fetchedAt: "2026-08-10T12:00:00.000Z",
  },
  status: "available",
  stale: false,
  missingReason: null,
};

describe("parseQqqHoldingsPayload", () => {
  it("parses Invesco QQQ holdings and excludes cash and duplicates", () => {
    const artifact = qqqUniverse();
    expect(artifact.fundSymbol).toBe("QQQ");
    expect(artifact.universeId).toBe("qqq_etf_holdings");
    expect(artifact.constituents.map((row) => row.symbol).sort()).toEqual(
      ["AAPL", "MSFT", "NVDA"].sort(),
    );
    expect(artifact.excludedRows.map((row) => row.exclusionReason).sort()).toEqual(
      ["cash_row", "duplicate_ticker"].sort(),
    );
  });
});

describe("QQQ breadth compute and classification", () => {
  it("classifies strong QQQ breadth when participation and MA breadth are high", () => {
    const targetSession = "2026-08-10";
    const panel = qqqPanel(targetSession);
    const snapshot = computeQqqBreadthInternals({
      universe: {
        ...qqqUniverse(),
        sessionLag: 0,
        stale: false,
        status: "available",
      },
      targetMarketSessionDate: targetSession,
      asOf: `${targetSession}T20:00:00.000Z`,
      seriesBySymbol: panel.seriesBySymbol,
      barsProvenance: panel.provenance,
    });
    const summary = summarizeSpyBreadthFromDurable(
      {
        snapshot,
        sourceArtifact: "fixture",
        missingReason: null,
      },
      false,
    );
    expect(summary.breadthSignalStatus).toBe("available");
    expect(summary.breadthSignal).toBe("strong");
  });

  it("classifies weak QQQ breadth when advance participation is low", () => {
    const targetSession = "2026-08-10";
    const historyDates = tradingDaysEndingAt(targetSession, 50);
    const panel = {
      seriesBySymbol: new Map([
        [
          "NVDA",
          barSeries(
            "NVDA",
            historyDates.map((date, index) => ({ date, close: 200 - index })),
          ),
        ],
        [
          "AAPL",
          barSeries(
            "AAPL",
            historyDates.map((date, index) => ({ date, close: 150 - index })),
          ),
        ],
        [
          "MSFT",
          barSeries(
            "MSFT",
            historyDates.map((date, index) => ({ date, close: 120 - index })),
          ),
        ],
      ]),
      provenance: qqqPanel(targetSession).provenance,
    };
    const snapshot = computeQqqBreadthInternals({
      universe: {
        ...qqqUniverse(),
        sessionLag: 0,
        stale: false,
        status: "available",
      },
      targetMarketSessionDate: targetSession,
      asOf: `${targetSession}T20:00:00.000Z`,
      seriesBySymbol: panel.seriesBySymbol,
      barsProvenance: panel.provenance,
    });
    const summary = summarizeSpyBreadthFromDurable(
      { snapshot, sourceArtifact: "fixture", missingReason: null },
      false,
    );
    expect(summary.breadthSignal).toBe("weak");
  });

  it("marks stale QQQ universe as unavailable breadth", () => {
    const targetSession = "2026-08-10";
    const staleUniverse = applyUniverseFreshness(qqqUniverse(), "2026-08-12");
    const panel = qqqPanel(targetSession);
    const snapshot = computeQqqBreadthInternals({
      universe: staleUniverse,
      targetMarketSessionDate: targetSession,
      asOf: `${targetSession}T20:00:00.000Z`,
      seriesBySymbol: panel.seriesBySymbol,
      barsProvenance: panel.provenance,
    });
    expect(snapshot.status).toBe("unavailable");
    expect(snapshot.stale).toBe(true);
  });
});

describe("produceDailyQqqBreadth", () => {
  it("publishes QQQ breadth snapshot to qqq_etf_holdings store", async () => {
    const store = createFilesystemBreadthSnapshotStore({
      dataRoot: mkdtempSync(join(tmpdir(), "gammadesk-qqq-breadth-")),
      universeId: "qqq_etf_holdings",
      fundSymbol: "QQQ",
    });
    const targetSession = "2026-08-10";
    const result = await produceDailyQqqBreadth({
      store,
      now: () => new Date("2026-08-10T22:00:00.000Z"),
      loadUniverse: async () => ({
        artifact: {
          ...qqqUniverse(),
          sessionLag: 0,
          stale: false,
          status: "available",
        },
        source: "network",
        error: null,
      }),
      loadBarPanel: async () => qqqPanel(targetSession),
    });
    expect(result.status).toBe("published");
    const pointer = await store.readLatestPointer();
    expect(pointer?.fundSymbol).toBe("QQQ");
    expect(pointer?.universeId).toBe("qqq_etf_holdings");
  });
});

describe("SPY vs QQQ breadth divergence in risk v1.1", () => {
  it("uses QQQ breadth in structural risk when snapshot is available", () => {
    const targetSession = "2026-08-10";
    const panel = qqqPanel(targetSession);
    const qqqSnapshot = computeQqqBreadthInternals({
      universe: {
        ...qqqUniverse(),
        sessionLag: 0,
        stale: false,
        status: "available",
      },
      targetMarketSessionDate: targetSession,
      asOf: `${targetSession}T20:00:00.000Z`,
      seriesBySymbol: panel.seriesBySymbol,
      barsProvenance: panel.provenance,
    });
    const qqqBreadth = summarizeSpyBreadthFromDurable(
      { snapshot: qqqSnapshot, sourceArtifact: "fixture", missingReason: null },
      false,
    );
    const spyBreadth: V2SpyBreadthSummary = {
      status: "available",
      stale: false,
      marketSessionDate: targetSession,
      asOf: `${targetSession}T20:00:00.000Z`,
      advance: 100,
      decline: 200,
      unchanged: 10,
      percentAboveMA20: 35,
      percentAboveMA50: 35,
      new20DayClosingHigh: 5,
      new20DayClosingLow: 20,
      missingReason: null,
      sourceArtifact: "fixture",
      advancingPct: 35,
      breadthSignal: "weak",
      breadthSignalStatus: "available",
      breadthContextLine: "35% advancing",
    };

    const result = deriveRiskDecisionV1_1({
      driver,
      spyBreadth,
      qqqBreadth,
      spyGamma: gammaSummary("SPY"),
      qqqGamma: gammaSummary("QQQ"),
      marketCtaProxy: {
        status: "available",
        signal: "neutral",
        contextLine: "neutral",
        triggerLines: [],
      },
      spyCtaProxy: {
        status: "available",
        signal: "neutral",
        contextLine: "neutral",
        triggerLines: [],
      },
      qqqCtaProxy: {
        status: "available",
        signal: "neutral",
        contextLine: "neutral",
        triggerLines: [],
      },
      eventGate: clearEventGate,
      targetSession,
    });

    expect(qqqBreadth.breadthSignal).toBe("strong");
    expect(spyBreadth.breadthSignal).toBe("weak");
    expect(result.qqqStructuralRisk.status).toBe("ready");
    expect(result.componentDivergence.breadth.label).toBe("weak vs strong");
    expect(result.qqqStructuralRisk.riskScore!).not.toBeNull();
  });

  it("falls back to unavailable QQQ breadth when snapshot is missing", () => {
    const unavailable = unavailableQqqBreadthSummary();
    const signal = deriveBreadthActionableSignal(unavailable);
    expect(signal.breadthSignalStatus).toBe("unavailable");
    const divergence = buildRiskComponentDivergence({
      spyBreadth: {
        ...unavailable,
        breadthSignal: "strong",
        breadthSignalStatus: "available",
        advancingPct: 65,
      },
      qqqBreadth: unavailable,
      spyGamma: gammaSummary("SPY"),
      qqqGamma: gammaSummary("QQQ"),
      targetSession: "2026-08-10",
    });
    expect(divergence.breadth.label).toContain("QQQ unavailable");
  });
});
