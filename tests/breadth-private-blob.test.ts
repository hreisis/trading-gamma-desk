import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BreadthInternalsSnapshot } from "@/contracts/breadth-internals";
import { parseSpyHoldingsMatrix } from "@/desk/breadth/holdings/parse-spy-holdings";
import { computeSpyBreadthInternals } from "@/desk/breadth/compute/breadth";
import {
  BreadthStoreError,
  createBlobBreadthSnapshotStore,
  createInMemoryBlobStoreClient,
  createVercelBlobStoreClient,
  publishBreadthSnapshot,
} from "@/desk/breadth/store";

const blobPutMock = vi.hoisted(() => vi.fn());
const blobGetMock = vi.hoisted(() => vi.fn());

vi.mock("@vercel/blob", () => {
  class BlobError extends Error {
    constructor(message = "blob error") {
      super(message);
      this.name = "BlobError";
    }
  }
  class BlobAccessError extends BlobError {
    override name = "BlobAccessError";
  }
  class BlobNotFoundError extends BlobError {
    override name = "BlobNotFoundError";
  }
  class BlobClientTokenExpiredError extends BlobError {
    override name = "BlobClientTokenExpiredError";
  }
  class BlobPreconditionFailedError extends BlobError {
    override name = "BlobPreconditionFailedError";
  }
  class BlobServiceNotAvailable extends BlobError {
    override name = "BlobServiceNotAvailable";
  }
  class BlobServiceRateLimited extends BlobError {
    readonly retryAfter = 30;
    override name = "BlobServiceRateLimited";
  }
  class BlobStoreNotFoundError extends BlobError {
    override name = "BlobStoreNotFoundError";
  }
  class BlobStoreSuspendedError extends BlobError {
    override name = "BlobStoreSuspendedError";
  }

  return {
    put: blobPutMock,
    get: blobGetMock,
    BlobError,
    BlobAccessError,
    BlobClientTokenExpiredError,
    BlobNotFoundError,
    BlobPreconditionFailedError,
    BlobServiceNotAvailable,
    BlobServiceRateLimited,
    BlobStoreNotFoundError,
    BlobStoreSuspendedError,
  };
});

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
    updatedAt: "2026-08-06T16:00:00.000Z",
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

function sampleBreadthSnapshot(): BreadthInternalsSnapshot {
  const universe = parseSpyHoldingsMatrix({
    rows: sampleRows(),
    fetchedAt: "2026-08-06T16:00:00.000Z",
  });
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

function mockReadableStream(text: string): ReadableStream<Uint8Array> {
  return new Response(text).body!;
}

afterEach(() => {
  blobPutMock.mockReset();
  blobGetMock.mockReset();
  vi.restoreAllMocks();
});

describe("createVercelBlobStoreClient", () => {
  const token = "vercel_blob_rw_test_secret_token";

  it("puts and gets private blobs with fixed pathnames", async () => {
    const storage = new Map<string, string>();
    blobPutMock.mockImplementation(async (pathname: string, body: string) => {
      storage.set(pathname, body);
      return { pathname };
    });
    blobGetMock.mockImplementation(async (pathname: string) => {
      const body = storage.get(pathname);
      if (!body) return null;
      return {
        statusCode: 200,
        stream: mockReadableStream(body),
        headers: new Headers(),
        blob: {
          url: `https://store.private.blob.vercel-storage.com/${pathname}`,
          downloadUrl: `https://store.private.blob.vercel-storage.com/${pathname}?download=1`,
          pathname,
          contentType: "application/json",
          contentDisposition: "",
          cacheControl: "",
          size: body.length,
          uploadedAt: new Date(),
          etag: "etag-1",
        },
      };
    });

    const client = createVercelBlobStoreClient({ token });
    await client.put("breadth/spy_etf_holdings/latest.json", '{"kind":"pointer"}\n');
    const raw = await client.get("breadth/spy_etf_holdings/latest.json");

    expect(raw).toBe('{"kind":"pointer"}\n');
    expect(blobPutMock).toHaveBeenCalledWith(
      "breadth/spy_etf_holdings/latest.json",
      '{"kind":"pointer"}\n',
      expect.objectContaining({
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: false,
        contentType: "application/json",
        token,
      }),
    );
    expect(blobGetMock).toHaveBeenCalledWith(
      "breadth/spy_etf_holdings/latest.json",
      expect.objectContaining({
        access: "private",
        token,
        useCache: false,
      }),
    );
  });

  it("returns null for missing objects", async () => {
    blobGetMock.mockResolvedValue(null);
    const client = createVercelBlobStoreClient({ token });
    expect(await client.get("breadth/missing.json")).toBeNull();
  });

  it("throws on auth failure instead of treating it as missing", async () => {
    const { BlobAccessError } = await import("@vercel/blob");
    blobGetMock.mockRejectedValue(new BlobAccessError());
    const client = createVercelBlobStoreClient({ token });
    await expect(client.get("breadth/spy_etf_holdings/latest.json")).rejects.toThrow(
      /vercel blob get failed/,
    );
  });

  it("does not leak token into error logs", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { BlobAccessError } = await import("@vercel/blob");
    blobGetMock.mockRejectedValue(
      Object.assign(new BlobAccessError(), { message: `Bearer ${token} unauthorized` }),
    );
    const client = createVercelBlobStoreClient({ token });

    await expect(client.get("breadth/spy_etf_holdings/latest.json")).rejects.toThrow();

    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).not.toContain(token);
    expect(logged).not.toMatch(/Bearer\s+vercel/i);
    errorSpy.mockRestore();
  });

  it("does not use handwritten REST v7 transport", () => {
    const sdkPath = join(
      process.cwd(),
      "src/desk/breadth/store/vercel-blob-sdk.ts",
    );
    const source = readFileSync(sdkPath, "utf8");
    expect(source).toContain("@vercel/blob");
    expect(source).not.toContain("x-api-version");
    expect(source).not.toContain("blob.vercel-storage.com/");
  });
});

describe("private blob breadth store semantics", () => {
  it("allows latest.json overwrite and blocks versioned identity conflicts", async () => {
    const client = createInMemoryBlobStoreClient();
    const store = createBlobBreadthSnapshotStore({ client, prefix: "breadth" });
    const snapshot = sampleBreadthSnapshot();

    const pointer = await publishBreadthSnapshot(
      store,
      snapshot,
      "2026-08-06T16:05:00.000Z",
    );

    const secondPointer = {
      ...pointer,
      publishedAt: "2026-08-06T17:05:00.000Z",
    };
    await store.publishLatest(secondPointer);
    const latest = await store.readLatestPointer();
    expect(latest?.publishedAt).toBe("2026-08-06T17:05:00.000Z");

    const conflicting = {
      ...snapshot,
      advance: snapshot.advance + 1,
    } as BreadthInternalsSnapshot;

    await expect(store.writeVersioned(conflicting)).rejects.toMatchObject({
      code: "identity_conflict",
    });
  });

  it("retains old latest when read-back fails after versioned write", async () => {
    const baseClient = createInMemoryBlobStoreClient();
    const store = createBlobBreadthSnapshotStore({
      client: baseClient,
      prefix: "breadth",
    });
    const first = sampleBreadthSnapshot();
    await publishBreadthSnapshot(store, first, "2026-08-06T16:05:00.000Z");

    const failingClient = createInMemoryBlobStoreClient(
      Object.fromEntries(baseClient.entries),
    );
    const failingStore = createBlobBreadthSnapshotStore({
      client: {
        put: failingClient.put,
        get: async (path) => {
          if (path.endsWith("latest.json")) {
            return failingClient.get(path);
          }
          return null;
        },
      },
      prefix: "breadth",
    });

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

    await expect(
      publishBreadthSnapshot(failingStore, second, "2026-08-07T16:05:00.000Z"),
    ).rejects.toMatchObject({ code: "read_failed" });

    const latest = await store.readLatestPointer();
    expect(latest?.marketSessionDate).toBe("2026-08-06");
  });

  it("retains old latest when latest publish fails after successful read-back", async () => {
    const baseClient = createInMemoryBlobStoreClient();
    const store = createBlobBreadthSnapshotStore({
      client: baseClient,
      prefix: "breadth",
    });
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

    const failingStore = createBlobBreadthSnapshotStore({
      client: {
        put: async (path, body, options) => {
          if (options?.allowOverwrite) {
            throw new Error("latest publish failed");
          }
          await baseClient.put(path, body, options);
        },
        get: baseClient.get,
      },
      prefix: "breadth",
    });

    await expect(
      publishBreadthSnapshot(failingStore, second, "2026-08-07T16:05:00.000Z"),
    ).rejects.toMatchObject({ code: "publish_failed" });

    const latest = await store.readLatestPointer();
    expect(latest?.marketSessionDate).toBe("2026-08-06");
  });

  it("does not update latest when versioned write fails", async () => {
    const client = createInMemoryBlobStoreClient();
    const store = createBlobBreadthSnapshotStore({ client, prefix: "breadth" });
    const snapshot = sampleBreadthSnapshot();
    await publishBreadthSnapshot(store, snapshot, "2026-08-06T16:05:00.000Z");

    const badSnapshot = {
      ...snapshot,
      asOf: "2026-08-06T17:00:00.000Z",
    } as BreadthInternalsSnapshot;

    const failingStore = createBlobBreadthSnapshotStore({ client, prefix: "breadth" });
    failingStore.writeVersioned = async () => {
      throw new BreadthStoreError("write_failed", "simulated versioned write failure");
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
  });
});

describe("private blob SDK publish flow", () => {
  it("writes versioned snapshot, read-backs, and updates latest via SDK client", async () => {
    const storage = new Map<string, string>();
    blobPutMock.mockImplementation(async (pathname: string, body: string) => {
      storage.set(pathname, body);
      return { pathname };
    });
    blobGetMock.mockImplementation(async (pathname: string) => {
      const body = storage.get(pathname);
      if (!body) return null;
      return {
        statusCode: 200,
        stream: mockReadableStream(body),
        headers: new Headers(),
        blob: {
          url: `https://store.private.blob.vercel-storage.com/${pathname}`,
          downloadUrl: `https://store.private.blob.vercel-storage.com/${pathname}?download=1`,
          pathname,
          contentType: "application/json",
          contentDisposition: "",
          cacheControl: "",
          size: body.length,
          uploadedAt: new Date(),
          etag: "etag-1",
        },
      };
    });

    const client = createVercelBlobStoreClient({ token: "vercel_blob_rw_test" });
    const store = createBlobBreadthSnapshotStore({ client, prefix: "breadth" });
    const snapshot = sampleBreadthSnapshot();

    const pointer = await publishBreadthSnapshot(
      store,
      snapshot,
      "2026-08-06T16:05:00.000Z",
    );

    expect(await store.readLatestPointer()).toEqual(pointer);
    expect(await store.readSnapshot(pointer)).toMatchObject({
      marketSessionDate: "2026-08-06",
    });

    const latestPut = blobPutMock.mock.calls.find(
      (call) => String(call[0]).endsWith("latest.json"),
    );
    expect(latestPut?.[2]).toMatchObject({ allowOverwrite: true });

    const versionedPut = blobPutMock.mock.calls.find(
      (call) => String(call[0]).includes("snapshots/"),
    );
    expect(versionedPut?.[2]).toMatchObject({
      allowOverwrite: false,
      addRandomSuffix: false,
      access: "private",
    });
  });
});
