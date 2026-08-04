import { describe, expect, it } from "vitest";
import type { FetchLike } from "@/ingest/http";
import { PUBLIC_DEMO_BANNER } from "@/desk/public-demo";
import {
  categorizeNewsItem,
  distributeNewsItems,
  fetchAlpacaNewsArticles,
  loadMarketNewsPanel,
  loadSyntheticMarketNewsPanel,
  mapAlpacaNewsArticle,
  resolveNewsSymbolQuery,
  resolveNewsWatchlistExtras,
  toAlpacaNewsSymbol,
} from "@/news";
import { createAlpacaClient, loadAlpacaClientConfig } from "@/alpaca";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockFetch(
  handler: (url: string) => Response | Promise<Response>,
): FetchLike {
  return (url) => Promise.resolve(handler(String(url)));
}

const CREDS = { keyId: "test-key", secretKey: "test-secret" };

const sampleNews = {
  id: 12345,
  headline: "SPY rises as mega-cap earnings beat",
  summary: "Equity ETFs gained after earnings beats.",
  source: "benzinga",
  created_at: "2026-08-04T15:00:00.000Z",
  updated_at: "2026-08-04T15:01:00.000Z",
  symbols: ["SPY", "QQQ"],
  url: "https://example.com/spy-rises",
};

const cryptoNews = {
  id: 12346,
  headline: "Bitcoin steadies above key level",
  summary: "Crypto markets hold range.",
  source: "benzinga",
  created_at: "2026-08-04T14:00:00.000Z",
  updated_at: "2026-08-04T14:00:00.000Z",
  symbols: ["BTCUSD"],
  url: "https://example.com/btc-steadies",
};

const watchlistNews = {
  id: 12347,
  headline: "Small caps lag on rates debate",
  summary: "IWM underperforms large caps.",
  source: "benzinga",
  created_at: "2026-08-04T13:00:00.000Z",
  updated_at: "2026-08-04T13:00:00.000Z",
  symbols: ["IWM"],
  url: "https://example.com/iwm-lags",
};

const macroNews = {
  id: 12348,
  headline: "Fed officials emphasize data dependence",
  summary: "Macro headline without ticker symbols.",
  source: "benzinga",
  created_at: "2026-08-04T12:00:00.000Z",
  updated_at: "2026-08-04T12:00:00.000Z",
  symbols: [],
  url: "https://example.com/fed-data-dependent",
};

describe("news symbol helpers", () => {
  it("maps portfolio crypto symbols for Alpaca news queries", () => {
    expect(toAlpacaNewsSymbol("BTC/USD")).toBe("BTCUSD");
    expect(toAlpacaNewsSymbol("SPY")).toBe("SPY");
  });

  it("builds symbol query from core + watchlist env", () => {
    const query = resolveNewsSymbolQuery({
      ALPACA_WATCHLIST: "IWM, TLT",
    } as unknown as NodeJS.ProcessEnv);
    expect(query).toContain("SPY");
    expect(query).toContain("QQQ");
    expect(query).toContain("BTCUSD");
    expect(query).toContain("IWM");
    expect(resolveNewsWatchlistExtras({
      ALPACA_WATCHLIST: "IWM, SPY",
    } as unknown as NodeJS.ProcessEnv)).toEqual(["IWM", "SPY"]);
  });
});

describe("mapAlpacaNewsArticle", () => {
  it("normalizes article fields without leaking credentials", () => {
    const item = mapAlpacaNewsArticle(
      sampleNews,
      new Date("2026-08-04T16:00:00.000Z"),
    );
    expect(item.id).toBe("12345");
    expect(item.symbols).toEqual(["SPY", "QQQ"]);
    expect(item.url).toBe("https://example.com/spy-rises");
    expect(item.itemSource).toBe("alpaca");
    expect(item.status).toBe("available");
    expect(JSON.stringify(item)).not.toMatch(/test-secret/);
  });

  it("labels stale headlines", () => {
    const item = mapAlpacaNewsArticle(
      {
        ...sampleNews,
        created_at: "2026-08-01T10:00:00.000Z",
        updated_at: "2026-08-01T10:00:00.000Z",
      },
      new Date("2026-08-04T16:00:00.000Z"),
      24 * 60 * 60 * 1000,
    );
    expect(item.status).toBe("stale");
  });
});

describe("categorizeNewsItem", () => {
  it("routes headlines into indices, crypto, and watchlist topics", () => {
    const indices = categorizeNewsItem(
      mapAlpacaNewsArticle(sampleNews, new Date("2026-08-04T16:00:00.000Z")),
      ["IWM"],
    );
    expect(indices).toEqual(["indices"]);

    const crypto = categorizeNewsItem(
      mapAlpacaNewsArticle(cryptoNews, new Date("2026-08-04T16:00:00.000Z")),
      ["IWM"],
    );
    expect(crypto).toEqual(["crypto"]);

    const watchlist = categorizeNewsItem(
      mapAlpacaNewsArticle(watchlistNews, new Date("2026-08-04T16:00:00.000Z")),
      ["IWM"],
    );
    expect(watchlist).toEqual(["watchlist"]);
  });
});

describe("fetchAlpacaNewsArticles", () => {
  it("requests Alpaca news without include_content", async () => {
    let requestedUrl = "";
    const client = createAlpacaClient({
      config: loadAlpacaClientConfig({} as NodeJS.ProcessEnv, {
        credentials: CREDS,
      }),
      fetchImpl: mockFetch((url) => {
        requestedUrl = url;
        return jsonResponse(200, { news: [sampleNews], next_page_token: null });
      }),
    });

    const items = await fetchAlpacaNewsArticles({
      client,
      symbols: "SPY,QQQ",
      limit: 10,
    });

    expect(requestedUrl).toContain("/v1beta1/news");
    expect(requestedUrl).toContain("symbols=SPY%2CQQQ");
    expect(requestedUrl).toContain("include_content=false");
    expect(items).toHaveLength(1);
    expect(items[0]?.headline).toMatch(/SPY rises/);
  });
});

describe("loadMarketNewsPanel", () => {
  it("serves labelled synthetic fixtures in public demo", async () => {
    const panel = await loadMarketNewsPanel({
      env: { GAMMADESK_PUBLIC_DEMO: "1" } as unknown as NodeJS.ProcessEnv,
      now: new Date("2026-08-04T16:00:00.000Z"),
    });

    expect(panel.status).toBe("synthetic_demo");
    expect(panel.message).toBe(PUBLIC_DEMO_BANNER);
    expect(panel.provider).toBe("synthetic_demo");
    expect(panel.sections.map((s) => s.topic)).toEqual([
      "macro",
      "indices",
      "crypto",
      "watchlist",
    ]);
    expect(panel.sections.every((s) => s.status === "ready")).toBe(true);
    expect(JSON.stringify(panel)).not.toMatch(/APCA_/);
  });

  it("returns explicit unavailable state when Alpaca is not configured", async () => {
    const panel = await loadMarketNewsPanel({
      env: {} as NodeJS.ProcessEnv,
      now: new Date("2026-08-04T16:00:00.000Z"),
    });

    expect(panel.status).toBe("not_configured");
    expect(panel.provider).toBe("unavailable");
    expect(panel.sections.every((s) => s.status === "unavailable")).toBe(true);
    expect(panel.message).toMatch(/not configured/i);
  });

  it("loads live headlines when Alpaca credentials are present", async () => {
    const panel = await loadMarketNewsPanel({
      env: {
        APCA_API_KEY_ID: "test-key",
        APCA_API_SECRET_KEY: "test-secret",
        ALPACA_WATCHLIST: "IWM",
      } as unknown as NodeJS.ProcessEnv,
      now: new Date("2026-08-04T16:00:00.000Z"),
      fetchImpl: mockFetch((url) => {
        if (!url.includes("/v1beta1/news")) {
          return jsonResponse(404, { message: "not found" });
        }
        if (url.includes("symbols=")) {
          return jsonResponse(200, {
            news: [sampleNews, cryptoNews, watchlistNews],
            next_page_token: null,
          });
        }
        return jsonResponse(200, {
          news: [macroNews],
          next_page_token: null,
        });
      }),
    });

    expect(panel.status).toBe("ready");
    expect(panel.provider).toBe("alpaca");
    expect(panel.sections.find((s) => s.topic === "macro")?.items).toHaveLength(1);
    expect(panel.sections.find((s) => s.topic === "indices")?.items[0]?.symbols).toContain(
      "SPY",
    );
    expect(panel.sections.find((s) => s.topic === "crypto")?.items[0]?.symbols).toContain(
      "BTC/USD",
    );
    expect(panel.sections.find((s) => s.topic === "watchlist")?.items[0]?.symbols).toContain(
      "IWM",
    );
  });

  it("surfaces Alpaca auth errors without leaking secrets", async () => {
    const panel = await loadMarketNewsPanel({
      env: {
        APCA_API_KEY_ID: "test-key",
        APCA_API_SECRET_KEY: "test-secret",
      } as unknown as NodeJS.ProcessEnv,
      fetchImpl: mockFetch(() =>
        jsonResponse(401, { message: "unauthorized" }),
      ),
    });

    expect(panel.status).toBe("error");
    expect(panel.message).toMatch(/credentials/i);
    expect(JSON.stringify(panel)).not.toMatch(/test-secret/);
  });
});

describe("loadSyntheticMarketNewsPanel", () => {
  it("marks every headline as synthetic demo", () => {
    const panel = loadSyntheticMarketNewsPanel({
      fetchedAt: "2026-08-04T16:00:00.000Z",
    });
    expect(panel.status).toBe("synthetic_demo");
    expect(
      panel.sections.flatMap((section) => section.items).every(
        (item) => item.itemSource === "synthetic_demo",
      ),
    ).toBe(true);
  });
});

describe("distributeNewsItems", () => {
  it("deduplicates ids within each section bucket", () => {
    const item = mapAlpacaNewsArticle(sampleNews, new Date("2026-08-04T16:00:00.000Z"));
    const buckets = distributeNewsItems({
      macroItems: [mapAlpacaNewsArticle(macroNews, new Date("2026-08-04T16:00:00.000Z"))],
      symbolItems: [item, item],
      watchlistExtras: ["IWM"],
    });
    expect(buckets.indices).toHaveLength(1);
  });
});
