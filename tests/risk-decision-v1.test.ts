import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import fixtureDriver from "../fixtures/macro/dominant-driver.rates-led-easing.json";
import type { DominantDriver } from "@/contracts";
import type { EventGateSnapshot } from "@/contracts/event-gate";
import {
  buildRiskChangeReason,
  deriveRiskDecisionV1,
  effectiveWeightFromFactorContributions,
  isRiskDecisionV1DailyRecordPublishable,
  isRiskDecisionV1Publishable,
  loadPriorPublishedRiskDecision,
  loadRiskDecisionV1Daily,
  persistRiskDecisionV1Daily,
  publishRiskDecisionV1Daily,
  resolveRiskDecisionDayOverDay,
  riskDecisionV1DailyPath,
  type RiskDecisionSpyBreadthInput,
  type RiskDecisionSpyGammaInput,
  type RiskDecisionV1DailyRecord,
} from "@/desk/risk-decision-v1";
import type { CtaProxySummary } from "@/desk/format-gamma";

const driver = fixtureDriver as DominantDriver;

function strongBreadth(stale = false): RiskDecisionSpyBreadthInput {
  return {
    breadthSignalStatus: "available",
    breadthSignal: "strong",
    breadthContextLine: "62% advancing · broad participation",
    stale,
    advancingPct: 62,
    percentAboveMA20: 58,
    percentAboveMA50: 52,
    new20DayClosingHigh: 18,
    new20DayClosingLow: 5,
  };
}

function spyGammaInput(
  overrides: Partial<RiskDecisionSpyGammaInput> = {},
): RiskDecisionSpyGammaInput {
  return {
    status: "incomplete",
    freshness: "stale",
    regime: "negative",
    dealerFlowRegime: "Amplifying / trend-following dealer flow",
    volMispricing: {
      status: "available",
      ivPct: 18,
      hv20Pct: 14,
      spreadVolPts: 4,
      signal: "vol_expensive",
      ivDataLabel: "Options IV · Jul 30 close",
    },
    ...overrides,
  };
}

const buyingCta: CtaProxySummary = {
  status: "available",
  signal: "buying",
  contextLine: "SPY & QQQ above MA20 & MA50 · systematic trend proxy",
  triggerLines: ["Sell pressure below 740"],
};

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
    artifact: "data/catalyst/calendar-latest.json",
    fetchedAt: "2026-08-10T12:00:00.000Z",
  },
  status: "available",
  stale: false,
  missingReason: null,
};

describe("deriveRiskDecisionV1", () => {
  it("withholds when effective model weight is below the minimum", () => {
    const result = deriveRiskDecisionV1({
      driver: null,
      spyBreadth: {
        breadthSignalStatus: "unavailable",
        breadthSignal: null,
        breadthContextLine: null,
        stale: false,
      },
      spyGamma: spyGammaInput({
        status: "unavailable",
        regime: null,
        volMispricing: {
          status: "unavailable",
          ivPct: null,
          hv20Pct: null,
          spreadVolPts: null,
          signal: null,
          ivDataLabel: null,
        },
      }),
      ctaProxy: {
        status: "unavailable",
        signal: null,
        contextLine: null,
        triggerLines: [],
      },
      eventGate: null,
      targetSession: "2026-08-10",
    });

    expect(result.status).toBe("withheld");
    expect(result.riskScore).toBeNull();
    expect(result.stance).toBeNull();
    expect(result.withheldFactors.length).toBeGreaterThan(0);
  });

  it("computes risk, stance, exposure, and allocation from connected inputs", () => {
    const result = deriveRiskDecisionV1({
      driver,
      spyBreadth: strongBreadth(),
      spyGamma: spyGammaInput(),
      ctaProxy: buyingCta,
      eventGate: clearEventGate,
      targetSession: "2026-07-28",
    });

    expect(result.status).toBe("ready");
    expect(result.riskScore).not.toBeNull();
    if (result.riskScore === null) return;
    expect(result.riskScore).toBeGreaterThan(0);
    expect(result.riskScore).toBeLessThanOrEqual(100);
    expect(result.stance).toMatch(/buy|hold|reduce/);
    expect(result.exposure).not.toBeNull();
    expect(result.allocation).not.toEqual(null);
    if (result.allocation) {
      expect(
        result.allocation.highBeta +
          result.allocation.defense +
          result.allocation.metals +
          result.allocation.hedge,
      ).toBe(100);
    }
    expect(result.opportunityScore).toBe(100 - result.riskScore);
    expect(result.baseRiskScore).not.toBeNull();
    expect(result.evidence[0]).toMatch(/Structural risk/);
    expect(result.coverage?.factorsUsed.length).toBeGreaterThanOrEqual(4);
  });

  it("reduces stale factor weight instead of treating dated inputs as live", () => {
    const fresh = deriveRiskDecisionV1({
      driver,
      spyBreadth: strongBreadth(false),
      spyGamma: spyGammaInput({ freshness: "fresh" }),
      ctaProxy: buyingCta,
      eventGate: clearEventGate,
      targetSession: "2026-07-28",
    });
    const stale = deriveRiskDecisionV1({
      driver,
      spyBreadth: strongBreadth(true),
      spyGamma: spyGammaInput({ freshness: "stale" }),
      ctaProxy: buyingCta,
      eventGate: clearEventGate,
      targetSession: "2026-07-28",
    });

    expect(fresh.status).toBe("ready");
    expect(stale.status).toBe("ready");
    if (
      fresh.riskScore === null ||
      stale.riskScore === null ||
      fresh.coverage === null ||
      stale.coverage === null
    ) {
      throw new Error("expected ready scores");
    }
    expect(stale.coverage.effectiveWeight).toBeLessThan(
      fresh.coverage.effectiveWeight,
    );
  });

  it("maps high risk to reduce stance and defensive allocation", () => {
    const result = deriveRiskDecisionV1({
      driver: {
        ...driver,
        riskDirection: "risk_off",
        label: "Risk-off (broad)",
        primaryRegime: "risk_sentiment",
      },
      spyBreadth: {
        breadthSignalStatus: "available",
        breadthSignal: "weak",
        breadthContextLine: "40% advancing · participation weakening",
        stale: false,
      },
      spyGamma: spyGammaInput({
        freshness: "fresh",
        regime: "negative",
        volMispricing: {
          status: "available",
          ivPct: 28,
          hv20Pct: 14,
          spreadVolPts: 14,
          signal: "vol_expensive",
          ivDataLabel: "Options IV · Aug 10 close",
        },
      }),
      ctaProxy: {
        status: "available",
        signal: "selling",
        contextLine: "SPY & QQQ below MA20 & MA50 · systematic trend proxy",
        triggerLines: [],
      },
      eventGate: {
        ...clearEventGate,
        state: "active_shock",
        activeEvents: [
          {
            catalystId: "cpi",
            kind: "cpi",
            headline: "CPI release",
            occurredAt: "2026-08-10T12:30:00.000Z",
            phase: "active_shock",
            windowStart: "2026-08-10T11:30:00.000Z",
            windowEnd: "2026-08-10T14:30:00.000Z",
          },
        ],
      },
      targetSession: "2026-08-10",
    });

    expect(result.status).toBe("ready");
    expect(result.stance).toBe("reduce");
    if (result.riskScore === null || result.allocation === null) {
      throw new Error("expected reduce allocation");
    }
    expect(result.riskScore).toBeGreaterThanOrEqual(66);
    expect(result.allocation.highBeta).toBeLessThan(result.allocation.defense);
    expect(result.allocation.hedge).toBeGreaterThan(15);
  });

  it("builds a compact factor-change reason from contribution deltas", () => {
    const reason = buildRiskChangeReason(
      -4,
      [
        { id: "breadth", score: 25, effectiveWeight: 25 },
        { id: "cta", score: 25, effectiveWeight: 15 },
      ],
      [
        { id: "breadth", score: 50, effectiveWeight: 25 },
        { id: "cta", score: 50, effectiveWeight: 15 },
      ],
    );
    expect(reason).toBe("Risk eased: breadth improved · CTA strengthened");
  });

  it("persists daily output and compares to the prior published record", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "risk-v1-"));
    const prior: RiskDecisionV1DailyRecord = {
      schemaVersion: "0.1.0",
      publicationDate: "2026-07-29",
      marketSessionDate: "2026-07-29",
      generatedAt: "2026-07-29T20:00:00.000Z",
      riskScore: 55,
      factorContributions: [
        { id: "breadth", score: 50, effectiveWeight: 25 },
        { id: "macro", score: 55, effectiveWeight: 25 },
        { id: "cta", score: 50, effectiveWeight: 15 },
      ],
    };
    persistRiskDecisionV1Daily(dataRoot, prior);

    const today = deriveRiskDecisionV1({
      driver,
      spyBreadth: strongBreadth(),
      spyGamma: spyGammaInput(),
      ctaProxy: buyingCta,
      eventGate: clearEventGate,
      targetSession: "2026-07-30",
    });

    const dayOverDay = resolveRiskDecisionDayOverDay({
      dataRoot,
      publicationDate: "2026-07-30",
      decisionSessionDate: "2026-07-30",
      today,
      now: new Date("2026-07-30T20:00:00.000Z"),
    });

    expect(today.status).toBe("ready");
    expect(today.riskScore).not.toBeNull();
    if (today.riskScore === null) return;
    expect(dayOverDay.riskChange).toBe(today.riskScore - 55);
    expect(dayOverDay.riskChangeReason).toMatch(/Risk (eased|rose|unchanged):/);
  });

  it("does not overwrite an existing published daily record", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "risk-v1-"));
    const prior: RiskDecisionV1DailyRecord = {
      schemaVersion: "0.1.0",
      publicationDate: "2026-08-11",
      marketSessionDate: "2026-08-11",
      generatedAt: "2026-08-11T20:00:00.000Z",
      riskScore: 51,
      factorContributions: [{ id: "breadth", score: 50, effectiveWeight: 25 }],
    };
    persistRiskDecisionV1Daily(dataRoot, prior);

    const today = deriveRiskDecisionV1({
      driver,
      spyBreadth: strongBreadth(),
      spyGamma: spyGammaInput(),
      ctaProxy: buyingCta,
      eventGate: clearEventGate,
      targetSession: "2026-08-11",
    });

    persistRiskDecisionV1Daily(dataRoot, {
      schemaVersion: "0.1.0",
      publicationDate: "2026-08-11",
      marketSessionDate: "2026-08-11",
      generatedAt: "2026-08-12T20:00:00.000Z",
      riskScore: 65,
      factorContributions: today.factorContributions,
    });

    expect(loadRiskDecisionV1Daily(dataRoot, "2026-08-11")?.riskScore).toBe(51);
  });

  it("adds leadership concentration penalty after the base weighted score", () => {
    const result = deriveRiskDecisionV1({
      driver,
      spyBreadth: {
        breadthSignalStatus: "available",
        breadthSignal: "mixed",
        breadthContextLine: "55% advancing · mixed participation",
        stale: true,
        advancingPct: 55,
        percentAboveMA20: 63,
        percentAboveMA50: 63,
        new20DayClosingHigh: 16,
        new20DayClosingLow: 6,
      },
      spyGamma: spyGammaInput(),
      ctaProxy: buyingCta,
      eventGate: clearEventGate,
      targetSession: "2026-07-28",
      sectorRotation: {
        status: "available",
        stale: true,
        sessionDate: "2026-07-27",
        sectors: [],
        topLeadingImproving: [],
        bottomWeakening: [],
        missingReason: null,
      },
    });

    expect(result.status).toBe("ready");
    expect(result.baseRiskScore).not.toBeNull();
    expect(result.concentrationPenalty).toBe(3);
    if (result.baseRiskScore === null || result.riskScore === null) return;
    expect(result.riskScore).toBe(result.baseRiskScore + 3);
    expect(
      result.evidence.some((line) =>
        line.includes("+3 concentration risk · narrow participation"),
      ),
    ).toBe(true);
  });
});

function invalidPartialDailyRecord(
  publicationDate: string,
): RiskDecisionV1DailyRecord {
  return {
    schemaVersion: "0.1.0",
    publicationDate,
    marketSessionDate: "2026-08-12",
    generatedAt: "2026-08-13T10:00:00.000Z",
    riskScore: 40,
    factorContributions: [
      { id: "breadth", score: 50, effectiveWeight: 12.5 },
      { id: "vol", score: 30, effectiveWeight: 15 },
      { id: "gamma", score: 25, effectiveWeight: 11.25 },
      { id: "event_gate", score: 60, effectiveWeight: 10 },
    ],
  };
}

describe("Risk V1 daily publication", () => {
  it("does not publish withheld or insufficient-coverage decisions", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "risk-v1-pub-"));
    const withheld = deriveRiskDecisionV1({
      driver: null,
      spyBreadth: {
        breadthSignalStatus: "unavailable",
        breadthSignal: null,
        breadthContextLine: null,
        stale: false,
      },
      spyGamma: spyGammaInput({
        status: "unavailable",
        regime: null,
        volMispricing: {
          status: "unavailable",
          ivPct: null,
          hv20Pct: null,
          spreadVolPts: null,
          signal: null,
          ivDataLabel: null,
        },
      }),
      ctaProxy: {
        status: "unavailable",
        signal: null,
        contextLine: null,
        triggerLines: [],
      },
      eventGate: null,
      targetSession: "2026-08-13",
    });

    expect(isRiskDecisionV1Publishable(withheld)).toBe(false);

    resolveRiskDecisionDayOverDay({
      dataRoot,
      publicationDate: "2026-08-13",
      decisionSessionDate: "2026-08-12",
      today: withheld,
      now: new Date("2026-08-13T15:00:00.000Z"),
    });

    expect(loadRiskDecisionV1Daily(dataRoot, "2026-08-13")).toBeNull();
  });

  it("publishes the first genuinely publishable decision for the day", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "risk-v1-pub-"));
    const today = deriveRiskDecisionV1({
      driver,
      spyBreadth: strongBreadth(),
      spyGamma: spyGammaInput(),
      ctaProxy: buyingCta,
      eventGate: clearEventGate,
      targetSession: "2026-08-12",
    });

    expect(isRiskDecisionV1Publishable(today)).toBe(true);

    resolveRiskDecisionDayOverDay({
      dataRoot,
      publicationDate: "2026-08-13",
      decisionSessionDate: "2026-08-12",
      today,
      now: new Date("2026-08-13T18:00:00.000Z"),
    });

    const published = loadRiskDecisionV1Daily(dataRoot, "2026-08-13");
    expect(published?.riskScore).toBe(today.riskScore);
    expect(published?.factorContributions).toEqual(today.factorContributions);
    expect(
      isRiskDecisionV1DailyRecordPublishable(published!),
    ).toBe(true);
  });

  it("does not overwrite a valid published daily record on later computations", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "risk-v1-pub-"));
    const first = deriveRiskDecisionV1({
      driver,
      spyBreadth: strongBreadth(),
      spyGamma: spyGammaInput(),
      ctaProxy: buyingCta,
      eventGate: clearEventGate,
      targetSession: "2026-08-12",
    });

    resolveRiskDecisionDayOverDay({
      dataRoot,
      publicationDate: "2026-08-13",
      decisionSessionDate: "2026-08-12",
      today: first,
      now: new Date("2026-08-13T12:00:00.000Z"),
    });

    const highRisk = deriveRiskDecisionV1({
      driver: {
        ...driver,
        riskDirection: "risk_off",
        primaryRegime: "risk_sentiment",
      },
      spyBreadth: {
        breadthSignalStatus: "available",
        breadthSignal: "weak",
        breadthContextLine: "40% advancing",
        stale: false,
      },
      spyGamma: spyGammaInput({ freshness: "fresh", regime: "negative" }),
      ctaProxy: {
        status: "available",
        signal: "selling",
        contextLine: "selling",
        triggerLines: [],
      },
      eventGate: {
        ...clearEventGate,
        state: "active_shock",
        activeEvents: [
          {
            catalystId: "cpi",
            kind: "cpi",
            headline: "CPI",
            occurredAt: "2026-08-12T12:30:00.000Z",
            phase: "active_shock",
            windowStart: "2026-08-12T11:30:00.000Z",
            windowEnd: "2026-08-12T14:30:00.000Z",
          },
        ],
      },
      targetSession: "2026-08-12",
    });

    resolveRiskDecisionDayOverDay({
      dataRoot,
      publicationDate: "2026-08-13",
      decisionSessionDate: "2026-08-12",
      today: highRisk,
      now: new Date("2026-08-13T18:00:00.000Z"),
    });

    expect(loadRiskDecisionV1Daily(dataRoot, "2026-08-13")?.riskScore).toBe(
      first.riskScore,
    );
  });

  it("replaces a non-publishable partial record when a publishable decision arrives", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "risk-v1-pub-"));
    const partial = invalidPartialDailyRecord("2026-08-13");
    mkdirSync(join(dataRoot, "risk-decision-v1"), { recursive: true });
    writeFileSync(
      riskDecisionV1DailyPath(dataRoot, "2026-08-13"),
      JSON.stringify(partial),
    );
    expect(isRiskDecisionV1DailyRecordPublishable(partial)).toBe(false);
    expect(
      effectiveWeightFromFactorContributions(partial.factorContributions),
    ).toBe(48.75);

    const publishable = deriveRiskDecisionV1({
      driver,
      spyBreadth: strongBreadth(),
      spyGamma: spyGammaInput(),
      ctaProxy: buyingCta,
      eventGate: clearEventGate,
      targetSession: "2026-08-12",
    });

    resolveRiskDecisionDayOverDay({
      dataRoot,
      publicationDate: "2026-08-13",
      decisionSessionDate: "2026-08-12",
      today: publishable,
      now: new Date("2026-08-13T19:00:00.000Z"),
    });

    expect(loadRiskDecisionV1Daily(dataRoot, "2026-08-13")?.riskScore).toBe(
      publishable.riskScore,
    );
    expect(loadRiskDecisionV1Daily(dataRoot, "2026-08-13")?.riskScore).not.toBe(
      40,
    );
  });

  it("compares day-over-day only against prior valid published records", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "risk-v1-pub-"));
    const validPrior: RiskDecisionV1DailyRecord = {
      schemaVersion: "0.1.0",
      publicationDate: "2026-08-12",
      marketSessionDate: "2026-08-11",
      generatedAt: "2026-08-12T20:00:00.000Z",
      riskScore: 49,
      factorContributions: [
        { id: "breadth", score: 50, effectiveWeight: 25 },
        { id: "macro", score: 55, effectiveWeight: 25 },
        { id: "vol", score: 50, effectiveWeight: 15 },
        { id: "gamma", score: 25, effectiveWeight: 11.25 },
        { id: "event_gate", score: 15, effectiveWeight: 10 },
      ],
    };
    persistRiskDecisionV1Daily(dataRoot, validPrior);
    mkdirSync(join(dataRoot, "risk-decision-v1"), { recursive: true });
    writeFileSync(
      riskDecisionV1DailyPath(dataRoot, "2026-08-13"),
      JSON.stringify(invalidPartialDailyRecord("2026-08-13")),
    );

    expect(
      loadPriorPublishedRiskDecision(dataRoot, "2026-08-14")?.riskScore,
    ).toBe(49);

    const publishable = deriveRiskDecisionV1({
      driver,
      spyBreadth: strongBreadth(),
      spyGamma: spyGammaInput(),
      ctaProxy: buyingCta,
      eventGate: clearEventGate,
      targetSession: "2026-08-12",
    });

    const dayOverDay = resolveRiskDecisionDayOverDay({
      dataRoot,
      publicationDate: "2026-08-14",
      decisionSessionDate: "2026-08-12",
      today: publishable,
      now: new Date("2026-08-14T12:00:00.000Z"),
    });

    if (publishable.riskScore === null) throw new Error("expected score");
    expect(dayOverDay.riskChange).toBe(publishable.riskScore - 49);
    expect(
      loadPriorPublishedRiskDecision(dataRoot, "2026-08-14")?.riskScore,
    ).toBe(49);
    expect(loadRiskDecisionV1Daily(dataRoot, "2026-08-14")?.riskScore).toBe(
      publishable.riskScore,
    );
  });

  it("rejects direct publish attempts for non-publishable daily records", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "risk-v1-pub-"));
    expect(
      publishRiskDecisionV1Daily(dataRoot, invalidPartialDailyRecord("2026-08-13")),
    ).toBe(false);
    expect(loadRiskDecisionV1Daily(dataRoot, "2026-08-13")).toBeNull();
  });
});
