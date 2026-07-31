import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_EXPECTED_CONTRACTS,
  parseGammaFetchArgs,
  planBoundedStrikeRange,
  runBoundedGammaProvider,
} from "@/gamma";

const FIXTURE_ROOT = join(
  process.cwd(),
  "fixtures/gamma/providers/marketdata-app",
);

function loadJson(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURE_ROOT, name), "utf8"));
}

function mockFetch(
  impl: (url: string, init?: RequestInit) => Promise<Response>,
): typeof fetch {
  return impl as unknown as typeof fetch;
}

function jsonResponse(
  status: number,
  body: unknown,
  headers?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "x-api-ratelimit-consumed": "16",
      "x-api-ratelimit-remaining": "9800",
      ...headers,
    },
  });
}

const TOKEN = "test-token-not-a-secret-value-xyz";

describe("bounded strike planning", () => {
  it("rejects invalid strike ranges and non-positive steps", () => {
    expect(() =>
      planBoundedStrikeRange({ strikeMin: 780, strikeMax: 700 }),
    ).toThrow(/strike-min/);
    expect(() =>
      planBoundedStrikeRange({
        strikeMin: 700,
        strikeMax: 780,
        strikeStep: 0,
      }),
    ).toThrow(/strike-step/);
    expect(() =>
      planBoundedStrikeRange({
        strikeMin: 700,
        strikeMax: 780,
        strikeStep: -1,
      }),
    ).toThrow(/strike-step/);
  });

  it("rejects ranges above the safety cap without override", () => {
    // 81 strikes × 2 = 162; cap at 100 forces rejection.
    expect(() =>
      planBoundedStrikeRange({
        strikeMin: 700,
        strikeMax: 780,
        strikeStep: 1,
        maxExpectedContracts: 100,
      }),
    ).toThrow(/safety cap/);
    expect(DEFAULT_MAX_EXPECTED_CONTRACTS).toBe(250);
  });

  it("allows above-cap when explicitly overridden", () => {
    const plan = planBoundedStrikeRange({
      strikeMin: 700,
      strikeMax: 780,
      strikeStep: 1,
      maxExpectedContracts: 100,
      allowAboveCap: true,
    });
    expect(plan.strikeCount).toBe(81);
    expect(plan.estimatedMaxContracts).toBe(162);
  });
});

describe("gamma:fetch CLI args", () => {
  it("parses required and optional flags", () => {
    const args = parseGammaFetchArgs([
      "--symbol",
      "spy",
      "--expiration",
      "2026-07-31",
      "--strike-min",
      "743",
      "--strike-max",
      "750",
      "--strike-step=1",
      "--allow-above-cap",
    ]);
    expect(args.symbol).toBe("SPY");
    expect(args.expiration).toBe("2026-07-31");
    expect(args.strikeMin).toBe(743);
    expect(args.strikeMax).toBe(750);
    expect(args.allowAboveCap).toBe(true);
  });
});

describe("bounded MarketData.app Gamma provider", () => {
  it("succeeds on HTTP 203 + body.s=ok and uses vendor updated as asOf", async () => {
    const body = loadJson("spy-greek-boundary.json");
    const wallClock = "2026-08-01T12:00:00.000Z";
    const dataRoot = mkdtempSync(join(tmpdir(), "gamma-md-"));

    const result = await runBoundedGammaProvider({
      symbol: "SPY",
      expiration: "2026-07-31",
      strikeMin: 743,
      strikeMax: 751,
      strikeStep: 1,
      allowAboveCap: true,
      token: TOKEN,
      dataRoot,
      write: true,
      generatedAt: wallClock,
      fetchedAt: wallClock,
      fetchImpl: mockFetch(async () => jsonResponse(203, body)),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.snapshot.httpStatus).toBe(203);
    expect(result.snapshot.vendorAsOf).toBe("2026-07-30T20:00:00.000Z");
    expect(result.snapshot.vendorUpdatedMin).toBe(
      "2026-07-30T20:00:00.000Z",
    );
    expect(result.snapshot.vendorAsOf).not.toBe(wallClock);
    expect(result.snapshot.sessionDate).toBe("2026-07-30");
    expect(result.snapshot.dte).toBe(1);
    expect(result.snapshot.zeroDte.status).toBe("unavailable");
    expect(result.snapshot.scope).toBe("bounded_single_expiry");
    expect(result.snapshot.boundedCallWall.scope).toBe(
      "bounded_single_expiry",
    );
    expect(result.snapshot.boundedPutWall.scope).toBe(
      "bounded_single_expiry",
    );
    expect(result.snapshot.limitations.some((l) => /not full-chain/i.test(l))).toBe(
      true,
    );
    expect(result.snapshot.credits.consumed).toBe(16);
    expect(result.path).toBeTruthy();
    expect(existsSync(result.path!)).toBe(true);

    const onDisk = JSON.parse(readFileSync(result.path!, "utf8"));
    expect(JSON.stringify(onDisk)).not.toContain(TOKEN);
    expect(onDisk.s).toBeUndefined();
    expect(onDisk.optionSymbol).toBeUndefined();
  });

  it("fails clearly when token is absent", async () => {
    const result = await runBoundedGammaProvider({
      symbol: "SPY",
      expiration: "2026-07-31",
      strikeMin: 743,
      strikeMax: 750,
      token: null,
      write: false,
      fetchImpl: mockFetch(async () => {
        throw new Error("fetch should not be called");
      }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("missing_token");
  });

  it("fails on vendor error body without writing", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "gamma-md-"));
    const prior = join(dataRoot, "SPY-bounded-latest.json");
    mkdirSync(dataRoot, { recursive: true });
    writeFileSync(prior, JSON.stringify({ kind: "prior-valid" }) + "\n");

    const result = await runBoundedGammaProvider({
      symbol: "SPY",
      expiration: "2026-07-31",
      strikeMin: 743,
      strikeMax: 750,
      token: TOKEN,
      dataRoot,
      write: true,
      fetchImpl: mockFetch(async () =>
        jsonResponse(200, loadJson("vendor-error.json")),
      ),
    });
    expect(result.ok).toBe(false);
    expect(readFileSync(prior, "utf8")).toContain("prior-valid");
  });

  it("fails on network error", async () => {
    const result = await runBoundedGammaProvider({
      symbol: "SPY",
      expiration: "2026-07-31",
      strikeMin: 743,
      strikeMax: 750,
      token: TOKEN,
      write: false,
      fetchImpl: mockFetch(async () => {
        throw new Error("ECONNRESET");
      }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/network|ECONNRESET/i);
  });

  it("fails on empty / no_data response", async () => {
    const result = await runBoundedGammaProvider({
      symbol: "SPY",
      expiration: "2026-07-31",
      strikeMin: 743,
      strikeMax: 750,
      token: TOKEN,
      write: false,
      fetchImpl: mockFetch(async () =>
        jsonResponse(200, loadJson("no-data.json")),
      ),
    });
    expect(result.ok).toBe(false);
  });

  it("fails on malformed non-JSON response", async () => {
    const result = await runBoundedGammaProvider({
      symbol: "SPY",
      expiration: "2026-07-31",
      strikeMin: 743,
      strikeMax: 750,
      token: TOKEN,
      write: false,
      fetchImpl: mockFetch(async () => new Response("not-json", { status: 200 })),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/not JSON|malformed/i);
  });

  it("does not mislabel 1DTE as 0DTE", async () => {
    const result = await runBoundedGammaProvider({
      symbol: "SPY",
      expiration: "2026-07-31",
      strikeMin: 743,
      strikeMax: 750,
      token: TOKEN,
      write: false,
      fetchImpl: mockFetch(async () =>
        jsonResponse(203, loadJson("spy-greek-boundary.json")),
      ),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.dte).toBe(1);
    expect(result.snapshot.zeroDte.status).toBe("unavailable");
    expect(result.snapshot.sessionDate).not.toBe(result.snapshot.expiration);
  });

  it("keeps suspect_vendor_greeks excluded and serializes incomplete coverage", async () => {
    const result = await runBoundedGammaProvider({
      symbol: "SPY",
      expiration: "2026-07-31",
      strikeMin: 743,
      strikeMax: 751,
      token: TOKEN,
      write: false,
      fetchImpl: mockFetch(async () =>
        jsonResponse(203, loadJson("spy-greek-boundary.json")),
      ),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.status).toBe("incomplete");
    expect(result.snapshot.coverage.suspectVendorGreeksCount).toBeGreaterThan(0);
    expect(result.snapshot.coverage.skipReasons.suspect_vendor_greeks).toBeGreaterThan(
      0,
    );
    expect(result.snapshot.coverage.usableGammaCount).toBeLessThan(
      result.snapshot.coverage.nonNullGammaCount ?? 0,
    );
    expect(result.snapshot.boundedPutWall.status).toBe("incomplete");
  });

  it("does not overwrite a prior valid snapshot on failed runs", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "gamma-md-"));
    const priorPath = join(dataRoot, "SPY-bounded-latest.json");
    const priorPayload = { kind: "BoundedGammaProviderSnapshot", marker: "keep-me" };
    writeFileSync(priorPath, JSON.stringify(priorPayload) + "\n");

    const failed = await runBoundedGammaProvider({
      symbol: "SPY",
      expiration: "2026-07-31",
      strikeMin: 743,
      strikeMax: 750,
      token: TOKEN,
      dataRoot,
      write: true,
      fetchImpl: mockFetch(async () => {
        throw new Error("network down");
      }),
    });
    expect(failed.ok).toBe(false);
    expect(JSON.parse(readFileSync(priorPath, "utf8")).marker).toBe("keep-me");
  });

  it("keeps token out of requestPath and serialized snapshot", async () => {
    const result = await runBoundedGammaProvider({
      symbol: "SPY",
      expiration: "2026-07-31",
      strikeMin: 743,
      strikeMax: 750,
      token: TOKEN,
      write: false,
      fetchImpl: mockFetch(async (url, init) => {
        expect(url).not.toContain(TOKEN);
        const headers = init?.headers as Record<string, string>;
        expect(headers.Authorization?.startsWith("Bearer ")).toBe(true);
        return jsonResponse(203, loadJson("spy-minimal.ok.json"));
      }),
    });
    // spy-minimal may lack delta → still ok normalize with optional arrays
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.requestPath).not.toContain(TOKEN);
    expect(JSON.stringify(result.snapshot)).not.toContain(TOKEN);
  });

  it("retains compatibility for fixtures without dataQuality when scoring engine alone", async () => {
    // Provider always attaches dataQuality via normalize; engine without dataQuality
    // remains available — covered by existing gamma-gex tests. Here we assert
    // spy-minimal (no delta/ask) still produces a snapshot with optional quality fields.
    const result = await runBoundedGammaProvider({
      symbol: "SPY",
      expiration: "2026-07-30",
      strikeMin: 500,
      strikeMax: 600,
      strikeStep: 100,
      token: TOKEN,
      write: false,
      fetchImpl: mockFetch(async () =>
        jsonResponse(203, loadJson("spy-minimal.ok.json")),
      ),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.coverage.contractsIn).toBe(3);
    expect(result.snapshot.boundedCallWall.scope).toBe("bounded_single_expiry");
  });
});
