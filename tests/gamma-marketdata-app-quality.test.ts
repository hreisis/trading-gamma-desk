import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  computeEstimatedGammaStructure,
  isSuspectVendorGreeks,
  normalizeMarketDataAppChain,
  scoreChain,
} from "@/gamma";

const FIXTURE = join(
  process.cwd(),
  "fixtures/gamma/providers/marketdata-app/spy-greek-boundary.json",
);

const META = {
  sessionDate: "2026-07-30",
  fetchedAt: "2026-07-30T20:00:00.000Z",
  dataDelay: "unknown" as const,
  sourceName: "fixtures/spy-greek-boundary",
  synthetic: true,
};

function loadBoundaryChain() {
  const body = JSON.parse(readFileSync(FIXTURE, "utf8"));
  return normalizeMarketDataAppChain({
    httpStatus: 203,
    body,
    ...META,
  });
}

describe("MarketData.app Greek data-quality guard", () => {
  it("flags suspect_vendor_greeks only on collapsed delta/IV with gamma=0 and OI>0", () => {
    expect(
      isSuspectVendorGreeks({
        openInterest: 23183,
        gamma: 0,
        delta: -1.0,
        iv: 0.0001,
      }),
    ).toBe(true);
    expect(
      isSuspectVendorGreeks({
        openInterest: 500,
        gamma: 0,
        delta: -0.5,
        iv: 0.15,
      }),
    ).toBe(false);
    expect(
      isSuspectVendorGreeks({
        openInterest: 0,
        gamma: 0,
        delta: -1.0,
        iv: 0.0001,
      }),
    ).toBe(false);
  });

  it("reproduces SPY 743–750 boundary: usable 743/744 puts, suspect collapsed 745+ puts", () => {
    const chain = loadBoundaryChain();
    const dq = chain.dataQuality!;

    expect(dq.suspectVendorGreeksCount).toBe(5);
    expect(dq.nonNullGammaCount).toBe(17);
    expect(dq.usableGammaCount).toBe(12);

    const audit743 = dq.contractAudits.find(
      (a) => a.symbol === "SPY260731P00743000",
    )!;
    expect(audit743.excludedFromGex).toBe(false);
    expect(audit743.issueCodes).not.toContain("suspect_vendor_greeks");
    expect(
      chain.contracts.find((c) => c.symbol === "SPY260731P00743000")!.gamma,
    ).toBe(0.098);

    const audit745 = dq.contractAudits.find(
      (a) => a.symbol === "SPY260731P00745000",
    )!;
    expect(audit745.excludedFromGex).toBe(true);
    expect(audit745.issueCodes).toContain("suspect_vendor_greeks");
    expect(
      chain.contracts.find((c) => c.symbol === "SPY260731P00745000")!.gamma,
    ).toBe(0);
    expect(
      chain.contracts.find((c) => c.symbol === "SPY260731P00745000")!
        .openInterest,
    ).toBe(23183);

    const legit751 = dq.contractAudits.find(
      (a) => a.symbol === "SPY260731P00751000",
    )!;
    expect(legit751.excludedFromGex).toBe(false);
    expect(
      chain.contracts.find((c) => c.symbol === "SPY260731P00751000")!.gamma,
    ).toBe(0);
  });

  it("does not flag gamma=0 when IV is above collapsed threshold (746 put)", () => {
    const chain = loadBoundaryChain();
    const audit746 = chain.dataQuality!.contractAudits.find(
      (a) => a.symbol === "SPY260731P00746000",
    )!;
    expect(audit746.excludedFromGex).toBe(false);
    expect(audit746.issueCodes).not.toContain("suspect_vendor_greeks");
  });

  it("excludes suspect contracts from GEX but keeps legitimate gamma=0 usable", () => {
    const chain = loadBoundaryChain();
    const { used, skipped, skipReasons } = scoreChain(chain);

    expect(skipReasons.suspect_vendor_greeks).toBe(5);
    expect(skipped.some((s) => s.contract.symbol === "SPY260731P00745000")).toBe(
      true,
    );
    expect(skipped.some((s) => s.contract.symbol === "SPY260731P00746000")).toBe(
      false,
    );
    expect(used.some((u) => u.contract.symbol === "SPY260731P00746000")).toBe(
      true,
    );
    expect(used.some((u) => u.contract.symbol === "SPY260731P00743000")).toBe(
      true,
    );
    expect(used.some((u) => u.contract.symbol === "SPY260731P00751000")).toBe(
      true,
    );
    expect(
      used.find((u) => u.contract.symbol === "SPY260731P00751000")!.gex,
    ).toBe(0);
  });

  it("records quote_below_intrinsic as diagnostic without exclusion", () => {
    const chain = loadBoundaryChain();
    const deepItmPut = chain.dataQuality!.contractAudits.find(
      (a) => a.symbol === "SPY260731P00750000",
    )!;
    expect(deepItmPut.issueCodes).toContain("quote_below_intrinsic");
    expect(deepItmPut.issueCodes).toContain("suspect_vendor_greeks");
    expect(deepItmPut.intrinsicValue).toBeGreaterThan(deepItmPut.ask!);
  });

  it("marks engine output incomplete with coverage metrics when suspects present", () => {
    const chain = loadBoundaryChain();
    const out = computeEstimatedGammaStructure(chain);

    expect(out.status).toBe("incomplete");
    expect(out.coverage.nonNullGammaCount).toBe(17);
    expect(out.coverage.usableGammaCount).toBe(12);
    expect(out.coverage.suspectVendorGreeksCount).toBe(5);
    expect(out.coverage.nonNullGammaCoveragePct).toBeCloseTo(100, 0);
    expect(out.coverage.usableGammaCoveragePct).toBeCloseTo(70.59, 1);
    expect(out.limitations.some((l) => /suspect_vendor_greeks/i.test(l))).toBe(
      true,
    );
    expect(out.putWall.status).toBe("incomplete");
    expect(out.putWall.strike).toBe(743);
    expect(out.totalGex).not.toBeNull();
  });

  it("remains available and complete when no suspect exclusions", () => {
    const body = JSON.parse(readFileSync(FIXTURE, "utf8")) as Record<
      string,
      unknown
    >;
    const trimmed = {
      ...body,
      optionSymbol: ["SPY260731C00743000", "SPY260731P00743000"],
      underlying: ["SPY", "SPY"],
      side: ["call", "put"],
      strike: [743, 743],
      expiration: [1785615300, 1785615300],
      openInterest: [4292, 43597],
      volume: [100, 100],
      gamma: [0.0473, 0.098],
      iv: [0.216, 0.0995],
      delta: [0.4396, -0.6328],
      ask: [2.73, 2.3],
      underlyingPrice: [741.63, 741.63],
      updated: [1785441600, 1785441600],
    };
    const chain = normalizeMarketDataAppChain({
      httpStatus: 203,
      body: trimmed,
      ...META,
    });
    const out = computeEstimatedGammaStructure(chain);
    expect(out.status).toBe("available");
    expect(out.coverage.suspectVendorGreeksCount).toBe(0);
  });
});
