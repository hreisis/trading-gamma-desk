import { describe, expect, it } from "vitest";
import {
  computeEstimatedGammaStructure,
  deriveCallWall,
  deriveGammaRegime,
  derivePutWall,
  deriveZeroDte,
  grossGex,
  parseOptionsChainFixture,
  scoreContract,
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

const base = {
  underlying: "TEST",
  sessionDate: "2026-07-29",
  spot: 100,
};

describe("M4-1A OI=0 and gamma=0 are valid", () => {
  it("accepts zero OI and zero gamma; rejects negatives", () => {
    const zeroOi = scoreContract(
      contract({
        strike: 100,
        right: "call",
        expiry: "2026-07-29",
        openInterest: 0,
        gamma: 0.01,
      }),
      base,
    );
    expect(zeroOi.ok).toBe(true);
    if (zeroOi.ok) expect(zeroOi.contribution.gex).toBe(0);

    const zeroGamma = scoreContract(
      contract({
        strike: 100,
        right: "put",
        expiry: "2026-07-29",
        openInterest: 10,
        gamma: 0,
      }),
      base,
    );
    expect(zeroGamma.ok).toBe(true);
    if (zeroGamma.ok) expect(zeroGamma.contribution.gex).toBe(0);

    const negOi = scoreContract(
      contract({
        strike: 100,
        right: "call",
        expiry: "2026-07-29",
        openInterest: -1,
      }),
      base,
    );
    expect(negOi.ok).toBe(false);
    if (!negOi.ok) expect(negOi.reason).toBe("negative_oi");

    const negGamma = scoreContract(
      contract({
        strike: 100,
        right: "call",
        expiry: "2026-07-29",
        gamma: -0.01,
      }),
      base,
    );
    expect(negGamma.ok).toBe(false);
    if (!negGamma.ok) expect(negGamma.reason).toBe("negative_gamma");
  });
});

describe("M4-1A near-zero uses gross GEX", () => {
  it("normalizes |total| by Σ(|callGex|+|putGex|), not Σ|net|", () => {
    // Same-strike canceling nets: net≈0 but gross is large → still near_zero for tiny total.
    const byStrike = [
      {
        strike: 100,
        callGex: 100,
        putGex: -100,
        netGex: 0,
        callOpenInterest: 1,
        putOpenInterest: 1,
        callContractsUsed: 1,
        putContractsUsed: 1,
      },
    ];
    expect(grossGex(byStrike)).toBe(200);
    expect(deriveGammaRegime(0, byStrike)).toBe("near_zero");
    // |total|/gross = 50/200 = 0.25 → directional
    expect(deriveGammaRegime(50, byStrike)).toBe("positive");
  });
});

describe("M4-1A 0DTE share is gross/gross without clamping", () => {
  it("uses gross 0DTE / gross total", () => {
    const byStrike = [
      {
        strike: 100,
        callGex: 30,
        putGex: -10,
        netGex: 20,
        callOpenInterest: 1,
        putOpenInterest: 1,
        callContractsUsed: 1,
        putContractsUsed: 1,
      },
      {
        strike: 110,
        callGex: 40,
        putGex: -20,
        netGex: 20,
        callOpenInterest: 1,
        putOpenInterest: 1,
        callContractsUsed: 1,
        putContractsUsed: 1,
      },
    ];
    const zero = deriveZeroDte(
      "2026-07-29",
      [
        {
          expiry: "2026-07-29",
          status: "available",
          callGex: 30,
          putGex: -10,
          netGex: 20,
          contractsUsed: 2,
          contractsSkipped: 0,
        },
        {
          expiry: "2026-08-21",
          status: "available",
          callGex: 40,
          putGex: -20,
          netGex: 20,
          contractsUsed: 2,
          contractsSkipped: 0,
        },
      ],
      byStrike,
    );
    expect(zero.shareOfGrossGex).toBeCloseTo(40 / 100, 10);
    expect(zero.shareOfGrossGex).toBeLessThanOrEqual(1);
  });
});

describe("M4-1A fixture parse never silently drops bad rows", () => {
  it("throws on malformed contract rows", () => {
    expect(() =>
      parseOptionsChainFixture({
        underlying: "SPX",
        asOf: "2026-07-29T14:30:00.000Z",
        sessionDate: "2026-07-29",
        spot: 100,
        dataDelay: "fixture",
        source: {
          provider: "fixture",
          name: "t",
          fetchedAt: "2026-07-29T14:30:00.000Z",
        },
        contracts: [{ strike: 100 }],
        synthetic: true,
      }),
    ).toThrow(/contracts\[0\]/);
  });

  it("throws on invalid dataDelay", () => {
    expect(() =>
      parseOptionsChainFixture({
        underlying: "SPX",
        asOf: "2026-07-29T14:30:00.000Z",
        sessionDate: "2026-07-29",
        spot: 100,
        dataDelay: "stale_cache",
        source: {
          provider: "fixture",
          name: "t",
          fetchedAt: "2026-07-29T14:30:00.000Z",
        },
        contracts: [],
        synthetic: true,
      }),
    ).toThrow(/dataDelay/);
  });

  it("throws on invalid sessionDate / asOf", () => {
    expect(() =>
      parseOptionsChainFixture({
        underlying: "SPX",
        asOf: "not-a-date",
        sessionDate: "2026-07-29",
        spot: 100,
        dataDelay: "fixture",
        source: {
          provider: "fixture",
          name: "t",
          fetchedAt: "2026-07-29T14:30:00.000Z",
        },
        contracts: [],
        synthetic: true,
      }),
    ).toThrow(/asOf/);

    expect(() =>
      parseOptionsChainFixture({
        underlying: "SPX",
        asOf: "2026-07-29T14:30:00.000Z",
        sessionDate: "07/29/2026",
        spot: 100,
        dataDelay: "fixture",
        source: {
          provider: "fixture",
          name: "t",
          fetchedAt: "2026-07-29T14:30:00.000Z",
        },
        contracts: [],
        synthetic: true,
      }),
    ).toThrow(/sessionDate/);
  });
});

describe("M4-1A walls and status", () => {
  it("returns partial when either wall is unavailable", () => {
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
        ],
      }),
    );
    expect(out.callWall.status).toBe("available");
    expect(out.putWall.status).toBe("unavailable");
    expect(out.status).toBe("partial");
  });

  it("does not fabricate walls for all-zero GEX chains", () => {
    const out = computeEstimatedGammaStructure(
      chain({
        contracts: [
          contract({
            strike: 100,
            right: "call",
            expiry: "2026-07-29",
            openInterest: 0,
            gamma: 0.01,
          }),
          contract({
            strike: 90,
            right: "put",
            expiry: "2026-07-29",
            openInterest: 10,
            gamma: 0,
          }),
        ],
      }),
    );
    expect(out.coverage.contractsUsed).toBe(2);
    expect(out.totalGex).toBe(0);
    expect(out.callWall.status).toBe("unavailable");
    expect(out.putWall.status).toBe("unavailable");
    expect(out.status).toBe("partial");
    expect(out.gammaRegime).toBe("near_zero");
  });

  it("breaks call-wall ties at lowest strike and put-wall ties at highest strike", () => {
    const byStrike = [
      {
        strike: 100,
        callGex: 50,
        putGex: -40,
        netGex: 10,
        callOpenInterest: 1,
        putOpenInterest: 1,
        callContractsUsed: 1,
        putContractsUsed: 1,
      },
      {
        strike: 110,
        callGex: 50,
        putGex: -40,
        netGex: 10,
        callOpenInterest: 1,
        putOpenInterest: 1,
        callContractsUsed: 1,
        putContractsUsed: 1,
      },
    ];
    expect(deriveCallWall(byStrike).strike).toBe(100);
    expect(derivePutWall(byStrike).strike).toBe(110);
  });
});
