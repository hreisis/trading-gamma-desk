import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { BreadthInternalsSnapshot } from "@/contracts/breadth-internals";
import {
  BREADTH_SNAPSHOT_POINTER_SCHEMA_VERSION,
  type BreadthSnapshotPointer,
} from "@/contracts/breadth-snapshot-pointer";
import { parseSpyHoldingsMatrix } from "@/desk/breadth/holdings/parse-spy-holdings";
import { computeSpyBreadthInternals } from "@/desk/breadth/compute/breadth";
import {
  BreadthStoreError,
  createBlobBreadthSnapshotStore,
  createFilesystemBreadthSnapshotStore,
  createInMemoryBlobStoreClient,
  publishBreadthSnapshot,
} from "@/desk/breadth/store";

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

function barSeries(
  symbol: string,
  closes: Array<{ date: string; close: number }>,
) {
  return {
    symbol,
    updatedAt: "2026-08-06T12:00:00.000Z",
    bars: closes.map((row) => ({
      sessionDate: row.date,
      open: row.close,
      high: row.close + 1,
      low: row.close - 1,
      close: row.close,
      volume: 1_000,
    })),
  };
}

function baseUniverse() {
  return parseSpyHoldingsMatrix({
    rows: sampleRows(),
    fetchedAt: "2026-08-06T12:00:00.000Z",
  });
}

function sampleBreadthSnapshot(): BreadthInternalsSnapshot {
  const universe = baseUniverse();
  const seriesBySymbol = new Map([
    [
      "NVDA",
      barSeries("NVDA", [
        { date: "2026-08-05", close: 105 },
        { date: "2026-08-06", close: 110 },
      ]),
    ],
    [
      "BRK.B",
      barSeries("BRK.B", [
        { date: "2026-08-05", close: 50 },
        { date: "2026-08-06", close: 48 },
      ]),
    ],
    [
      "BF.B",
      barSeries("BF.B", [
        { date: "2026-08-05", close: 30 },
        { date: "2026-08-06", close: 30 },
      ]),
    ],
  ]);

  return computeSpyBreadthInternals({
    universe: { ...universe, sessionLag: 0, stale: false, status: "available" },
    targetMarketSessionDate: "2026-08-06",
    asOf: "2026-08-06T16:00:00.000Z",
    seriesBySymbol,
    barsProvenance: {
      provider: "alpaca",
      priceFeed: "iex",
      isConsolidated: false,
      adjustment: "split",
      requestedSymbols: 3,
      returnedSymbols: 3,
      coverage: 1,
      pages: 1,
      fetchedAt: "2026-08-06T16:00:00.000Z",
      latestSessionDate: "2026-08-06",
      failedSymbols: [],
    },
  });
}

function tempDataRoot(): string {
  return mkdtempSync(join(tmpdir(), "gammadesk-breadth-store-"));
}

describe("filesystem breadth snapshot store", () => {
  it("writes versioned snapshot, publishes latest, and reads back", async () => {
    const store = createFilesystemBreadthSnapshotStore({
      dataRoot: tempDataRoot(),
    });
    const snapshot = sampleBreadthSnapshot();
    const publishedAt = "2026-08-06T16:05:00.000Z";

    const pointer = await publishBreadthSnapshot(store, snapshot, publishedAt);

    expect(pointer).toMatchObject({
      kind: "BreadthSnapshotPointer",
      schemaVersion: BREADTH_SNAPSHOT_POINTER_SCHEMA_VERSION,
      universeId: "spy_etf_holdings",
      fundSymbol: "SPY",
      marketSessionDate: "2026-08-06",
      generatedAt: snapshot.asOf,
      publishedAt,
    });

    const latest = await store.readLatestPointer();
    expect(latest).toEqual(pointer);

    const roundTrip = await store.readSnapshot(pointer);
    expect(roundTrip.marketSessionDate).toBe(snapshot.marketSessionDate);
    expect(roundTrip.advance).toBe(snapshot.advance);
  });

  it("does not update latest when versioned write fails", async () => {
    const dataRoot = tempDataRoot();
    const store = createFilesystemBreadthSnapshotStore({ dataRoot });
    const snapshot = sampleBreadthSnapshot();

    await publishBreadthSnapshot(
      store,
      snapshot,
      "2026-08-06T16:05:00.000Z",
    );

    const badSnapshot = {
      ...snapshot,
      asOf: "2026-08-06T17:00:00.000Z",
      universe: {
        ...snapshot.universe,
        universeId: "spy_etf_holdings",
        fundSymbol: "SPY",
      },
    } as BreadthInternalsSnapshot;

    const failingStore = createFilesystemBreadthSnapshotStore({ dataRoot });
    const originalWrite = failingStore.writeVersioned.bind(failingStore);
    failingStore.writeVersioned = async () => {
      await originalWrite(badSnapshot);
      throw new BreadthStoreError("write_failed", "simulated write failure");
    };

    await expect(
      publishBreadthSnapshot(
        failingStore,
        badSnapshot,
        "2026-08-06T17:05:00.000Z",
      ),
    ).rejects.toMatchObject({ code: "write_failed" });

    const latest = await store.readLatestPointer();
    expect(latest?.generatedAt).toBe(snapshot.asOf);
    expect(latest?.publishedAt).toBe("2026-08-06T16:05:00.000Z");
  });

  it("retains old latest when publishLatest fails", async () => {
    const dataRoot = tempDataRoot();
    const store = createFilesystemBreadthSnapshotStore({ dataRoot });
    const first = sampleBreadthSnapshot();

    await publishBreadthSnapshot(store, first, "2026-08-06T16:05:00.000Z");

    const second = computeSpyBreadthInternals({
      universe: {
        ...baseUniverse(),
        sessionLag: 0,
        stale: false,
        status: "available",
      },
      targetMarketSessionDate: "2026-08-07",
      asOf: "2026-08-07T16:00:00.000Z",
      seriesBySymbol: new Map([
        [
          "NVDA",
          barSeries("NVDA", [
            { date: "2026-08-06", close: 110 },
            { date: "2026-08-07", close: 112 },
          ]),
        ],
        [
          "BRK.B",
          barSeries("BRK.B", [
            { date: "2026-08-06", close: 48 },
            { date: "2026-08-07", close: 47 },
          ]),
        ],
        [
          "BF.B",
          barSeries("BF.B", [
            { date: "2026-08-06", close: 30 },
            { date: "2026-08-07", close: 30 },
          ]),
        ],
      ]),
      barsProvenance: {
        ...first.bars,
        fetchedAt: "2026-08-07T16:00:00.000Z",
        latestSessionDate: "2026-08-07",
      },
    });

    const failingStore = createFilesystemBreadthSnapshotStore({ dataRoot });
    failingStore.publishLatest = async () => {
      throw new BreadthStoreError("publish_failed", "simulated publish failure");
    };

    await expect(
      publishBreadthSnapshot(
        failingStore,
        second,
        "2026-08-07T16:05:00.000Z",
      ),
    ).rejects.toMatchObject({ code: "publish_failed" });

    const latest = await store.readLatestPointer();
    expect(latest?.marketSessionDate).toBe("2026-08-06");
    expect(latest?.generatedAt).toBe(first.asOf);
  });

  it("rejects malformed snapshot and pointer JSON", async () => {
    const dataRoot = tempDataRoot();
    const store = createFilesystemBreadthSnapshotStore({ dataRoot });
    const snapshot = sampleBreadthSnapshot();
    const writeResult = await store.writeVersioned(snapshot);

    const badPointer: BreadthSnapshotPointer = {
      kind: "BreadthSnapshotPointer",
      schemaVersion: BREADTH_SNAPSHOT_POINTER_SCHEMA_VERSION,
      universeId: "spy_etf_holdings",
      fundSymbol: "SPY",
      marketSessionDate: "2026-08-06",
      snapshotPath: writeResult.snapshotPath,
      snapshotIdentity: writeResult.snapshotIdentity,
      generatedAt: snapshot.asOf,
      publishedAt: "2026-08-06T16:05:00.000Z",
    };

    const absoluteSnapshot = join(
      dataRoot,
      "breadth",
      writeResult.snapshotPath,
    );
    const absoluteLatest = join(
      dataRoot,
      "breadth",
      "spy_etf_holdings",
      "latest.json",
    );

    writeFileSync(absoluteSnapshot, "{ not-json ");
    await expect(store.readSnapshot(badPointer)).rejects.toMatchObject({
      code: "invalid_snapshot",
    });

    writeFileSync(absoluteLatest, '{"kind":"BreadthSnapshotPointer"}');
    await expect(store.readLatestPointer()).rejects.toMatchObject({
      code: "invalid_pointer",
    });
  });

  it("rejects path traversal in snapshot paths", async () => {
    const store = createFilesystemBreadthSnapshotStore({
      dataRoot: tempDataRoot(),
    });
    const snapshot = sampleBreadthSnapshot();
    const writeResult = await store.writeVersioned(snapshot);

    const escapePointer: BreadthSnapshotPointer = {
      kind: "BreadthSnapshotPointer",
      schemaVersion: BREADTH_SNAPSHOT_POINTER_SCHEMA_VERSION,
      universeId: "spy_etf_holdings",
      fundSymbol: "SPY",
      marketSessionDate: snapshot.marketSessionDate,
      snapshotPath: "../outside.json",
      snapshotIdentity: writeResult.snapshotIdentity,
      generatedAt: snapshot.asOf,
      publishedAt: "2026-08-06T16:05:00.000Z",
    };

    await expect(store.readSnapshot(escapePointer)).rejects.toMatchObject({
      code: "path_escape",
    });
    await expect(store.publishLatest(escapePointer)).rejects.toMatchObject({
      code: "path_escape",
    });
  });
});

describe("blob breadth snapshot store", () => {
  it("writes and reads offline via injected in-memory client", async () => {
    const client = createInMemoryBlobStoreClient();
    const store = createBlobBreadthSnapshotStore({ client, prefix: "breadth" });
    const snapshot = sampleBreadthSnapshot();

    const pointer = await publishBreadthSnapshot(
      store,
      snapshot,
      "2026-08-06T16:05:00.000Z",
    );

    expect(await store.readLatestPointer()).toEqual(pointer);
    const roundTrip = await store.readSnapshot(pointer);
    expect(roundTrip.decline).toBe(snapshot.decline);

    expect(client.entries.has(`breadth/${pointer.snapshotPath}`)).toBe(true);
    expect(
      client.entries.has("breadth/spy_etf_holdings/latest.json"),
    ).toBe(true);
  });

  it("returns unavailable when blob client is not configured", async () => {
    const store = createBlobBreadthSnapshotStore({ client: null });
    const snapshot = sampleBreadthSnapshot();

    await expect(store.writeVersioned(snapshot)).rejects.toMatchObject({
      code: "unavailable",
    });
    await expect(store.readLatestPointer()).rejects.toMatchObject({
      code: "unavailable",
    });
  });

  it("retains old latest when blob publish fails", async () => {
    const client = createInMemoryBlobStoreClient();
    const store = createBlobBreadthSnapshotStore({ client, prefix: "breadth" });
    const first = sampleBreadthSnapshot();
    await publishBreadthSnapshot(store, first, "2026-08-06T16:05:00.000Z");

    const second = {
      ...first,
      marketSessionDate: "2026-08-07",
      asOf: "2026-08-07T16:00:00.000Z",
      bars: {
        ...first.bars,
        fetchedAt: "2026-08-07T16:00:00.000Z",
        latestSessionDate: "2026-08-07",
      },
    } as BreadthInternalsSnapshot;

    const failingClient = createInMemoryBlobStoreClient(
      Object.fromEntries(client.entries),
    );
    const failingStore = createBlobBreadthSnapshotStore({
      client: {
        put: failingClient.put,
        get: failingClient.get,
      },
      prefix: "breadth",
    });
    failingStore.publishLatest = async () => {
      throw new BreadthStoreError("publish_failed", "blob publish failed");
    };

    await expect(
      publishBreadthSnapshot(
        failingStore,
        second,
        "2026-08-07T16:05:00.000Z",
      ),
    ).rejects.toMatchObject({ code: "publish_failed" });

    const latest = await store.readLatestPointer();
    expect(latest?.generatedAt).toBe(first.asOf);
  });

  it("rejects unsafe blob prefix at write time", async () => {
    const client = createInMemoryBlobStoreClient();
    const store = createBlobBreadthSnapshotStore({
      client,
      prefix: "../escape",
    });
    const snapshot = sampleBreadthSnapshot();

    await expect(store.writeVersioned(snapshot)).rejects.toMatchObject({
      code: "path_escape",
    });
  });
});

describe("publishBreadthSnapshot guards", () => {
  it("rejects unavailable snapshots before writing", async () => {
    const store = createFilesystemBreadthSnapshotStore({
      dataRoot: tempDataRoot(),
    });
    const snapshot = {
      ...sampleBreadthSnapshot(),
      status: "unavailable" as const,
      missingReason: "coverage floor",
    };

    await expect(
      publishBreadthSnapshot(store, snapshot, "2026-08-06T16:05:00.000Z"),
    ).rejects.toMatchObject({ code: "invalid_snapshot" });

    expect(await store.readLatestPointer()).toBeNull();
  });
});
