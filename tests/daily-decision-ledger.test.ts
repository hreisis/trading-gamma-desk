import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildDailyDecisionLedgerRecord,
  buildDailyDecisionLedgerSymbolOutcome,
  buildDailyDecisionLedgerCsv,
  maybeAppendDailyDecisionLedgerOutcome,
  maybeFreezeDailyDecisionLedgerPrediction,
  persistDailyDecisionLedgerRecord,
  loadDailyDecisionLedgerRecord,
  listDailyDecisionLedgerRecords,
} from "@/desk/daily-decision-ledger";
import type { RiskDecisionV1Result } from "@/desk/risk-decision-v1";
import type { V2CommandCenterView } from "@/desk/v2-command-center";

function readyDecision(): RiskDecisionV1Result {
  return {
    status: "ready",
    baseRiskScore: 32,
    concentrationPenalty: 3,
    riskScore: 35,
    stance: "buy",
    exposure: { min: 90, max: 105 },
    allocation: { highBeta: 40, defense: 28, metals: 18, hedge: 15 },
    opportunityScore: 65,
    evidence: [],
    coverage: {
      effectiveWeight: 62.5,
      factorsUsed: ["breadth"],
      confidence: "moderate",
    },
    withheldReason: null,
    withheldFactors: [],
    factorContributions: [
      { id: "breadth", score: 50, effectiveWeight: 12.5 },
      { id: "macro", score: 25, effectiveWeight: 25 },
    ],
    concentrationReason: null,
  };
}

function readyView(sessionDate: string): V2CommandCenterView {
  return {
    decisionStatus: "ready",
    stance: "buy",
    riskScore: 35,
    riskChange: -4,
    riskChangeReason: "Risk eased: breadth improved",
    riskSessionComparison: null,
    opportunityScore: 65,
    exposure: { min: 90, max: 105 },
    allocation: { highBeta: 40, defense: 28, metals: 18, hedge: 15 },
    evidence: [],
    missingInputs: [],
    spyBreadth: {
      status: "available",
      stale: false,
      marketSessionDate: sessionDate,
      asOf: null,
      advance: null,
      decline: null,
      unchanged: null,
      percentAboveMA20: null,
      percentAboveMA50: null,
      new20DayClosingHigh: null,
      new20DayClosingLow: null,
      missingReason: null,
      sourceArtifact: null,
      advancingPct: 55,
      breadthSignal: "mixed",
      breadthSignalStatus: "available",
      breadthContextLine: "55% advancing",
    },
    ctaProxy: {
      status: "unavailable",
      signal: null,
      contextLine: null,
      triggerLines: [],
    },
    gamma: [
      {
        symbol: "SPY",
        status: "ready",
        freshness: "fresh",
        sessionDate,
        expiration: sessionDate,
        spot: 500,
        putWall: 495,
        callWall: 505,
        gammaFlip: 502,
        netGex: 1_000_000,
        regime: "positive",
        dataLabel: null,
        dealerFlowRegime: "Stabilizing",
        contextLines: [],
        callWallTouch: { status: "unavailable", percent: null },
        putWallTouch: { status: "unavailable", percent: null },
        restOfDayRange: {
          status: "available",
          lower: 490,
          upper: 510,
          confidencePct: 90,
        },
        volMispricing: {
          status: "available",
          signal: "balanced",
          spreadVolPts: 0,
          ivPct: 12,
          hv20Pct: 12,
          ivDataLabel: null,
        },
        quality: "ok",
        source: "test",
        isFixture: true,
      },
      {
        symbol: "QQQ",
        status: "ready",
        freshness: "fresh",
        sessionDate,
        expiration: sessionDate,
        spot: 400,
        putWall: 395,
        callWall: 405,
        gammaFlip: 402,
        netGex: 500_000,
        regime: "positive",
        dataLabel: null,
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
          status: "unavailable",
          signal: null,
          spreadVolPts: null,
          ivPct: null,
          hv20Pct: null,
          ivDataLabel: null,
        },
        quality: "ok",
        source: "test",
        isFixture: true,
      },
    ],
    gammaCone: [
      { symbol: "SPY", status: "unavailable" },
      { symbol: "QQQ", status: "unavailable" },
    ] as unknown as V2CommandCenterView["gammaCone"],
    macroLabel: "Inflation-led risk-on",
    macroSummary: {
      label: "Inflation-led risk-on",
      primaryRegime: "inflation",
      riskDirection: "risk_on",
      marketSessionDate: sessionDate,
      interpretation: null,
      evidence: [],
    },
    sessionDate,
    sectorRotation: {
      status: "available",
      stale: false,
      sessionDate,
      sectors: [],
      topLeadingImproving: [],
      bottomWeakening: [],
      missingReason: null,
    },
    spyStructuralRiskScore: 35,
    qqqStructuralRiskScore: 40,
    riskDivergence: 5,
    riskDivergenceChange: null,
    riskDivergenceTrend: null,
    componentDivergence: {
      gammaRegime: { spy: null, qqq: null, label: null },
      ivHvSpread: {
        spySpreadVolPts: null,
        qqqSpreadVolPts: null,
        spreadDivergencePts: null,
      },
      breadth: { spy: null, qqq: null, label: null },
      relativePerformance: { qqqVsSpy1dPct: null, qqqVsSpy5dPct: null },
    },
    qqqBreadth: {
      status: "unavailable",
      stale: false,
      marketSessionDate: null,
      asOf: null,
      advance: null,
      decline: null,
      unchanged: null,
      percentAboveMA20: null,
      percentAboveMA50: null,
      new20DayClosingHigh: null,
      new20DayClosingLow: null,
      missingReason: null,
      sourceArtifact: null,
      advancingPct: null,
      breadthSignal: null,
      breadthSignalStatus: "unavailable",
      breadthContextLine: null,
    },
  };
}

describe("daily-decision-ledger", () => {
  it("freezes prediction once per market session", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "ledger-"));
    const sessionDate = "2026-08-13";
    const view = readyView(sessionDate);
    const decision = readyDecision();

    const first = await maybeFreezeDailyDecisionLedgerPrediction({
      view,
      decision,
      eventGate: null,
      publicationDate: "2026-08-14",
      frozenAt: "2026-08-14T20:00:00.000Z",
      dataRoot,
    });
    const second = await maybeFreezeDailyDecisionLedgerPrediction({
      view,
      decision,
      eventGate: null,
      publicationDate: "2026-08-14",
      frozenAt: "2026-08-14T21:00:00.000Z",
      dataRoot,
    });

    expect(first).toBe(true);
    expect(second).toBe(false);
    const record = loadDailyDecisionLedgerRecord(dataRoot, sessionDate);
    expect(record?.prediction.riskScore).toBe(35);
    expect(record?.frozenAt).toBe("2026-08-14T20:00:00.000Z");
    expect(record?.outcome).toBeUndefined();
  });

  it("appends S+1 outcome once using close-to-close and intraday excursion", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "ledger-outcome-"));
    const predictionSession = "2026-08-13";
    const outcomeSession = "2026-08-14";
    const record = buildDailyDecisionLedgerRecord({
      view: readyView(predictionSession),
      decision: readyDecision(),
      eventGate: null,
      frozenAt: "2026-08-14T20:00:00.000Z",
      publicationDate: "2026-08-14",
    });
    if (!record) throw new Error("expected record");
    persistDailyDecisionLedgerRecord(dataRoot, record);

    const bars = new Map([
      [
        "SPY",
        [
          {
            sessionDate: predictionSession,
            open: 100,
            high: 101,
            low: 99,
            close: 100,
            volume: 1,
          },
          {
            sessionDate: outcomeSession,
            open: 100,
            high: 103,
            low: 98,
            close: 102,
            volume: 1,
          },
        ],
      ],
      [
        "QQQ",
        [
          {
            sessionDate: predictionSession,
            open: 200,
            high: 201,
            low: 199,
            close: 200,
            volume: 1,
          },
          {
            sessionDate: outcomeSession,
            open: 200,
            high: 204,
            low: 197,
            close: 201,
            volume: 1,
          },
        ],
      ],
    ]);

    const now = new Date("2026-08-15T20:00:00.000Z");
    const appended = await maybeAppendDailyDecisionLedgerOutcome({
      marketSessionDate: predictionSession,
      now,
      equityBarsBySymbol: bars,
      dataRoot,
    });
    const again = await maybeAppendDailyDecisionLedgerOutcome({
      marketSessionDate: predictionSession,
      now,
      equityBarsBySymbol: bars,
      dataRoot,
    });

    expect(appended).toBe(true);
    expect(again).toBe(false);

    const stored = loadDailyDecisionLedgerRecord(dataRoot, predictionSession);
    expect(stored?.outcome?.outcomeSessionDate).toBe(outcomeSession);
    expect(stored?.outcome?.spy.closeToCloseReturnPct).toBe(2);
    expect(stored?.outcome?.spy.openToCloseReturnPct).toBe(2);
    expect(stored?.outcome?.spy.maxFavorableMovePct).toBe(3);
    expect(stored?.outcome?.spy.maxAdverseMovePct).toBe(-2);
    expect(stored?.outcome?.qqq?.closeToCloseReturnPct).toBe(0.5);
  });

  it("builds symbol outcome metrics from prior close and outcome session bar", () => {
    const outcome = buildDailyDecisionLedgerSymbolOutcome({
      priorSessionBar: {
        sessionDate: "2026-08-13",
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        volume: 1,
      },
      outcomeSessionBar: {
        sessionDate: "2026-08-14",
        open: 100,
        high: 105,
        low: 97,
        close: 103,
        volume: 1,
      },
    });

    expect(outcome.closeToCloseReturnPct).toBe(3);
    expect(outcome.openToCloseReturnPct).toBe(3);
    expect(outcome.maxFavorableMovePct).toBe(5);
    expect(outcome.maxAdverseMovePct).toBe(-3);
  });

  it("exports one CSV row per session", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "ledger-csv-"));
    const record = buildDailyDecisionLedgerRecord({
      view: readyView("2026-08-13"),
      decision: readyDecision(),
      eventGate: null,
      frozenAt: "2026-08-14T20:00:00.000Z",
      publicationDate: "2026-08-14",
    });
    if (!record) throw new Error("expected record");
    persistDailyDecisionLedgerRecord(dataRoot, record);

    const csv = buildDailyDecisionLedgerCsv(
      listDailyDecisionLedgerRecords(dataRoot),
    );
    expect(csv.split("\n").length).toBeGreaterThanOrEqual(2);
    expect(csv).toContain("marketSessionDate");
    expect(csv).toContain("2026-08-13");
    expect(csv).toContain("Inflation-led risk-on");
  });
});
