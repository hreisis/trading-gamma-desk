import { describe, expect, it } from "vitest";
import type { FetchLike } from "@/ingest/http";
import {
  AlpacaClientError,
  createAlpacaClient,
  fetchAlpacaMarketQuotes,
  loadAlpacaClientConfig,
  loadAlpacaHealth,
  loadAlpacaMarketPanel,
  resolveAlpacaWatchlist,
} from "@/alpaca";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockFetch(
  handler: (url: string) => Response | Promise<Response>,
): FetchLike {
  return (url) => Promise.resolve(handler(url));
}

const CREDS = { keyId: "test-key", secretKey: "test-secret" };

const stockSnapshot = {
  SPY: {
    latestTrade: { p: 550.25, t: "2026-08-04T19:59:00.000Z" },
    prevDailyBar: { c: 548.1, t: "2026-08-03T00:00:00.000Z" },
    dailyBar: { c: 550.25, t: "2026-08-04T00:00:00.000Z" },
  },
  QQQ: {
    latestTrade: { p: 480.5, t: "2026-08-04T19:59:00.000Z" },
    prevDailyBar: { c: 478.0, t: "2026-08-03T00:00:00.000Z" },
  },
};

const cryptoSnapshot = {
  snapshots: {
    "BTC/USD": {
      latestTrade: { p: 68000, t: "2026-08-04T19:59:00.000Z" },
      prevDailyBar: { c: 67000, t: "2026-08-03T00:00:00.000Z" },
    },
  },
};

describe("resolveAlpacaWatchlist", () => {
  it("includes core symbols and optional watchlist env entries", () => {
    const list = resolveAlpacaWatchlist({
      ALPACA_WATCHLIST: "IWM, TLT, SPY",
    } as unknown as NodeJS.ProcessEnv);
    expect(list).toContain("SPY");
    expect(list).toContain("QQQ");
    expect(list).toContain("BTC/USD");
    expect(list).toContain("IWM");
    expect(list).toContain("TLT");
    expect(list.filter((s) => s === "SPY")).toHaveLength(1);
  });
});

describe("Alpaca client", () => {
  it("returns clear auth errors without leaking credentials", async () => {
    const client = createAlpacaClient({
      config: loadAlpacaClientConfig({} as NodeJS.ProcessEnv, {
        credentials: CREDS,
        timeoutMs: 5000,
      }),
      fetchImpl: mockFetch(() =>
        jsonResponse(401, { message: "unauthorized" }),
      ),
    });

    await expect(client.getJson("/v2/stocks/snapshots")).rejects.toMatchObject({
      code: "auth",
      statusCode: 401,
      message: expect.stringContaining("credentials rejected"),
    });
    await expect(client.getJson("/v2/stocks/snapshots")).rejects.not.toThrow(
      /test-secret/,
    );
  });

  it("classifies SIP feed entitlement 403 separately from invalid credentials", async () => {
    const client = createAlpacaClient({
      config: loadAlpacaClientConfig({} as NodeJS.ProcessEnv, { credentials: CREDS }),
      fetchImpl: mockFetch(() =>
        jsonResponse(403, {
          message: "subscription does not permit querying recent SIP data",
        }),
      ),
    });

    await expect(client.getJson("/v2/stocks/snapshots")).rejects.toMatchObject({
      code: "feed_entitlement",
      statusCode: 403,
      message: expect.stringContaining("feed entitlement"),
    });
  });

  it("surfaces rate limit errors", async () => {
    const client = createAlpacaClient({
      config: loadAlpacaClientConfig({} as NodeJS.ProcessEnv, { credentials: CREDS }),
      fetchImpl: mockFetch(() => jsonResponse(429, { message: "too many" })),
    });

    await expect(client.getJson("/v2/stocks/snapshots")).rejects.toMatchObject({
      code: "rate_limit",
      statusCode: 429,
      message: expect.stringContaining("429"),
    });
  });

  it("times out slow responses", async () => {
    const client = createAlpacaClient({
      config: loadAlpacaClientConfig({} as NodeJS.ProcessEnv, {
        credentials: CREDS,
        timeoutMs: 20,
      }),
      fetchImpl: (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const error = new Error("The operation was aborted");
            error.name = "AbortError";
            reject(error);
          });
        }),
    });

    await expect(client.getJson("/v2/stocks/snapshots")).rejects.toMatchObject({
      code: "timeout",
    });
  });

  it("throws not_configured when credentials are missing", async () => {
    const client = createAlpacaClient({
      config: loadAlpacaClientConfig({} as NodeJS.ProcessEnv, { credentials: null }),
    });
    await expect(client.getJson("/v2/stocks/snapshots")).rejects.toBeInstanceOf(
      AlpacaClientError,
    );
  });
});

describe("fetchAlpacaMarketQuotes", () => {
  it("maps stock and crypto snapshots to quotes", async () => {
    const fetchImpl = mockFetch((url) => {
      if (url.includes("/v2/stocks/snapshots")) {
        return jsonResponse(200, stockSnapshot);
      }
      if (url.includes("/v1beta3/crypto/us/snapshots")) {
        return jsonResponse(200, cryptoSnapshot);
      }
      return jsonResponse(404, { message: "missing" });
    });

    const client = createAlpacaClient({
      config: loadAlpacaClientConfig({} as NodeJS.ProcessEnv, { credentials: CREDS }),
      fetchImpl,
    });

    const quotes = await fetchAlpacaMarketQuotes({
      client,
      config: loadAlpacaClientConfig({} as NodeJS.ProcessEnv, {
        credentials: CREDS,
        staleQuoteMs: 24 * 60 * 60 * 1000,
      }),
      symbols: ["SPY", "QQQ", "BTC/USD"],
      now: new Date("2026-08-04T20:00:00.000Z"),
    });

    expect(quotes).toHaveLength(3);
    expect(quotes[0]?.symbol).toBe("SPY");
    expect(quotes[0]?.latestPrice).toBe(550.25);
    expect(quotes[0]?.source).toBe("alpaca");
    expect(quotes[0]?.status).toBe("available");
    expect(quotes[2]?.symbol).toBe("BTC/USD");
    expect(quotes[2]?.latestPrice).toBe(68000);
  });

  it("marks stale quotes when timestamps are too old", async () => {
    const fetchImpl = mockFetch((url) => {
      if (url.includes("/v2/stocks/snapshots")) {
        return jsonResponse(200, {
          SPY: {
            latestTrade: { p: 100, t: "2026-08-01T15:00:00.000Z" },
            prevDailyBar: { c: 99, t: "2026-07-31T00:00:00.000Z" },
          },
        });
      }
      return jsonResponse(200, {});
    });

    const client = createAlpacaClient({
      config: loadAlpacaClientConfig({} as NodeJS.ProcessEnv, { credentials: CREDS }),
      fetchImpl,
    });

    const quotes = await fetchAlpacaMarketQuotes({
      client,
      config: loadAlpacaClientConfig({} as NodeJS.ProcessEnv, {
        credentials: CREDS,
        staleQuoteMs: 60 * 60 * 1000,
      }),
      symbols: ["SPY"],
      now: new Date("2026-08-04T20:00:00.000Z"),
    });

    expect(quotes[0]?.status).toBe("stale");
  });
});

describe("loadAlpacaMarketPanel", () => {
  it("returns not_configured without Tiingo or fixture fallback", async () => {
    const panel = await loadAlpacaMarketPanel({
      env: {} as NodeJS.ProcessEnv,
      publicDemo: false,
      config: loadAlpacaClientConfig({} as NodeJS.ProcessEnv, { credentials: null }),
    });

    expect(panel.status).toBe("not_configured");
    expect(panel.message).toBe("Alpaca not configured");
    expect(panel.quotes.every((q) => q.source === "unavailable")).toBe(true);
    expect(JSON.stringify(panel)).not.toContain("tiingo");
    expect(JSON.stringify(panel)).not.toContain("fixture");
  });

  it("loads live Alpaca quotes on success", async () => {
    const fetchImpl = mockFetch((url) => {
      if (url.includes("/v2/stocks/snapshots")) {
        return jsonResponse(200, stockSnapshot);
      }
      if (url.includes("/v1beta3/crypto/us/snapshots")) {
        return jsonResponse(200, cryptoSnapshot);
      }
      return jsonResponse(404, {});
    });

    const panel = await loadAlpacaMarketPanel({
      env: { ALPACA_WATCHLIST: "IWM" } as unknown as NodeJS.ProcessEnv,
      publicDemo: false,
      now: new Date("2026-08-04T20:00:00.000Z"),
      config: loadAlpacaClientConfig({} as NodeJS.ProcessEnv, { credentials: CREDS }),
      fetchImpl,
    });

    expect(panel.status).toBe("ready");
    expect(panel.configured).toBe(true);
    expect(panel.quotes.some((q) => q.symbol === "SPY" && q.source === "alpaca")).toBe(
      true,
    );
    expect(panel.watchlist).toContain("IWM");
  });

  it("returns explicit error panel on auth failure", async () => {
    const panel = await loadAlpacaMarketPanel({
      publicDemo: false,
      config: loadAlpacaClientConfig({} as NodeJS.ProcessEnv, { credentials: CREDS }),
      fetchImpl: mockFetch(() => jsonResponse(401, { message: "unauthorized" })),
    });

    expect(panel.status).toBe("error");
    expect(panel.message).toMatch(/credentials rejected/i);
    expect(panel.health.credentialState).toBe("invalid");
    expect(panel.quotes.every((q) => q.status === "unavailable")).toBe(true);
  });

  it("keeps credentials configured on feed entitlement errors", async () => {
    const health = await loadAlpacaHealth({
      publicDemo: false,
      config: loadAlpacaClientConfig({} as NodeJS.ProcessEnv, { credentials: CREDS }),
      fetchImpl: mockFetch(() =>
        jsonResponse(403, {
          message: "subscription does not permit querying recent SIP data",
        }),
      ),
    });

    expect(health.credentialState).toBe("configured");
    expect(health.message).toMatch(/feed entitlement/i);
    expect(health.reachable).toBe(false);
  });

  it("uses synthetic demo fixtures in public demo mode", async () => {
    const panel = await loadAlpacaMarketPanel({
      env: { GAMMADESK_PUBLIC_DEMO: "1" } as unknown as NodeJS.ProcessEnv,
      publicDemo: true,
    });

    expect(panel.status).toBe("synthetic_demo");
    expect(panel.quotes.every((q) => q.source === "synthetic_demo")).toBe(true);
    expect(panel.health.isPublicDemo).toBe(true);
    expect(panel.message).toContain("Synthetic Demo Data");
  });
});

describe("loadAlpacaHealth", () => {
  it("reports missing credentials clearly", async () => {
    const health = await loadAlpacaHealth({
      publicDemo: false,
      config: loadAlpacaClientConfig({} as NodeJS.ProcessEnv, { credentials: null }),
    });

    expect(health.credentialState).toBe("missing");
    expect(health.message).toBe("Alpaca not configured");
    expect(health.reachable).toBe(false);
  });

  it("reports invalid credentials on auth failure", async () => {
    const health = await loadAlpacaHealth({
      publicDemo: false,
      config: loadAlpacaClientConfig({} as NodeJS.ProcessEnv, { credentials: CREDS }),
      fetchImpl: mockFetch(() => jsonResponse(403, {})),
    });

    expect(health.credentialState).toBe("invalid");
    expect(health.reachable).toBe(false);
  });
});
