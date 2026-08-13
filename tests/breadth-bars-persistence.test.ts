import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EtfUniverseArtifact } from "@/contracts/etf-universe-artifact";
import { loadAlpacaDailyBarPanel } from "@/desk/breadth/bars/alpaca-panel";
import * as barCacheModule from "@/desk/breadth/bars/cache";
import { writeSymbolBarCache } from "@/desk/breadth/bars/cache";
import * as breadthComputeModule from "@/desk/breadth/compute/breadth";
import { produceDailySpyBreadth } from "@/desk/breadth/produce-daily-spy-breadth";
import { breadthProducerHttpStatus } from "@/desk/breadth/producer-http";
import {
  BreadthStoreError,
  createBlobBreadthSnapshotStore,
  createInMemoryBlobStoreClient,
} from "@/desk/breadth/store";
import * as atomicWriteModule from "@/desk/atomic-write";
import {
  freshUniverse,
  publishablePanelForTargetSession,
} from "./helpers/breadth-fixtures";

function alpacaBarsResponse() {
  return {
    bars: {
      NVDA: [
        {
          t: "2026-08-05T00:00:00Z",
          o: 100,
          h: 101,
          l: 99,
          c: 100.5,
          v: 1000,
        },
        {
          t: "2026-08-06T00:00:00Z",
          o: 105,
          h: 106,
          l: 104,
          c: 105.5,
          v: 1100,
        },
      ],
    },
  };
}

function mockAlpacaFetch(): typeof fetch {
  return vi.fn(async () => ({
    ok: true,
    json: async () => alpacaBarsResponse(),
    text: async () => "",
  })) as unknown as typeof fetch;
}

const vercelEnv = {
  VERCEL: "1",
  NODE_ENV: "production",
  APCA_API_KEY_ID: "test-key",
  APCA_API_SECRET_KEY: "test-secret",
} as NodeJS.ProcessEnv;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadAlpacaDailyBarPanel filesystem persistence", () => {
  it("loads cached bars when Alpaca credentials are absent", async () => {
    const dataRoot = mkdtempSync(join(process.cwd(), "tmp-bars-"));
    writeSymbolBarCache(dataRoot, {
      symbol: "SPY",
      bars: [
        {
          sessionDate: "2026-08-12",
          open: 640,
          high: 641,
          low: 639,
          close: 640.5,
          volume: 1000,
        },
      ],
      updatedAt: "2026-08-12T00:00:00.000Z",
    });

    const panel = await loadAlpacaDailyBarPanel({
      symbols: ["SPY", "QQQ"],
      env: { NODE_ENV: "development" } as NodeJS.ProcessEnv,
      dataRoot,
    });

    expect(panel.provenance.returnedSymbols).toBe(1);
    expect(panel.provenance.failedSymbols).toEqual(["QQQ"]);
    expect(panel.seriesBySymbol.get("SPY")?.bars.at(-1)?.sessionDate).toBe(
      "2026-08-12",
    );
  });

  it("does not write bar cache on Vercel after a successful Alpaca fetch", async () => {
    const writeSpy = vi.spyOn(barCacheModule, "writeSymbolBarCache");

    const panel = await loadAlpacaDailyBarPanel({
      symbols: ["NVDA"],
      env: vercelEnv,
      fetchImpl: mockAlpacaFetch(),
    });

    expect(panel.provenance.returnedSymbols).toBe(1);
    expect(panel.seriesBySymbol.get("NVDA")?.bars.length).toBeGreaterThan(0);
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it("writes bar cache when explicitly enabled for local development", async () => {
    const writeSpy = vi.spyOn(barCacheModule, "writeSymbolBarCache");

    await loadAlpacaDailyBarPanel({
      symbols: ["NVDA"],
      env: {
        NODE_ENV: "development",
        APCA_API_KEY_ID: "test-key",
        APCA_API_SECRET_KEY: "test-secret",
      } as NodeJS.ProcessEnv,
      dataRoot: mkdtempSync(join(process.cwd(), "tmp-bars-")),
      persistToFilesystem: true,
      fetchImpl: mockAlpacaFetch(),
    });

    expect(writeSpy).toHaveBeenCalled();
  });

  it("skips persistence when persistToFilesystem is explicitly false", async () => {
    const writeSpy = vi.spyOn(barCacheModule, "writeSymbolBarCache");

    await loadAlpacaDailyBarPanel({
      symbols: ["NVDA"],
      env: {
        NODE_ENV: "development",
        APCA_API_KEY_ID: "test-key",
        APCA_API_SECRET_KEY: "test-secret",
      } as NodeJS.ProcessEnv,
      persistToFilesystem: false,
      fetchImpl: mockAlpacaFetch(),
    });

    expect(writeSpy).not.toHaveBeenCalled();
  });
});

describe("produceDailySpyBreadth production filesystem invariants", () => {
  function panelForTargetSession(targetSession: string) {
    return publishablePanelForTargetSession(targetSession);
  }

  it("continues to breadth computation after in-memory bars without filesystem writes", async () => {
    const computeSpy = vi.spyOn(breadthComputeModule, "computeSpyBreadthInternals");
    const writeSpy = vi.spyOn(barCacheModule, "writeSymbolBarCache");
    const loadBarPanel = vi.fn(async () => panelForTargetSession("2026-08-06"));

    const store = createBlobBreadthSnapshotStore({
      client: createInMemoryBlobStoreClient(),
      prefix: "breadth",
    });

    const result = await produceDailySpyBreadth({
      store,
      now: () => new Date("2026-08-06T22:00:00.000Z"),
      env: vercelEnv,
      loadUniverse: async () => ({
        artifact: freshUniverse(),
        source: "network",
        error: null,
      }),
      loadBarPanel,
      allowUniversePersistedFallback: false,
    });

    expect(loadBarPanel).toHaveBeenCalledOnce();
    expect(computeSpy).toHaveBeenCalledOnce();
    expect(writeSpy).not.toHaveBeenCalled();
    expect(result.status).toBe("published");
  });

  it("has zero local filesystem writes before blob publish on the production path", async () => {
    const writeJsonSpy = vi.spyOn(atomicWriteModule, "writeJsonAtomic");

    const store = createBlobBreadthSnapshotStore({
      client: createInMemoryBlobStoreClient(),
      prefix: "breadth",
    });

    await produceDailySpyBreadth({
      store,
      now: () => new Date("2026-08-06T22:00:00.000Z"),
      env: vercelEnv,
      loadUniverse: async () => ({
        artifact: freshUniverse(),
        source: "network",
        error: null,
      }),
      loadBarPanel: async () => panelForTargetSession("2026-08-06"),
      allowUniversePersistedFallback: false,
    });

    expect(writeJsonSpy).not.toHaveBeenCalled();
  });

  it("returns published with HTTP 200 on successful production path", async () => {
    const store = createBlobBreadthSnapshotStore({
      client: createInMemoryBlobStoreClient(),
      prefix: "breadth",
    });

    const result = await produceDailySpyBreadth({
      store,
      now: () => new Date("2026-08-06T22:00:00.000Z"),
      env: vercelEnv,
      loadUniverse: async () => ({
        artifact: freshUniverse(),
        source: "network",
        error: null,
      }),
      loadBarPanel: async () => panelForTargetSession("2026-08-06"),
      allowUniversePersistedFallback: false,
    });

    expect(result.status).toBe("published");
    expect(breadthProducerHttpStatus(result)).toBe(200);
  });

  it("returns failed with HTTP 502 when bars upstream is unavailable", async () => {
    const store = createBlobBreadthSnapshotStore({
      client: createInMemoryBlobStoreClient(),
      prefix: "breadth",
    });

    const result = await produceDailySpyBreadth({
      store,
      now: () => new Date("2026-08-06T22:00:00.000Z"),
      env: vercelEnv,
      loadUniverse: async () => ({
        artifact: freshUniverse(),
        source: "network",
        error: null,
      }),
      loadBarPanel: async () => ({
        seriesBySymbol: new Map(),
        provenance: {
          provider: "alpaca",
          priceFeed: "iex",
          isConsolidated: false,
          adjustment: "split",
          requestedSymbols: 3,
          returnedSymbols: 0,
          coverage: 0,
          pages: 0,
          fetchedAt: "2026-08-06T22:00:00.000Z",
          latestSessionDate: null,
          failedSymbols: ["NVDA", "BRK.B", "BF.B"],
        },
      }),
      allowUniversePersistedFallback: false,
    });

    expect(result).toMatchObject({
      status: "failed",
      reason: "upstream_bars_unavailable",
    });
    expect(breadthProducerHttpStatus(result)).toBe(502);
    expect(await store.readLatestPointer()).toBeNull();
  });

  it("returns failed with HTTP 500 and retains prior latest when publish fails", async () => {
    const client = createInMemoryBlobStoreClient();
    const store = createBlobBreadthSnapshotStore({ client, prefix: "breadth" });
    const targetSession = "2026-08-06";

    await produceDailySpyBreadth({
      store,
      now: () => new Date("2026-08-06T22:00:00.000Z"),
      env: vercelEnv,
      loadUniverse: async () => ({
        artifact: freshUniverse(),
        source: "network",
        error: null,
      }),
      loadBarPanel: async () => panelForTargetSession(targetSession),
      allowUniversePersistedFallback: false,
    });

    const failingStore = createBlobBreadthSnapshotStore({ client, prefix: "breadth" });
    failingStore.publishLatest = async () => {
      throw new BreadthStoreError("publish_failed", "simulated publish failure");
    };

    const result = await produceDailySpyBreadth({
      store: failingStore,
      now: () => new Date("2026-08-07T22:00:00.000Z"),
      env: vercelEnv,
      loadUniverse: async () => ({
        artifact: freshUniverse(),
        source: "network",
        error: null,
      }),
      loadBarPanel: async () => panelForTargetSession("2026-08-07"),
      allowUniversePersistedFallback: false,
    });

    expect(result).toMatchObject({
      status: "failed",
      reason: "publish_failed",
    });
    expect(breadthProducerHttpStatus(result)).toBe(500);
    const latest = await store.readLatestPointer();
    expect(latest?.marketSessionDate).toBe(targetSession);
  });
});
