import { describe, expect, it } from "vitest";
import type { BoundedGammaProviderSnapshot } from "@/contracts";
import { easternWallToUtc } from "@/catalyst/market-context/session";
import spyBoundedFixture from "../fixtures/gamma/providers/marketdata-app/spy-bounded-ui.json";
import {
  buildGammaCone,
  annualIvDecimalToDailyVolPct,
  fullSessionConeBands,
  fullSessionSigmaPoints,
  computeRestOfDayConeBands,
  GAMMA_CONE_Z_50,
  GAMMA_CONE_Z_90,
  estimateWallTouchProbabilities,
  restOfDaySigmaPoints,
  buildV2CommandCenterView,
  loadBoundedGammaDeskView,
  applyBoundedGammaSessionGate,
  type BoundedGammaDeskView,
} from "@/desk";

const SPOT = 741.63;

const SPY_SNAPSHOT = spyBoundedFixture as BoundedGammaProviderSnapshot;

function spyView(
  snapshot: BoundedGammaProviderSnapshot,
  overrides: Partial<BoundedGammaDeskView> = {},
): BoundedGammaDeskView {
  return {
    status: "ready",
    snapshot,
    withheldSnapshot: null,
    sourceLabel: "test",
    isFixture: true,
    freshness: "fresh",
    ...overrides,
  };
}

function flatCloses(
  start: string,
  count: number,
  base = 100,
): readonly { sessionDate: string; close: number }[] {
  const bars: { sessionDate: string; close: number }[] = [];
  const parts = start.split("-").map(Number);
  const y = parts[0] ?? 2026;
  const m = parts[1] ?? 7;
  const d = parts[2] ?? 1;
  const cursor = new Date(Date.UTC(y, m - 1, d));
  for (let i = 0; i < count; i += 1) {
    bars.push({
      sessionDate: cursor.toISOString().slice(0, 10),
      close: base + i * 0.1,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return bars;
}

function roundConeBound(value: number): number {
  if (value >= 100) return Math.round(value);
  return Math.round(value * 10) / 10;
}

describe("gamma cone statistics", () => {
  const spot = SPOT;
  const ivDecimal = 0.142;

  it("computes exact 50% full-session range", () => {
    const sigma = fullSessionSigmaPoints(spot, ivDecimal);
    const margin = GAMMA_CONE_Z_50 * sigma;
    const bands = fullSessionConeBands(spot, ivDecimal);
    expect(bands).not.toBeNull();
    expect(bands!.coreRange50.lower).toBe(roundConeBound(spot - margin));
    expect(bands!.coreRange50.upper).toBe(roundConeBound(spot + margin));
    expect(bands!.coreRange50.confidencePct).toBe(50);
  });

  it("computes exact 90% full-session range", () => {
    const sigma = fullSessionSigmaPoints(spot, ivDecimal);
    const margin = GAMMA_CONE_Z_90 * sigma;
    const bands = fullSessionConeBands(spot, ivDecimal);
    expect(bands).not.toBeNull();
    expect(bands!.expectedRange90.lower).toBe(roundConeBound(spot - margin));
    expect(bands!.expectedRange90.upper).toBe(roundConeBound(spot + margin));
    expect(bands!.expectedRange90.confidencePct).toBe(90);
  });

  it("contracts rest-of-day sigma vs full session at half remaining time", () => {
    const fullSigma = fullSessionSigmaPoints(spot, ivDecimal);
    const rodSigma = restOfDaySigmaPoints(spot, ivDecimal, 0.25);
    expect(rodSigma).toBeCloseTo(fullSigma * 0.5, 6);
  });

  it("marks rest-of-day unavailable when session is closed", () => {
    const now = easternWallToUtc("2026-07-30", 16, 30, 0);
    const bands = computeRestOfDayConeBands({
      spot,
      ivDecimal,
      now,
    });
    expect(bands.status).toBe("unavailable");
    expect(bands.remainingSessionFraction).toBe(0);
  });

  it("provides both 50% and 90% rest-of-day bands during RTH", () => {
    const now = easternWallToUtc("2026-07-30", 14, 0, 0);
    const bands = computeRestOfDayConeBands({
      spot,
      ivDecimal,
      now,
    });
    expect(bands.status).toBe("available");
    expect(bands.coreRange50?.confidencePct).toBe(50);
    expect(bands.expectedRange90?.confidencePct).toBe(90);
    expect(bands.coreRange50!.upper - bands.coreRange50!.lower).toBeLessThan(
      bands.expectedRange90!.upper - bands.expectedRange90!.lower,
    );
  });
});

describe("buildGammaCone", () => {
  it("builds SPY cone from bounded fixture IV", () => {
    const now = easternWallToUtc("2026-07-31", 14, 0, 0);
    const cone = buildGammaCone({
      symbol: "SPY",
      view: spyView(SPY_SNAPSHOT, { freshness: "fresh" }),
      now,
      equityBarsBySymbol: new Map([
        ["SPY", flatCloses("2026-07-06", 25, SPOT)],
      ]),
    });

    expect(cone.status).toBe("available");
    expect(cone.symbol).toBe("SPY");
    expect(cone.spot).toBe(SPY_SNAPSHOT.spot);
    expect(cone.volatility.ivPct).toBe(14.2);
    expect(cone.fullSession.coreRange50).not.toBeNull();
    expect(cone.fullSession.expectedRange90).not.toBeNull();
    expect(cone.restOfDay.status).toBe("available");
    expect(cone.provenance.ivSource).toBe("bounded_representative_iv");
    expect(cone.provenance.fullSessionMode).toBe("annual_iv_over_sqrt_252");
    expect(cone.provenance.restOfDayMode).toBe(
      "sqrt_remaining_session_fraction",
    );
  });

  it("builds QQQ cone from public demo fixture path", () => {
    const now = easternWallToUtc("2026-07-30", 14, 0, 0);
    const view = loadBoundedGammaDeskView({
      symbol: "QQQ",
      publicDemo: true,
      now,
      targetSession: "2026-07-30",
    });
    const cone = buildGammaCone({
      symbol: "QQQ",
      view,
      now,
      equityBarsBySymbol: new Map([
        ["QQQ", flatCloses("2026-07-01", 25, 400)],
      ]),
    });

    expect(cone.symbol).toBe("QQQ");
    if (cone.volatility.ivPct !== null) {
      expect(cone.fullSession.expectedRange90).not.toBeNull();
    }
  });

  it("withholds cone when symbol IV is missing", () => {
    const snapshot = {
      ...SPY_SNAPSHOT,
      representativeIv: {
        status: "unavailable" as const,
        value: null,
        sessionDate: "2026-07-30",
        asOf: "2026-07-30T20:00:00.000Z",
      },
    };
    const cone = buildGammaCone({
      symbol: "SPY",
      view: spyView(snapshot),
      now: easternWallToUtc("2026-07-30", 14, 0, 0),
    });
    expect(cone.status).toBe("unavailable");
    expect(cone.fullSession.coreRange50).toBeNull();
    expect(cone.provenance.ivSource).toBe("unavailable");
  });

  it("warns on negative VRP", () => {
    const snapshot = { ...SPY_SNAPSHOT };
    const now = easternWallToUtc("2026-07-31", 14, 0, 0);
    const cone = buildGammaCone({
      symbol: "SPY",
      view: spyView(snapshot, { freshness: "fresh" }),
      now,
      equityBarsBySymbol: new Map([
        ["SPY", flatCloses("2026-07-06", 25, SPOT).map((bar, i) => ({
          sessionDate: bar.sessionDate,
          close: SPOT * (i % 2 === 0 ? 1 : 1.1),
        }))],
      ]),
    });
    expect(cone.volatility.vrpRegime).toBe("cheap_implied");
    expect(cone.interpretation.warnings.some((w) => /Negative VRP/i.test(w))).toBe(
      true,
    );
  });

  it("interprets positive gamma as compression context", () => {
    const snapshot = {
      ...SPY_SNAPSHOT,
      gammaRegime: "positive" as const,
    };
    const cone = buildGammaCone({
      symbol: "SPY",
      view: spyView(snapshot, { freshness: "fresh" }),
      now: easternWallToUtc("2026-07-30", 14, 0, 0),
      equityBarsBySymbol: new Map([
        ["SPY", flatCloses("2026-07-01", 25, SPOT)],
      ]),
    });
    expect(cone.interpretation.regime).toMatch(/mean-reversion|compression/i);
  });

  it("interprets negative gamma as amplification without directional call", () => {
    const snapshot = {
      ...SPY_SNAPSHOT,
      gammaRegime: "negative" as const,
    };
    const cone = buildGammaCone({
      symbol: "SPY",
      view: spyView(snapshot, { freshness: "fresh" }),
      now: easternWallToUtc("2026-07-30", 14, 0, 0),
      equityBarsBySymbol: new Map([
        ["SPY", flatCloses("2026-07-01", 25, SPOT)],
      ]),
    });
    expect(cone.interpretation.regime).toMatch(/amplifying/i);
    expect(cone.interpretation.regime).toMatch(/not a directional call/i);
  });

  it("warns when spot is below gamma flip", () => {
    const snapshot = {
      ...SPY_SNAPSHOT,
      spot: 740,
      gammaFlip: {
        ...SPY_SNAPSHOT.gammaFlip,
        status: "available" as const,
        strike: 745.9,
        level: 745.9,
        method: "spot_shock_bs_gamma" as const,
        scope: "bounded_single_expiry" as const,
      },
    };
    const cone = buildGammaCone({
      symbol: "SPY",
      view: spyView(snapshot, { freshness: "fresh" }),
      now: easternWallToUtc("2026-07-30", 14, 0, 0),
      equityBarsBySymbol: new Map([
        ["SPY", flatCloses("2026-07-01", 25, 740)],
      ]),
    });
    expect(cone.interpretation.warnings.some((w) => /below gamma flip/i.test(w))).toBe(
      true,
    );
  });

  it("reuses wall-touch probabilities from shared estimator", () => {
    const now = easternWallToUtc("2026-07-30", 14, 0, 0);
    const view = applyBoundedGammaSessionGate(
      loadBoundedGammaDeskView({ forceFixture: true }),
      "2026-07-30",
    );
    const ivDecimal = SPY_SNAPSHOT.representativeIv!.value!;
    const dailyVolPct = annualIvDecimalToDailyVolPct(ivDecimal);
    const direct = estimateWallTouchProbabilities({
      spot: SPY_SNAPSHOT.spot!,
      callWallStrike: 745,
      callWallAvailable: true,
      putWallStrike: 743,
      putWallAvailable: true,
      sessionDate: "2026-07-30",
      symbol: "SPY",
      now,
      dailyVolPct,
    });
    const cone = buildGammaCone({
      symbol: "SPY",
      view,
      now,
      equityBarsBySymbol: new Map([
        ["SPY", flatCloses("2026-07-01", 25, SPOT)],
      ]),
    });
    expect(cone.wallTouch.callWallPercent).toBe(direct.callWallTouch.percent);
    expect(cone.wallTouch.putWallPercent).toBe(direct.putWallTouch.percent);
  });

  it("does not let wall levels change statistical cone boundaries", () => {
    const now = easternWallToUtc("2026-07-30", 14, 0, 0);
    const base = { ...SPY_SNAPSHOT };
    const wallsLow = {
      ...base,
      boundedCallWall: { ...base.boundedCallWall, strike: 700 },
      boundedPutWall: { ...base.boundedPutWall, strike: 680 },
      gammaFlip: {
        ...base.gammaFlip,
        status: "available" as const,
        strike: 720,
        level: 720,
        method: "spot_shock_bs_gamma" as const,
        scope: "bounded_single_expiry" as const,
      },
    };
    const wallsHigh = {
      ...base,
      boundedCallWall: { ...base.boundedCallWall, strike: 800 },
      boundedPutWall: { ...base.boundedPutWall, strike: 780 },
      gammaFlip: {
        ...base.gammaFlip,
        status: "available" as const,
        strike: 790,
        level: 790,
        method: "spot_shock_bs_gamma" as const,
        scope: "bounded_single_expiry" as const,
      },
    };
    const coneLow = buildGammaCone({
      symbol: "SPY",
      view: spyView(wallsLow, { freshness: "fresh" }),
      now,
      equityBarsBySymbol: new Map([
        ["SPY", flatCloses("2026-07-01", 25, SPOT)],
      ]),
    });
    const coneHigh = buildGammaCone({
      symbol: "SPY",
      view: spyView(wallsHigh, { freshness: "fresh" }),
      now,
      equityBarsBySymbol: new Map([
        ["SPY", flatCloses("2026-07-01", 25, SPOT)],
      ]),
    });
    expect(coneLow.fullSession.coreRange50).toEqual(
      coneHigh.fullSession.coreRange50,
    );
    expect(coneLow.fullSession.expectedRange90).toEqual(
      coneHigh.fullSession.expectedRange90,
    );
    expect(coneLow.structure.callWall).not.toBe(coneHigh.structure.callWall);
  });
});

describe("V2 command center integration", () => {
  it("exposes gammaCone tuple on the server view model", async () => {
    const now = easternWallToUtc("2026-07-30", 14, 0, 0);
    const spyGamma = applyBoundedGammaSessionGate(
      loadBoundedGammaDeskView({ forceFixture: true }),
      "2026-07-30",
    );
    const view = await buildV2CommandCenterView({
      driver: null,
      spyGamma,
      qqqGamma: loadBoundedGammaDeskView({
        symbol: "QQQ",
        publicDemo: true,
        now,
        targetSession: "2026-07-30",
      }),
      now,
      equityBarsBySymbol: new Map([
        ["SPY", flatCloses("2026-07-01", 25, SPOT)],
        ["QQQ", flatCloses("2026-07-01", 25, 400)],
      ]),
    });
    expect(view.gammaCone).toHaveLength(2);
    expect(view.gammaCone[0].symbol).toBe("SPY");
    expect(view.gammaCone[1].symbol).toBe("QQQ");
    expect(view.gammaCone[0].fullSession.expectedRange90).not.toBeNull();
  });
});
