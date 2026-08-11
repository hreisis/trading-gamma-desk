import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { BreadthInternalsSnapshot } from "@/contracts/breadth-internals";
import {
  evaluateDurableBreadthSessionFreshness,
  loadDurableSpyBreadthForMarketInput,
} from "@/desk/breadth/read-durable-breadth";
import {
  createFilesystemBreadthSnapshotStore,
  publishBreadthSnapshot,
} from "@/desk/breadth/store";
import { computePublishableSnapshotForSession } from "./helpers/breadth-fixtures";

function sampleSnapshot(
  marketSessionDate: string,
  asOf: string,
): BreadthInternalsSnapshot {
  return computePublishableSnapshotForSession(marketSessionDate, asOf);
}

function tempStore() {
  return createFilesystemBreadthSnapshotStore({
    dataRoot: mkdtempSync(join(tmpdir(), "gammadesk-breadth-reader-")),
  });
}

describe("evaluateDurableBreadthSessionFreshness", () => {
  it("does not mark stale on weekend when snapshot matches last completed session", () => {
    const result = evaluateDurableBreadthSessionFreshness({
      snapshotMarketSessionDate: "2026-08-07",
      targetMarketSessionDate: "2026-08-07",
    });
    expect(result).toEqual({ stale: false, missingReason: null });
  });

  it("marks genuinely stale snapshots by trading-session lag", () => {
    const result = evaluateDurableBreadthSessionFreshness({
      snapshotMarketSessionDate: "2026-08-05",
      targetMarketSessionDate: "2026-08-07",
    });
    expect(result.stale).toBe(true);
    expect(result.missingReason).toMatch(/lags target 2026-08-07/);
  });
});

describe("loadDurableSpyBreadthForMarketInput", () => {
  it("reads the latest published snapshot from an injected filesystem store", async () => {
    const store = tempStore();
    const snapshot = sampleSnapshot(
      "2026-08-06",
      "2026-08-06T16:00:00.000Z",
    );
    await publishBreadthSnapshot(store, snapshot, "2026-08-06T16:05:00.000Z");

    const result = await loadDurableSpyBreadthForMarketInput({
      targetMarketSessionDate: "2026-08-06",
      store,
    });

    expect(result.snapshot?.advance).toBe(snapshot.advance);
    expect(result.sourceArtifact).toMatch(/^breadth\/spy_etf_holdings\/snapshots\//);
    expect(result.missingReason).toBeNull();
  });

  it("returns unavailable when latest pointer is missing", async () => {
    const store = tempStore();
    const result = await loadDurableSpyBreadthForMarketInput({
      targetMarketSessionDate: "2026-08-06",
      store,
    });

    expect(result.snapshot).toBeNull();
    expect(result.missingReason).toMatch(/No durable breadth latest pointer/);
  });

  it("rejects malformed latest pointer JSON", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "gammadesk-breadth-reader-"));
    const store = createFilesystemBreadthSnapshotStore({ dataRoot });
    const latestDir = join(dataRoot, "breadth", "spy_etf_holdings");
    mkdirSync(latestDir, { recursive: true });
    writeFileSync(join(latestDir, "latest.json"), "{ invalid");

    const result = await loadDurableSpyBreadthForMarketInput({
      targetMarketSessionDate: "2026-08-06",
      store,
    });

    expect(result.snapshot).toBeNull();
    expect(result.missingReason).toMatch(/pointer schema validation failed/i);
  });

  it("rejects malformed target snapshot JSON", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "gammadesk-breadth-reader-"));
    const store = createFilesystemBreadthSnapshotStore({ dataRoot });
    const snapshot = sampleSnapshot(
      "2026-08-06",
      "2026-08-06T16:00:00.000Z",
    );
    const pointer = await publishBreadthSnapshot(
      store,
      snapshot,
      "2026-08-06T16:05:00.000Z",
    );

    writeFileSync(
      join(dataRoot, "breadth", pointer.snapshotPath),
      "{ invalid",
    );

    const result = await loadDurableSpyBreadthForMarketInput({
      targetMarketSessionDate: "2026-08-06",
      store,
    });

    expect(result.snapshot).toBeNull();
    expect(result.missingReason).toMatch(/snapshot schema validation failed/i);
  });

  it("fail closed on Vercel without blob token", async () => {
    const result = await loadDurableSpyBreadthForMarketInput({
      targetMarketSessionDate: "2026-08-06",
      env: { VERCEL: "1", NODE_ENV: "test" },
    });

    expect(result.snapshot).toBeNull();
    expect(result.missingReason).toMatch(/BLOB_READ_WRITE_TOKEN/);
    expect(result.missingReason).not.toMatch(/Bearer/i);
  });

  it("uses filesystem store in local development without blob token", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "gammadesk-breadth-reader-"));
    const store = createFilesystemBreadthSnapshotStore({ dataRoot });
    await publishBreadthSnapshot(
      store,
      sampleSnapshot("2026-08-06", "2026-08-06T16:00:00.000Z"),
      "2026-08-06T16:05:00.000Z",
    );

    const result = await loadDurableSpyBreadthForMarketInput({
      targetMarketSessionDate: "2026-08-06",
      env: {},
      dataRoot,
    });

    expect(result.snapshot).not.toBeNull();
    expect(result.missingReason).toBeNull();
  });
});

const loadSpyUniverse = vi.fn();
const loadAlpacaDailyBarPanel = vi.fn();

vi.mock("@/desk/breadth/universe/load-spy-universe", () => ({
  loadSpyUniverse,
}));

vi.mock("@/desk/breadth/bars/alpaca-panel", () => ({
  loadAlpacaDailyBarPanel,
}));

vi.mock("@/desk/production-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/desk/production-runtime")>();
  return {
    ...actual,
    resolveDeskRequestAsync: vi.fn(async () => ({
      status: "empty" as const,
      source: "none",
      sourceLabel: "none",
      isDemo: false,
      isPublicDemo: false,
      isLiveDriver: false,
      driver: null,
      driverPath: null,
      snapshotPresent: false,
      snapshotPath: null,
      sessionStale: false,
      pipeline: null,
      error: { code: "empty" as const, message: "no driver" },
    })),
    loadBoundedGammaDeskViewAsync: vi.fn(async () =>
      (await import("@/desk")).loadBoundedGammaDeskView({ forceFixture: true }),
    ),
  };
});

vi.mock("@/alpaca", () => ({
  loadAlpacaMarketPanel: vi.fn(async () => null),
}));

vi.mock("@/catalyst", () => ({
  loadCatalystFeedAsync: vi.fn(async () => ({
    mode: "live_unavailable" as const,
    catalysts: [],
    generatedAt: "2026-08-06T12:00:00.000Z",
    disclaimer: "",
    source: {
      synthetic: false,
      partialFailure: false,
      fetchedAt: null,
    },
  })),
}));

describe("loadMarketInputSnapshot durable breadth integration", () => {
  it("does not trigger constituent universe or bar panel fetches", async () => {
    const { loadMarketInputSnapshot } = await import("@/desk/build-market-input-snapshot");

    await loadMarketInputSnapshot({
      publicDemo: false,
      now: new Date("2026-08-06T22:00:00.000Z"),
      env: { VERCEL: "1", NODE_ENV: "test" },
    });

    expect(loadSpyUniverse).not.toHaveBeenCalled();
    expect(loadAlpacaDailyBarPanel).not.toHaveBeenCalled();
  });

  it("keeps other inputs when durable breadth is unavailable", async () => {
    const { loadMarketInputSnapshot } = await import("@/desk/build-market-input-snapshot");
    const snapshot = await loadMarketInputSnapshot({
      publicDemo: false,
      now: new Date("2026-08-06T22:00:00.000Z"),
      env: { VERCEL: "1", NODE_ENV: "test" },
    });

    expect(snapshot.inputs).toHaveLength(14);
    const breadth = snapshot.inputs.find((row) => row.key === "breadth_internals");
    const spyGamma = snapshot.inputs.find((row) => row.key === "spy_gamma");
    expect(breadth?.status).toBe("unavailable");
    expect(spyGamma).toBeDefined();
    expect(spyGamma?.status).not.toBe("missing");
  });
});
