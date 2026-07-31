import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EstimatedGammaStructure } from "@/contracts";
import {
  aggregateByStrike,
  computeEstimatedGammaStructure,
  deriveCallWall,
  deriveGammaRegime,
  derivePutWall,
  deriveZeroDte,
  FixtureOptionsChainProvider,
  loadOptionsChainFixtureFile,
  parseOptionsChainFixture,
  scoreChain,
  scoreContract,
  unavailableGammaFlip,
  unsignedUnitGex,
  type OptionsChainSnapshot,
  type OptionsContract,
} from "@/gamma";

function contract(
  partial: Partial<OptionsContract> &
    Pick<OptionsContract, "strike" | "right" | "expiry">,
): OptionsContract {
  return {
    symbol: partial.symbol ?? "TEST",
    underlying: partial.underlying ?? "TEST",
    expiry: partial.expiry,
    strike: partial.strike,
    right: partial.right,
    openInterest:
      partial.openInterest === undefined ? 100 : partial.openInterest,
    gamma: partial.gamma === undefined ? 0.01 : partial.gamma,
    multiplier: partial.multiplier ?? 100,
    iv: partial.iv,
    volume: partial.volume,
  };
}

function chain(
  overrides: Partial<Omit<OptionsChainSnapshot, "kind">> = {},
): OptionsChainSnapshot {
  return {
    kind: "OptionsChainSnapshot",
    underlying: "TEST",
    asOf: "2026-07-29T15:00:00.000Z",
    sessionDate: "2026-07-29",
    spot: 100,
    dataDelay: "fixture",
    source: {
      provider: "fixture",
      name: "inline",
      fetchedAt: "2026-07-29T15:00:00.000Z",
    },
    contracts: [],
    synthetic: true,
    ...overrides,
  };
}

describe("unsignedUnitGex formula", () => {
  it("matches gamma * OI * multiplier * spot^2 * 0.01", () => {
    expect(
      unsignedUnitGex({
        gamma: 0.01,
        openInterest: 10,
        multiplier: 100,
        spot: 100,
      }),
    ).toBe(0.01 * 10 * 100 * 100 * 100 * 0.01);
  });

  it("scales with multiplier", () => {
    const m100 = unsignedUnitGex({
      gamma: 0.01,
      openInterest: 10,
      multiplier: 100,
      spot: 50,
    });
    const m10 = unsignedUnitGex({
      gamma: 0.01,
      openInterest: 10,
      multiplier: 10,
      spot: 50,
    });
    expect(m100 / m10).toBe(10);
  });
});

describe("scoreContract boundaries", () => {
  const base = {
    underlying: "TEST",
    sessionDate: "2026-07-29",
    spot: 100,
  };

  it("accepts a valid call and signs puts negative", () => {
    const call = scoreContract(
      contract({
        strike: 100,
        right: "call",
        expiry: "2026-07-29",
        openInterest: 10,
        gamma: 0.01,
      }),
      base,
    );
    const put = scoreContract(
      contract({
        strike: 100,
        right: "put",
        expiry: "2026-07-29",
        openInterest: 10,
        gamma: 0.01,
      }),
      base,
    );
    expect(call.ok).toBe(true);
    expect(put.ok).toBe(true);
    if (call.ok && put.ok) {
      expect(call.contribution.gex).toBeGreaterThan(0);
      expect(put.contribution.gex).toBe(-call.contribution.gex);
    }
  });

  it("skips missing OI and missing gamma", () => {
    expect(
      scoreContract(
        contract({
          strike: 100,
          right: "call",
          expiry: "2026-07-29",
          openInterest: null,
        }),
        base,
      ).ok,
    ).toBe(false);
    expect(
      scoreContract(
        contract({
          strike: 100,
          right: "call",
          expiry: "2026-07-29",
          gamma: null,
        }),
        base,
      ).ok,
    ).toBe(false);
  });

  it("skips expired options vs sessionDate", () => {
    const scored = scoreContract(
      contract({
        strike: 100,
        right: "call",
        expiry: "2026-07-28",
        openInterest: 50,
        gamma: 0.01,
      }),
      base,
    );
    expect(scored.ok).toBe(false);
    if (!scored.ok) expect(scored.reason).toBe("expired");
  });

  it("skips empty-chain spot / anomalous values", () => {
    expect(
      scoreContract(
        contract({ strike: 100, right: "call", expiry: "2026-07-29" }),
        { ...base, spot: null },
      ).ok,
    ).toBe(false);
    expect(
      scoreContract(
        contract({
          strike: 100,
          right: "call",
          expiry: "2026-07-29",
          openInterest: -1,
        }),
        base,
      ).ok,
    ).toBe(false);
    expect(
      scoreContract(
        contract({
          strike: 100,
          right: "call",
          expiry: "2026-07-29",
          gamma: -0.01,
        }),
        base,
      ).ok,
    ).toBe(false);
    expect(
      scoreContract(
        contract({
          strike: 100,
          right: "call",
          expiry: "2026-07-29",
          multiplier: 0,
        }),
        base,
      ).ok,
    ).toBe(false);
    expect(
      scoreContract(
        contract({
          strike: Number.NaN,
          right: "call",
          expiry: "2026-07-29",
        }),
        base,
      ).ok,
    ).toBe(false);
  });

  it("keeps same-day expiry (0DTE) when sessionDate matches", () => {
    const scored = scoreContract(
      contract({
        strike: 100,
        right: "call",
        expiry: "2026-07-29",
        openInterest: 5,
        gamma: 0.02,
      }),
      base,
    );
    expect(scored.ok).toBe(true);
  });
});

describe("computeEstimatedGammaStructure", () => {
  it("returns unavailable for an empty chain", () => {
    const out = computeEstimatedGammaStructure(chain({ contracts: [] }));
    expect(out.status).toBe("unavailable");
    expect(out.totalGex).toBeNull();
    expect(out.gammaRegime).toBe("unavailable");
    expect(out.callWall.status).toBe("unavailable");
    expect(out.putWall.status).toBe("unavailable");
    expect(out.zeroDte.status).toBe("unavailable");
    expect(out.gammaFlip.status).toBe("unavailable");
    expect(out.dataDelay).toBe("fixture");
    expect(out.methodology.id).toBe("oi_gex_proxy_v1");
    expect(out.methodology.version).toBe("0.1.1");
    expect(out.schemaVersion).toBe("0.1.1");
    expect(EstimatedGammaStructure.safeParse(out).success).toBe(true);
  });

  it("computes total GEX, walls, regime, and expiry breakdown", () => {
    const out = computeEstimatedGammaStructure(
      chain({
        contracts: [
          contract({
            strike: 105,
            right: "call",
            expiry: "2026-08-21",
            openInterest: 20,
            gamma: 0.01,
          }),
          contract({
            strike: 95,
            right: "put",
            expiry: "2026-08-21",
            openInterest: 10,
            gamma: 0.01,
          }),
          contract({
            strike: 100,
            right: "call",
            expiry: "2026-07-29",
            openInterest: 5,
            gamma: 0.02,
          }),
        ],
      }),
    );

    expect(out.status).toBe("available");
    expect(out.totalGex).not.toBeNull();
    expect(out.totalGex!).toBeGreaterThan(0);
    expect(out.gammaRegime).toBe("positive");
    expect(out.callWall.status).toBe("available");
    expect(out.callWall.strike).toBe(105);
    expect(out.putWall.status).toBe("available");
    expect(out.putWall.strike).toBe(95);
    expect(out.byExpiry.length).toBe(2);
    expect(out.zeroDte.status).toBe("available");
    expect(out.zeroDte.expiry).toBe("2026-07-29");
    expect(out.gammaFlip).toEqual(unavailableGammaFlip());
    expect(out.asOf).toBeTruthy();
    expect(out.source.provider).toBe("fixture");
    expect(out.methodology.assumptions.length).toBeGreaterThan(0);
  });

  it("marks partial when some contracts are skipped", () => {
    const out = computeEstimatedGammaStructure(
      chain({
        contracts: [
          contract({
            strike: 100,
            right: "call",
            expiry: "2026-07-29",
            openInterest: 10,
            gamma: 0.01,
          }),
          contract({
            strike: 101,
            right: "call",
            expiry: "2026-07-29",
            openInterest: null,
            gamma: 0.01,
          }),
        ],
      }),
    );
    expect(out.status).toBe("partial");
    expect(out.coverage.contractsSkipped).toBe(1);
    expect(out.coverage.skipReasons.missing_oi).toBe(1);
  });

  it("reports 0DTE unavailable when no same-day expiry exists", () => {
    const out = computeEstimatedGammaStructure(
      chain({
        contracts: [
          contract({
            strike: 100,
            right: "call",
            expiry: "2026-08-21",
            openInterest: 10,
            gamma: 0.01,
          }),
        ],
      }),
    );
    expect(out.zeroDte.status).toBe("unavailable");
    expect(out.zeroDte.reason).toMatch(/No contracts with expiry/i);
    // Call-only chain → put wall unavailable → partial (M4-1A).
    expect(out.status).toBe("partial");
    expect(out.putWall.status).toBe("unavailable");
  });

  it("does not invent a gamma flip level", () => {
    const out = computeEstimatedGammaStructure(
      chain({
        contracts: [
          contract({
            strike: 90,
            right: "put",
            expiry: "2026-07-29",
            openInterest: 50,
            gamma: 0.02,
          }),
          contract({
            strike: 110,
            right: "call",
            expiry: "2026-07-29",
            openInterest: 5,
            gamma: 0.01,
          }),
        ],
      }),
    );
    expect(out.gammaFlip.status).toBe("unavailable");
    expect(out.gammaFlip.level).toBeUndefined();
    expect(out.gammaRegime).toBe("negative");
  });

  it("loads the SPX fixture via provider and validates Zod", () => {
    const provider = new FixtureOptionsChainProvider(
      join(process.cwd(), "fixtures", "gamma"),
    );
    const snap = provider.loadChain({
      underlying: "SPX",
      sessionDate: "2026-07-29",
    });
    expect(snap).not.toBeNull();
    const out = computeEstimatedGammaStructure(snap!);
    expect(EstimatedGammaStructure.safeParse(out).success).toBe(true);
    expect(out.underlying).toBe("SPX");
    expect(out.dataDelay).toBe("fixture");
    expect(out.zeroDte.status).toMatch(/available|partial/);
    expect(out.coverage.skipReasons.expired).toBeGreaterThan(0);
    expect(out.coverage.skipReasons.missing_oi).toBeGreaterThan(0);
    expect(out.callWall.strike).toBeDefined();
    expect(out.putWall.strike).toBeDefined();
    expect(out.byStrike.length).toBeGreaterThan(0);
    expect(out.byExpiry.some((e) => e.expiry === "2026-07-29")).toBe(true);
  });
});

describe("walls and regime helpers", () => {
  it("picks max call GEX and min put GEX strikes", () => {
    const byStrike = aggregateByStrike(
      scoreChain(
        chain({
          contracts: [
            contract({
              strike: 100,
              right: "call",
              expiry: "2026-07-29",
              openInterest: 10,
              gamma: 0.01,
            }),
            contract({
              strike: 110,
              right: "call",
              expiry: "2026-07-29",
              openInterest: 30,
              gamma: 0.01,
            }),
            contract({
              strike: 90,
              right: "put",
              expiry: "2026-07-29",
              openInterest: 5,
              gamma: 0.01,
            }),
            contract({
              strike: 80,
              right: "put",
              expiry: "2026-07-29",
              openInterest: 40,
              gamma: 0.01,
            }),
          ],
        }),
      ).used,
    );
    expect(deriveCallWall(byStrike).strike).toBe(110);
    expect(derivePutWall(byStrike).strike).toBe(80);
    const total = byStrike.reduce((a, r) => a + r.netGex, 0);
    expect(total).toBeLessThan(0);
    expect(deriveGammaRegime(total, byStrike)).toBe("negative");
    expect(deriveGammaRegime(Math.abs(total) + 1e9, byStrike)).toBe(
      "positive",
    );
  });

  it("marks near_zero when net is tiny vs gross GEX mass", () => {
    const byStrike = [
      {
        strike: 100,
        callGex: 50,
        putGex: 0,
        netGex: 50,
        callOpenInterest: 1,
        putOpenInterest: 0,
        callContractsUsed: 1,
        putContractsUsed: 0,
      },
      {
        strike: 90,
        callGex: 0,
        putGex: -49,
        netGex: -49,
        callOpenInterest: 0,
        putOpenInterest: 1,
        callContractsUsed: 0,
        putContractsUsed: 1,
      },
    ];
    expect(deriveGammaRegime(1, byStrike)).toBe("near_zero");
  });
});

describe("fixture parse", () => {
  it("parses the committed SPX fixture file", () => {
    const path = join(
      process.cwd(),
      "fixtures/gamma/spx.2026-07-29.json",
    );
    const snap = loadOptionsChainFixtureFile(path);
    expect(snap.contracts.length).toBeGreaterThan(5);
    expect(parseOptionsChainFixture(snap).underlying).toBe("SPX");
    const zero = deriveZeroDte(
      "2026-07-29",
      [{ expiry: "2026-08-21", status: "available", callGex: 1, putGex: -1, netGex: 0, contractsUsed: 2, contractsSkipped: 0 }],
      [],
    );
    expect(zero.status).toBe("unavailable");
  });
});
