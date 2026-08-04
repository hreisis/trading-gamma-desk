import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractVendorUpdatedRange } from "@/gamma/marketdata-app/time";
import {
  pickNearestExpirationOnOrAfter,
  resolveBoundedGammaExpiration,
} from "@/gamma/marketdata-app/resolve-expiration";

const FIXTURE_ROOT = join(
  process.cwd(),
  "fixtures/gamma/providers/marketdata-app",
);

function loadJson(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURE_ROOT, name), "utf8"));
}

describe("extractVendorUpdatedRange", () => {
  it("accepts scalar vendor updated metadata timestamps", () => {
    const range = extractVendorUpdatedRange({
      s: "ok",
      updated: 1785441600,
    });
    expect(range.minIso).toBe("2026-07-30T20:00:00.000Z");
    expect(range.maxIso).toBe("2026-07-30T20:00:00.000Z");
  });

  it("accepts parallel-array updated timestamps from chain bodies", () => {
    const body = loadJson("spy-greek-boundary.json");
    const range = extractVendorUpdatedRange(body);
    expect(range.minIso).toBe("2026-07-30T20:00:00.000Z");
    expect(range.maxIso).toBe("2026-07-30T20:00:00.000Z");
  });

  it("rejects absent vendor timestamps", () => {
    expect(() => extractVendorUpdatedRange({ s: "ok" })).toThrow(
      /absent or empty/i,
    );
  });
});

describe("resolveBoundedGammaExpiration", () => {
  it("uses configured GAMMA_BOUNDED_EXPIRATION when set", async () => {
    const resolved = await resolveBoundedGammaExpiration({
      symbol: "SPY",
      sessionDate: "2026-08-04",
      configuredExpiration: "2026-08-08",
      token: "test-token",
    });
    expect(resolved).toEqual({
      expiration: "2026-08-08",
      source: "env",
    });
  });

  it("discovers the nearest expiration on or after the session date", async () => {
    const resolved = await resolveBoundedGammaExpiration({
      symbol: "SPY",
      sessionDate: "2026-08-04",
      token: "test-token",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            s: "ok",
            updated: 1785441600,
            expirations: ["2026-08-01", "2026-08-05", "2026-08-08"],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    });
    expect(resolved.source).toBe("discovered");
    expect(resolved.expiration).toBe("2026-08-05");
  });
});

describe("pickNearestExpirationOnOrAfter", () => {
  it("returns the latest expiration when all are before the session", () => {
    expect(
      pickNearestExpirationOnOrAfter("2026-08-10", [
        "2026-08-01",
        "2026-08-05",
      ]),
    ).toBe("2026-08-05");
  });
});
