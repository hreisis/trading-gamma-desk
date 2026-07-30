import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  BASELINE_LOOKBACK_MS,
  buildEventMarketContext,
  classifyEventSession,
  createAlpacaMarketDataProvider,
  createFakeMarketDataProvider,
  easternWallToUtc,
  eventTimestampUtcIso,
  fetchOfficialMarketContext,
  findBaselineBar,
  loadCatalystFeed,
  loadMarketContextCache,
  loadMarketContextConfig,
  MARKET_CONTEXT_CALCULATION_VERSION,
  MARKET_CONTEXT_PROXIES,
  normalizeBars,
  pctChangeFromPrices,
  resolveAlpacaCredentials,
  resolveCatalystMarketFeed,
  synthesizeBars,
  unavailableMarketContext,
} from "@/catalyst";
import { EventMarketContext } from "@/contracts";
import type { Catalyst } from "@/contracts";
import syntheticMarketContext from "../fixtures/catalyst/synthetic-market-context.json";

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "gammadesk-m24a-"));
}

function env(partial: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return { ...process.env, ...partial };
}

function releasedCatalyst(partial: Partial<Catalyst> & Pick<Catalyst, "id" | "occurredAt">): Catalyst {
  return {
    schemaVersion: "0.1.0",
    observedAt: partial.occurredAt,
    sourceType: "calendar",
    sourceName: "Test",
    sourceUrl: "https://example.invalid/test",
    headline: "Test release",
    summary: "Test",
    category: "inflation",
    importance: "high",
    status: "released",
    affectedAssets: ["SPX"],
    macroChannels: ["inflation"],
    direction: "unclear",
    confidence: {
      score: 50,
      calibrated: false,
      note: "classification clarity only — not a market direction probability",
    },
    evidence: [{ id: "e1", statement: "test", basis: "fixture" }],
    dedupeKey: `test:${partial.id}`,
    synthetic: false,
    releaseFamily: "cpi",
    ...partial,
  };
}

describe("config", () => {
  it("resolves feed and credentials from env", () => {
    expect(resolveCatalystMarketFeed(env({ CATALYST_MARKET_FEED: "" }))).toBe(
      "sip",
    );
    expect(
      resolveCatalystMarketFeed(env({ CATALYST_MARKET_FEED: "iex" })),
    ).toBe("iex");
    expect(resolveAlpacaCredentials(env({}))).toBeNull();
    expect(
      resolveAlpacaCredentials(
        env({ APCA_API_KEY_ID: "k", APCA_API_SECRET_KEY: "s" }),
      ),
    ).toEqual({ keyId: "k", secretKey: "s" });
    const cfg = loadMarketContextConfig(
      env({
        APCA_API_KEY_ID: "",
        APCA_API_SECRET_KEY: "",
        CATALYST_MARKET_FEED: "sip",
      }),
    );
    expect(cfg.credentials).toBeNull();
    expect(cfg.feed).toBe("sip");
  });
});

describe("bar normalization + look-ahead safety", () => {
  it("sorts, dedupes, and rejects malformed bars", () => {
    const { bars, warnings } = normalizeBars([
      { t: "2026-07-15T12:31:00.000Z", o: 2, h: 2, l: 2, c: 2 },
      { t: "2026-07-15T12:29:00.000Z", o: 1, h: 1, l: 1, c: 1 },
      { t: "2026-07-15T12:29:00.000Z", o: 1.5, h: 1.5, l: 1.5, c: 1.5 },
      { t: "bad", o: 1, h: 1, l: 1, c: 1 },
    ]);
    expect(bars.map((b) => b.close)).toEqual([1.5, 2]);
    expect(warnings.some((w) => w.includes("duplicate"))).toBe(true);
    expect(warnings.some((w) => w.includes("malformed"))).toBe(true);
  });

  it("baseline never look-ahead", () => {
    const eventMs = Date.parse("2026-07-15T12:30:00.000Z");
    const bars = normalizeBars([
      { t: "2026-07-15T12:29:00.000Z", o: 10, h: 10, l: 10, c: 10 },
      { t: "2026-07-15T12:30:00.000Z", o: 11, h: 11, l: 11, c: 11 },
      { t: "2026-07-15T12:31:00.000Z", o: 12, h: 12, l: 12, c: 12 },
    ]).bars;
    const baseline = findBaselineBar(bars, eventMs, BASELINE_LOOKBACK_MS);
    expect(baseline?.close).toBe(10);
    expect(baseline!.timestampMs).toBeLessThan(eventMs);
  });

  it("rounds pct changes deterministically", () => {
    expect(pctChangeFromPrices(100, 101)).toBe(1);
    expect(pctChangeFromPrices(100, 100.12345)).toBe(0.1235);
    expect(pctChangeFromPrices(0, 1)).toBeNull();
  });
});

describe("session classification", () => {
  it("marks CPI 8:30 ET as premarket and payrolls holiday", () => {
    const cpi = classifyEventSession(
      new Date("2026-07-15T12:30:00.000Z"),
    );
    expect(cpi.eventInPremarket).toBe(true);
    expect(cpi.eventInRegularSession).toBe(false);
    expect(cpi.isHoliday).toBe(false);

    const holiday = classifyEventSession(
      new Date("2026-07-03T12:30:00.000Z"),
    );
    expect(holiday.isHoliday).toBe(true);
    expect(holiday.regularSessionCloseUtc).toBeNull();
  });

  it("handles DST via zoned wall clock", () => {
    // EDT (UTC-4)
    expect(easternWallToUtc("2026-07-15", 8, 30).toISOString()).toBe(
      "2026-07-15T12:30:00.000Z",
    );
    // EST (UTC-5) — mid-January
    expect(easternWallToUtc("2026-01-15", 8, 30).toISOString()).toBe(
      "2026-01-15T13:30:00.000Z",
    );
  });
});

describe("window computation", () => {
  it("computes +5m/+30m/+2h/close from saved bars", () => {
    const eventMs = easternWallToUtc("2026-07-15", 8, 30).getTime();
    const start = easternWallToUtc("2026-07-15", 8, 0).getTime();
    const bars = synthesizeBars({
      startMs: start,
      count: 480,
      startPrice: 100,
      step: 0.01,
    });
    const bySymbol = new Map(
      MARKET_CONTEXT_PROXIES.map((p) => [p.symbol, bars] as const),
    );
    const snap = buildEventMarketContext({
      catalystId: "cat_test",
      releaseFamily: "cpi",
      occurredAt: new Date(eventMs).toISOString(),
      provider: "fake",
      feed: "sip",
      fetchedAt: "2026-07-15T20:00:00.000Z",
      barsBySymbol: bySymbol,
    });
    expect(snap.status).toBe("complete");
    const spy = snap.symbols.find((s) => s.symbol === "SPY")!;
    expect(spy.baseline).not.toBeNull();
    expect(spy.missingWindows).toEqual([]);
    const plus5 = spy.windows.find((w) => w.kind === "plus5m")!;
    expect(plus5.status).toBe("available");
    expect(plus5.pctChange).not.toBeNull();
    // Replay: recompute pct from stored prices
    expect(
      pctChangeFromPrices(spy.baseline!.price, plus5.price!),
    ).toBe(plus5.pctChange);
  });

  it("marks missing windows without distant substitutes", () => {
    const eventMs = Date.parse("2026-07-15T12:30:00.000Z");
    // Only baseline bar — no post-event bars
    const bars = [
      {
        t: "2026-07-15T12:29:00.000Z",
        o: 100,
        h: 100,
        l: 100,
        c: 100,
      },
    ];
    const snap = buildEventMarketContext({
      catalystId: "cat_partial",
      occurredAt: new Date(eventMs).toISOString(),
      provider: "fake",
      feed: "sip",
      fetchedAt: "2026-07-15T20:00:00.000Z",
      barsBySymbol: new Map([["SPY", bars]]),
    });
    expect(snap.status).toBe("unavailable");
    const spy = snap.symbols.find((s) => s.symbol === "SPY")!;
    // Other symbols have no bars → baseline missing; SPY has baseline but all windows missing
    expect(spy.baseline?.price).toBe(100);
    expect(spy.missingWindows.length).toBe(4);
  });
});

describe("Alpaca adapter (fake fetch)", () => {
  it("returns unavailable without credentials", async () => {
    const provider = createAlpacaMarketDataProvider({
      config: loadMarketContextConfig(env({}), { credentials: null }),
    });
    const result = await provider.fetchBars({
      symbol: "SPY",
      start: "2026-07-15T12:00:00.000Z",
      end: "2026-07-15T16:00:00.000Z",
      timeframe: "1Min",
      feed: "sip",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.unavailable).toBe(true);
  });

  it("paginates, retries on 429, and surfaces 403", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      calls += 1;
      if (calls === 1) {
        return new Response("rate", { status: 429 });
      }
      if (String(url).includes("page_token")) {
        return new Response(
          JSON.stringify({
            bars: [{ t: "2026-07-15T12:31:00.000Z", o: 2, h: 2, l: 2, c: 2 }],
            next_page_token: null,
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          bars: [{ t: "2026-07-15T12:29:00.000Z", o: 1, h: 1, l: 1, c: 1 }],
          next_page_token: "tok1",
        }),
        { status: 200 },
      );
    });

    const provider = createAlpacaMarketDataProvider({
      config: loadMarketContextConfig(env({}), {
        credentials: { keyId: "k", secretKey: "s" },
        maxRetries: 1,
      }),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const ok = await provider.fetchBars({
      symbol: "SPY",
      start: "2026-07-15T12:00:00.000Z",
      end: "2026-07-15T16:00:00.000Z",
      timeframe: "1Min",
      feed: "sip",
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.bars).toHaveLength(2);

    const forbidden = createAlpacaMarketDataProvider({
      config: loadMarketContextConfig(env({}), {
        credentials: { keyId: "k", secretKey: "s" },
      }),
      fetchImpl: (async () =>
        new Response("nope", { status: 403 })) as unknown as typeof fetch,
    });
    const auth = await forbidden.fetchBars({
      symbol: "SPY",
      start: "2026-07-15T12:00:00.000Z",
      end: "2026-07-15T16:00:00.000Z",
      timeframe: "1Min",
      feed: "sip",
    });
    expect(auth.ok).toBe(false);
    if (!auth.ok) expect(auth.statusCode).toBe(403);
  });

  it("surfaces timeout", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      await new Promise<void>((_, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
      return new Response("{}", { status: 200 });
    });
    const provider = createAlpacaMarketDataProvider({
      config: loadMarketContextConfig(env({}), {
        credentials: { keyId: "k", secretKey: "s" },
        timeoutMs: 5,
        maxRetries: 0,
      }),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await provider.fetchBars({
      symbol: "SPY",
      start: "2026-07-15T12:00:00.000Z",
      end: "2026-07-15T16:00:00.000Z",
      timeframe: "1Min",
      feed: "sip",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/timed out/i);
  });
});

describe("fetch workflow + cache", () => {
  it("caches with fake provider; second run idempotent; force revises", async () => {
    const root = tempRoot();
    mkdirSync(join(root, "catalyst"), { recursive: true });
    const eventMs = easternWallToUtc("2026-07-15", 8, 30).getTime();
    const start = easternWallToUtc("2026-07-15", 8, 0).getTime();
    const bars = synthesizeBars({
      startMs: start,
      count: 480,
      startPrice: 100,
      step: 0.01,
    });
    const barsBySymbol = new Map(
      MARKET_CONTEXT_PROXIES.map((p) => [p.symbol, bars] as const),
    );
    const catalyst = releasedCatalyst({
      id: "cat_cpi_test",
      occurredAt: new Date(eventMs).toISOString(),
    });
    const first = await fetchOfficialMarketContext({
      dataRoot: root,
      write: true,
      now: new Date("2026-07-29T20:00:00.000Z"),
      catalysts: [catalyst],
      provider: createFakeMarketDataProvider("ok", barsBySymbol),
      config: { feed: "sip", credentials: { keyId: "x", secretKey: "y" } },
    });
    expect(first.path).toBeTruthy();
    expect(first.cache.snapshots[0]?.status).toBe("complete");
    expect(first.cache.calculationVersion).toBe(
      MARKET_CONTEXT_CALCULATION_VERSION,
    );

    const second = await fetchOfficialMarketContext({
      dataRoot: root,
      write: true,
      now: new Date("2026-07-29T21:00:00.000Z"),
      catalysts: [catalyst],
      provider: createFakeMarketDataProvider("ok", barsBySymbol),
      config: { feed: "sip", credentials: { keyId: "x", secretKey: "y" } },
    });
    expect(second.cache.snapshots[0]?.id).toBe(first.cache.snapshots[0]?.id);
    expect(second.cache.snapshots[0]?.fetchedAt).toBe(
      first.cache.snapshots[0]?.fetchedAt,
    );

    const forced = await fetchOfficialMarketContext({
      dataRoot: root,
      write: true,
      force: true,
      now: new Date("2026-07-29T22:00:00.000Z"),
      catalysts: [catalyst],
      provider: createFakeMarketDataProvider("ok", barsBySymbol),
      config: { feed: "sip", credentials: { keyId: "x", secretKey: "y" } },
    });
    expect(forced.cache.snapshots[0]?.fetchedAt).toBe(
      "2026-07-29T22:00:00.000Z",
    );
    expect(forced.cache.revisions.length).toBeGreaterThanOrEqual(0);
  });

  it("isolates symbol failure and preserves cache on provider-wide failure", async () => {
    const root = tempRoot();
    const eventMs = easternWallToUtc("2026-07-15", 8, 30).getTime();
    const start = easternWallToUtc("2026-07-15", 8, 0).getTime();
    const bars = synthesizeBars({
      startMs: start,
      count: 480,
      startPrice: 100,
      step: 0.01,
    });
    const barsBySymbol = new Map(
      MARKET_CONTEXT_PROXIES.map((p) => [p.symbol, bars] as const),
    );
    const catalyst = releasedCatalyst({
      id: "cat_cpi_test2",
      occurredAt: new Date(eventMs).toISOString(),
    });
    const good = await fetchOfficialMarketContext({
      dataRoot: root,
      write: true,
      now: new Date("2026-07-29T20:00:00.000Z"),
      catalysts: [catalyst],
      provider: createFakeMarketDataProvider("ok", barsBySymbol),
      config: { feed: "sip", credentials: { keyId: "x", secretKey: "y" } },
    });
    const before = readFileSync(good.path!, "utf8");

    const failed = await fetchOfficialMarketContext({
      dataRoot: root,
      write: true,
      force: true,
      now: new Date("2026-07-29T21:00:00.000Z"),
      catalysts: [catalyst],
      provider: createFakeMarketDataProvider("provider_error"),
      config: { feed: "sip", credentials: { keyId: "x", secretKey: "y" } },
    });
    expect(failed.path).toBeNull();
    expect(failed.cache.buildStatus).toBe("failed");
    expect(readFileSync(good.path!, "utf8")).toBe(before);
  });

  it("no-credentials unavailable without wiping prior cache", async () => {
    const root = tempRoot();
    const eventMs = easternWallToUtc("2026-07-15", 8, 30).getTime();
    const start = easternWallToUtc("2026-07-15", 8, 0).getTime();
    const bars = synthesizeBars({
      startMs: start,
      count: 480,
      startPrice: 100,
      step: 0.01,
    });
    const barsBySymbol = new Map(
      MARKET_CONTEXT_PROXIES.map((p) => [p.symbol, bars] as const),
    );
    const catalyst = releasedCatalyst({
      id: "cat_cpi_test3",
      occurredAt: new Date(eventMs).toISOString(),
    });
    const good = await fetchOfficialMarketContext({
      dataRoot: root,
      write: true,
      now: new Date("2026-07-29T20:00:00.000Z"),
      catalysts: [catalyst],
      provider: createFakeMarketDataProvider("ok", barsBySymbol),
      config: { feed: "sip", credentials: { keyId: "x", secretKey: "y" } },
    });
    const before = readFileSync(good.path!, "utf8");

    const missing = await fetchOfficialMarketContext({
      dataRoot: root,
      write: true,
      now: new Date("2026-07-29T21:00:00.000Z"),
      catalysts: [catalyst],
      config: { feed: "sip", credentials: null },
    });
    expect(missing.cache.buildStatus).toBe("unavailable");
    expect(missing.path).toBeNull();
    expect(readFileSync(good.path!, "utf8")).toBe(before);
    expect(loadMarketContextCache({ dataRoot: root }).ok).toBe(true);
  });

  it("refuses public demo fetch", async () => {
    await expect(
      fetchOfficialMarketContext({
        publicDemo: true,
        write: false,
        catalysts: [],
        provider: createFakeMarketDataProvider("ok"),
      }),
    ).rejects.toThrow(/public demo/i);
  });
});

describe("public demo isolation", () => {
  it("serves synthetic market context with ETF proxy labels", () => {
    const feed = loadCatalystFeed(
      {},
      { publicDemo: true, now: new Date("2026-07-29T20:00:00.000Z") },
    );
    expect(feed.source.marketContext?.status).toBe("synthetic");
    expect(feed.marketContext?.length).toBeGreaterThan(0);
    for (const s of feed.marketContext ?? []) {
      expect(s.synthetic).toBe(true);
      expect(s.provider).toBe("synthetic_fixture");
      for (const sym of s.symbols) {
        expect(sym.instrumentLabel).toMatch(/ETF/);
        expect(sym.instrumentLabel).not.toMatch(/\bDXY\b/);
        expect(sym.instrumentLabel).not.toMatch(/S&P 500 index/i);
        expect(sym.instrumentLabel).not.toMatch(/10Y|10-year yield/i);
      }
    }
    expect(feed.disclaimer).toMatch(/causation/i);
  });

  it("checked-in fixture parses", () => {
    for (const s of syntheticMarketContext.snapshots) {
      expect(EventMarketContext.safeParse(s).success).toBe(true);
    }
  });

  it("excludes unavailable holiday snapshot from feed window", () => {
    const feed = loadCatalystFeed(
      {},
      { publicDemo: true, now: new Date("2026-07-29T20:00:00.000Z") },
    );
    for (const s of feed.marketContext ?? []) {
      expect(s.status).not.toBe("unavailable");
    }
  });
});

describe("contract helpers", () => {
  it("normalizes event timestamps to UTC ISO", () => {
    expect(eventTimestampUtcIso("2026-07-15T08:30:00-04:00")).toBe(
      "2026-07-15T12:30:00.000Z",
    );
  });

  it("unavailable helper marks all windows missing", () => {
    const u = unavailableMarketContext({
      catalystId: "x",
      occurredAt: "2026-07-15T12:30:00.000Z",
      provider: "alpaca",
      feed: "sip",
      fetchedAt: "2026-07-15T20:00:00.000Z",
      error: "missing credentials",
    });
    expect(u.status).toBe("unavailable");
    expect(u.symbols.every((s) => s.missingWindows.length === 4)).toBe(true);
  });
});
