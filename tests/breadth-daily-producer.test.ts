import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { produceDailySpyBreadth } from "@/desk/breadth/produce-daily-spy-breadth";
import {
  BreadthStoreError,
  createFilesystemBreadthSnapshotStore,
} from "@/desk/breadth/store";
import {
  freshUniverse,
  publishablePanelForTargetSession,
} from "./helpers/breadth-fixtures";

function panelForTargetSession(targetSession: string) {
  return publishablePanelForTargetSession(targetSession);
}

function tempStore() {
  return createFilesystemBreadthSnapshotStore({
    dataRoot: mkdtempSync(join(tmpdir(), "gammadesk-breadth-producer-")),
  });
}

describe("produceDailySpyBreadth", () => {
  it("publishes a daily snapshot on successful upstream + compute", async () => {
    const store = tempStore();
    const targetSession = "2026-08-06";
    const now = new Date("2026-08-06T22:00:00.000Z");

    const result = await produceDailySpyBreadth({
      store,
      now: () => now,
      loadUniverse: async () => ({
        artifact: freshUniverse(),
        source: "network",
        error: null,
      }),
      loadBarPanel: async () => panelForTargetSession(targetSession),
    });

    expect(result).toMatchObject({
      status: "published",
      marketSessionDate: targetSession,
    });
    expect(result.status === "published" && result.snapshotIdentity).toBeTruthy();

    const latest = await store.readLatestPointer();
    expect(latest?.marketSessionDate).toBe(targetSession);
  });

  it("does not update latest when universe upstream fails", async () => {
    const store = tempStore();
    const now = new Date("2026-08-06T22:00:00.000Z");

    const result = await produceDailySpyBreadth({
      store,
      now: () => now,
      loadUniverse: async () => ({
        artifact: null,
        source: "none",
        error: "SPY holdings HTTP 503",
      }),
      loadBarPanel: async () => panelForTargetSession("2026-08-06"),
    });

    expect(result).toMatchObject({
      status: "failed",
      reason: "upstream_universe_unavailable",
      marketSessionDate: "2026-08-06",
    });
    expect(await store.readLatestPointer()).toBeNull();
  });

  it("does not update latest when bar upstream fails", async () => {
    const store = tempStore();

    const result = await produceDailySpyBreadth({
      store,
      now: () => new Date("2026-08-06T22:00:00.000Z"),
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
    });

    expect(result).toMatchObject({
      status: "failed",
      reason: "upstream_bars_unavailable",
    });
    expect(await store.readLatestPointer()).toBeNull();
  });

  it("skips publish when breadth is unavailable", async () => {
    const store = tempStore();
    const staleUniverse = {
      ...freshUniverse(),
      stale: true,
      sessionLag: 5,
      status: "unavailable" as const,
    };

    const result = await produceDailySpyBreadth({
      store,
      now: () => new Date("2026-08-06T22:00:00.000Z"),
      loadUniverse: async () => ({
        artifact: staleUniverse,
        source: "network",
        error: null,
      }),
      loadBarPanel: async () => panelForTargetSession("2026-08-06"),
    });

    expect(result).toMatchObject({
      status: "skipped",
      reason: "breadth_unavailable",
      marketSessionDate: "2026-08-06",
    });
    expect(await store.readLatestPointer()).toBeNull();
  });

  it("is idempotent when re-run with the same valid snapshot", async () => {
    const store = tempStore();
    const targetSession = "2026-08-06";
    const now = new Date("2026-08-06T22:00:00.000Z");
    const deps = {
      store,
      now: () => now,
      loadUniverse: async () => ({
        artifact: freshUniverse(),
        source: "network" as const,
        error: null,
      }),
      loadBarPanel: async () => panelForTargetSession(targetSession),
    };

    const first = await produceDailySpyBreadth(deps);
    const second = await produceDailySpyBreadth(deps);

    expect(first.status).toBe("published");
    expect(second.status).toBe("published");
    if (first.status === "published" && second.status === "published") {
      expect(second.snapshotIdentity).toBe(first.snapshotIdentity);
    }
  });

  it("retains prior latest when publish fails", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "gammadesk-breadth-producer-"));
    const store = createFilesystemBreadthSnapshotStore({ dataRoot });
    const targetSession = "2026-08-06";
    const now = new Date("2026-08-06T22:00:00.000Z");

    await produceDailySpyBreadth({
      store,
      now: () => now,
      loadUniverse: async () => ({
        artifact: freshUniverse(),
        source: "network",
        error: null,
      }),
      loadBarPanel: async () => panelForTargetSession(targetSession),
    });

    const failingStore = createFilesystemBreadthSnapshotStore({ dataRoot });
    failingStore.publishLatest = async () => {
      throw new BreadthStoreError("publish_failed", "simulated publish failure");
    };

    const second = await produceDailySpyBreadth({
      store: failingStore,
      now: () => new Date("2026-08-07T22:00:00.000Z"),
      loadUniverse: async () => ({
        artifact: freshUniverse(),
        source: "network",
        error: null,
      }),
      loadBarPanel: async () => panelForTargetSession("2026-08-07"),
    });

    expect(second).toMatchObject({
      status: "failed",
      reason: "publish_failed",
    });

    const latest = await store.readLatestPointer();
    expect(latest?.marketSessionDate).toBe(targetSession);
  });

  it("uses last completed session on weekend without treating calendar day as final", async () => {
    const store = tempStore();
    const saturday = new Date("2026-08-08T22:00:00.000Z");
  // Saturday → last completed session should be Friday 2026-08-07
    const result = await produceDailySpyBreadth({
      store,
      now: () => saturday,
      loadUniverse: async (options) => {
        expect(options.targetMarketSessionDate).toBe("2026-08-07");
        return {
          artifact: freshUniverse(),
          source: "network",
          error: null,
        };
      },
      loadBarPanel: async () => panelForTargetSession("2026-08-07"),
    });

    expect(result).toMatchObject({
      status: "published",
      marketSessionDate: "2026-08-07",
    });
  });
});
