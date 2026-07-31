import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MarketDataAppNormalizeError,
  MARKETDATA_APP_OPTIONS_MULTIPLIER,
  normalizeMarketDataAppChain,
  parseOptionsChainFixture,
} from "@/gamma";

const FIXTURE_ROOT = join(
  process.cwd(),
  "fixtures",
  "gamma",
  "providers",
  "marketdata-app",
);

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURE_ROOT, name), "utf8"));
}

const META = {
  sessionDate: "2026-07-30",
  fetchedAt: "2026-07-30T20:00:00.000Z",
  dataDelay: "eod" as const,
  sourceName: "fixtures/gamma/providers/marketdata-app/spy-minimal.ok.json",
};

describe("MarketData.app option-chain normalizer", () => {
  it("maps parallel arrays into OptionsChainSnapshot", () => {
    const body = loadFixture("spy-minimal.ok.json");
    const chain = normalizeMarketDataAppChain({
      httpStatus: 203,
      body,
      ...META,
      synthetic: true,
    });

    expect(chain.kind).toBe("OptionsChainSnapshot");
    expect(chain.underlying).toBe("SPY");
    expect(chain.spot).toBe(741.69);
    expect(chain.asOf).toBe("2026-07-30T20:00:00.000Z");
    expect(chain.source.provider).toBe("marketdata_app");
    expect(chain.contracts).toHaveLength(3);

    expect(chain.contracts[0]).toEqual({
      symbol: "SPY260730C00500000",
      underlying: "SPY",
      right: "call",
      strike: 500,
      expiry: "2026-07-30",
      openInterest: 0,
      volume: 0,
      gamma: null,
      iv: null,
      multiplier: MARKETDATA_APP_OPTIONS_MULTIPLIER,
    });

    expect(chain.contracts[1]).toMatchObject({
      symbol: "SPY260730P00500000",
      right: "put",
      openInterest: 120,
      gamma: 0.0012,
      iv: 0.18,
    });

    expect(chain.contracts[2]).toMatchObject({
      symbol: "SPY260801C00600000",
      expiry: "2026-08-01",
      openInterest: null,
      gamma: 0.0009,
    });

    expect(parseOptionsChainFixture(chain)).toEqual(chain);
  });

  it("accepts any HTTP 2xx when body.s is ok", () => {
    const body = loadFixture("spy-minimal.ok.json");
    for (const httpStatus of [200, 203, 204]) {
      expect(() =>
        normalizeMarketDataAppChain({ httpStatus, body, ...META }),
      ).not.toThrow();
    }
  });

  it("rejects non-2xx HTTP status", () => {
    const body = loadFixture("spy-minimal.ok.json");
    expect(() =>
      normalizeMarketDataAppChain({ httpStatus: 401, body, ...META }),
    ).toThrow(MarketDataAppNormalizeError);
    expect(() =>
      normalizeMarketDataAppChain({ httpStatus: 401, body, ...META }),
    ).toThrow(/HTTP 401/);
  });

  it("rejects s=no_data and vendor error responses", () => {
    expect(() =>
      normalizeMarketDataAppChain({
        httpStatus: 200,
        body: loadFixture("no-data.json"),
        ...META,
      }),
    ).toThrow(/s=no_data/);

    expect(() =>
      normalizeMarketDataAppChain({
        httpStatus: 200,
        body: loadFixture("vendor-error.json"),
        ...META,
      }),
    ).toThrow(/Invalid token header/);
  });

  it("rejects parallel array length mismatch", () => {
    const body = loadFixture("spy-minimal.ok.json") as Record<string, unknown>;
    expect(() =>
      normalizeMarketDataAppChain({
        httpStatus: 200,
        body: {
          ...body,
          strike: [500, 500],
        },
        ...META,
      }),
    ).toThrow(/length mismatch/i);
  });

  it("rejects negative and non-finite numeric values", () => {
    const base = loadFixture("spy-minimal.ok.json") as Record<string, unknown>;

    expect(() =>
      normalizeMarketDataAppChain({
        httpStatus: 200,
        body: { ...base, strike: [-1, 500, 600] },
        ...META,
      }),
    ).toThrow(/strike must be a finite number > 0/);

    expect(() =>
      normalizeMarketDataAppChain({
        httpStatus: 200,
        body: { ...base, gamma: [Number.NaN, 0.0012, 0.0009] },
        ...META,
      }),
    ).toThrow(/gamma must be null or a finite number >= 0/);

    expect(() =>
      normalizeMarketDataAppChain({
        httpStatus: 200,
        body: { ...base, openInterest: [-1, 120, null] },
        ...META,
      }),
    ).toThrow(/openInterest must be null or a finite number >= 0/);
  });

  it("preserves null gamma and openInterest without coercing to zero", () => {
    const chain = normalizeMarketDataAppChain({
      httpStatus: 203,
      body: loadFixture("spy-minimal.ok.json"),
      ...META,
    });
    expect(chain.contracts[0]!.gamma).toBeNull();
    expect(chain.contracts[0]!.openInterest).toBe(0);
    expect(chain.contracts[2]!.openInterest).toBeNull();
  });

  it("requires one consistent underlying", () => {
    const body = loadFixture("spy-minimal.ok.json") as Record<string, unknown>;
    expect(() =>
      normalizeMarketDataAppChain({
        httpStatus: 200,
        body: {
          ...body,
          underlying: ["SPY", "QQQ", "SPY"],
        },
        ...META,
      }),
    ).toThrow(/underlying mismatch/i);
  });

  it("requires materially consistent spot across rows", () => {
    const body = loadFixture("spy-minimal.ok.json") as Record<string, unknown>;
    expect(() =>
      normalizeMarketDataAppChain({
        httpStatus: 200,
        body: {
          ...body,
          underlyingPrice: [741.69, 800, 741.69],
        },
        ...META,
      }),
    ).toThrow(/underlyingPrice materially inconsistent/i);
  });

  it("is deterministic for identical input", () => {
    const body = loadFixture("spy-minimal.ok.json");
    const a = normalizeMarketDataAppChain({ httpStatus: 203, body, ...META });
    const b = normalizeMarketDataAppChain({ httpStatus: 203, body, ...META });
    expect(a).toEqual(b);
  });
});
