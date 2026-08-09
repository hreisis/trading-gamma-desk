import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EtfUniverseArtifact } from "@/contracts/etf-universe-artifact";
import { parseSpyHoldingsMatrix } from "@/desk/breadth/holdings/parse-spy-holdings";
import { produceDailySpyBreadth } from "@/desk/breadth/produce-daily-spy-breadth";
import {
  breadthProducerHttpStatus,
  logBreadthProducerResult,
} from "@/desk/breadth/producer-http";
import { loadSpyUniverse } from "@/desk/breadth/universe/load-spy-universe";
import * as persistModule from "@/desk/breadth/universe/persist";
import { createFilesystemBreadthSnapshotStore } from "@/desk/breadth/store";

function sampleRows(): string[][] {
  return [
    ["Fund Name:", "State Street® SPDR® S&P 500® ETF Trust"],
    ["Ticker Symbol:", "SPY"],
    ["Holdings:", "As of 05-Aug-2026"],
    ["Name", "Ticker", "Identifier", "Weight", "Sector", "Shares Held", "Local Currency"],
    ["NVIDIA CORP", "NVDA", "67066G104", "7.99", "-", "100", "USD"],
    ["BERKSHIRE HATHAWAY INC CL B", "BRK.B", "084670702", "1.44", "-", "10", "USD"],
    ["BROWN FORMAN CORP CL B", "BF.B", "115637209", "0.01", "-", "1", "USD"],
  ];
}

function sampleUniverse(): EtfUniverseArtifact {
  return parseSpyHoldingsMatrix({
    rows: sampleRows(),
    fetchedAt: "2026-08-06T22:00:00.000Z",
  });
}

function freshUniverse(): EtfUniverseArtifact {
  return {
    ...sampleUniverse(),
    sessionLag: 0,
    stale: false,
    status: "available",
  };
}

async function mockFetchSpyHoldings(): Promise<EtfUniverseArtifact> {
  return sampleUniverse();
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadSpyUniverse filesystem persistence", () => {
  it("does not persist to filesystem on Vercel after a successful official fetch", async () => {
    const persistSpy = vi.spyOn(persistModule, "persistSpyUniverseArtifact");

    const result = await loadSpyUniverse({
      fetchedAt: "2026-08-06T22:00:00.000Z",
      targetMarketSessionDate: "2026-08-06",
      env: { VERCEL: "1", NODE_ENV: "production" },
      fetchSpyHoldings: mockFetchSpyHoldings,
      allowPersistedFallback: false,
    });

    expect(result.error).toBeNull();
    expect(result.source).toBe("network");
    expect(result.artifact).not.toBeNull();
    expect(persistSpy).not.toHaveBeenCalled();
  });

  it("persists to filesystem when explicitly enabled for local development", async () => {
    const persistSpy = vi
      .spyOn(persistModule, "persistSpyUniverseArtifact")
      .mockReturnValue({ asOfPath: "as-of.json", latestPath: "latest.json" });

    await loadSpyUniverse({
      fetchedAt: "2026-08-06T22:00:00.000Z",
      targetMarketSessionDate: "2026-08-06",
      env: { NODE_ENV: "development" },
      dataRoot: mkdtempSync(join(process.cwd(), "tmp-universe-")),
      persistToFilesystem: true,
      fetchSpyHoldings: mockFetchSpyHoldings,
      allowPersistedFallback: false,
    });

    expect(persistSpy).toHaveBeenCalledOnce();
  });

  it("skips persistence when persistToFilesystem is explicitly false", async () => {
    const persistSpy = vi.spyOn(persistModule, "persistSpyUniverseArtifact");

    await loadSpyUniverse({
      fetchedAt: "2026-08-06T22:00:00.000Z",
      targetMarketSessionDate: "2026-08-06",
      env: { NODE_ENV: "development" },
      persistToFilesystem: false,
      fetchSpyHoldings: mockFetchSpyHoldings,
      allowPersistedFallback: false,
    });

    expect(persistSpy).not.toHaveBeenCalled();
  });
});

describe("produceDailySpyBreadth on Vercel", () => {
  it("continues to Alpaca after in-memory universe without filesystem writes", async () => {
    const loadBarPanel = vi.fn(async () => ({
      seriesBySymbol: new Map(),
      provenance: {
        provider: "alpaca" as const,
        priceFeed: "iex" as const,
        isConsolidated: false,
        adjustment: "split" as const,
        requestedSymbols: 1,
        returnedSymbols: 1,
        coverage: 1,
        pages: 1,
        fetchedAt: "2026-08-06T22:00:00.000Z",
        latestSessionDate: "2026-08-06",
        failedSymbols: [],
      },
    }));

    const loadUniverse = vi.fn(async () => ({
      artifact: freshUniverse(),
      source: "network" as const,
      error: null,
    }));
    const persistSpy = vi.spyOn(persistModule, "persistSpyUniverseArtifact");

    const store = createFilesystemBreadthSnapshotStore({
      dataRoot: mkdtempSync(join(process.cwd(), "tmp-producer-vercel-")),
    });

    await produceDailySpyBreadth({
      store,
      now: () => new Date("2026-08-06T22:00:00.000Z"),
      env: { VERCEL: "1", NODE_ENV: "production" },
      loadUniverse,
      loadBarPanel,
      allowUniversePersistedFallback: false,
    });

    expect(persistSpy).not.toHaveBeenCalled();
    expect(loadUniverse).toHaveBeenCalledOnce();
    expect(loadBarPanel).toHaveBeenCalledOnce();
  });
});

describe("breadthProducerHttpStatus", () => {
  it("maps upstream failures to 502 and internal failures to 500", () => {
    expect(
      breadthProducerHttpStatus({
        status: "failed",
        reason: "upstream_universe_unavailable",
        marketSessionDate: "2026-08-06",
        detail: "x",
      }),
    ).toBe(502);
    expect(
      breadthProducerHttpStatus({
        status: "failed",
        reason: "publish_failed",
        marketSessionDate: "2026-08-06",
        detail: "x",
      }),
    ).toBe(500);
    expect(
      breadthProducerHttpStatus({
        status: "skipped",
        reason: "breadth_unavailable",
        marketSessionDate: "2026-08-06",
        detail: "x",
      }),
    ).toBe(200);
    expect(
      breadthProducerHttpStatus({
        status: "published",
        marketSessionDate: "2026-08-06",
        snapshotIdentity: "id",
        publishedAt: "2026-08-06T22:00:00.000Z",
      }),
    ).toBe(200);
  });
});

describe("logBreadthProducerResult", () => {
  it("logs only status, reason, and session fields", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    logBreadthProducerResult({
      status: "failed",
      reason: "upstream_bars_unavailable",
      marketSessionDate: "2026-08-06",
      detail: "secret-token-leak-should-not-appear",
    });
    expect(info).toHaveBeenCalledOnce();
    const logged = JSON.stringify(info.mock.calls[0]);
    expect(logged).toMatch(/upstream_bars_unavailable/);
    expect(logged).not.toMatch(/secret-token/);
    info.mockRestore();
  });
});
