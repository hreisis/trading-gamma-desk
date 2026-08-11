import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { BreadthInternalsSnapshot } from "@/contracts/breadth-internals";
import {
  BREADTH_SNAPSHOT_POINTER_SCHEMA_VERSION,
  type BreadthSnapshotPointer,
} from "@/contracts/breadth-snapshot-pointer";
import {
  BreadthStoreError,
  createBlobBreadthSnapshotStore,
  createFilesystemBreadthSnapshotStore,
  createInMemoryBlobStoreClient,
  publishBreadthSnapshot,
} from "@/desk/breadth/store";
import {
  computePublishableSnapshotForSession,
  legacyStoredSnapshotJson,
  samplePublishableBreadthSnapshot,
  tradingDaysEndingAt,
} from "./helpers/breadth-fixtures";
import {
  breadthSnapshotIdentity,
  breadthSnapshotRelativePath,
} from "@/desk/breadth/store/identity";
import {
  BREADTH_INTERNALS_LEGACY_SCHEMA_VERSION,
  BREADTH_INTERNALS_SCHEMA_VERSION,
  isLegacyBreadthInternalsSnapshot,
} from "@/contracts/breadth-internals";

function sampleBreadthSnapshot(): BreadthInternalsSnapshot {
  return samplePublishableBreadthSnapshot();
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

    const second = computePublishableSnapshotForSession(
      "2026-08-07",
      "2026-08-07T16:00:00.000Z",
    );

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

  it("reads snapshot by session, recent history sorted deduped, and missing session", async () => {
    const dataRoot = tempDataRoot();
    const store = createFilesystemBreadthSnapshotStore({ dataRoot });
    const sessions = tradingDaysEndingAt("2026-08-07", 5);
    for (const session of sessions) {
      const snapshot = computePublishableSnapshotForSession(
        session,
        `${session}T16:00:00.000Z`,
      );
      await publishBreadthSnapshot(store, snapshot, `${session}T16:05:00.000Z`);
    }

    const latestSession = sessions.at(-1)!;
    const duplicateLatest = {
      ...computePublishableSnapshotForSession(
        latestSession,
        `${latestSession}T16:00:00.000Z`,
      ),
      asOf: `${latestSession}T17:00:00.000Z`,
    };
    await store.writeVersioned(duplicateLatest);

    const firstSession = sessions[0]!;
    const bySession = await store.readSnapshotBySessionDate(firstSession);
    expect(bySession?.marketSessionDate).toBe(firstSession);
    expect(bySession?.schemaVersion).toBe(BREADTH_INTERNALS_SCHEMA_VERSION);

    expect(await store.readSnapshotBySessionDate("2026-07-01")).toBeNull();

    const recent = await store.readRecentSnapshots({ limit: 5 });
    expect(recent.status).toBe("available");
    expect(recent.snapshots.map((row) => row.marketSessionDate)).toEqual(
      [...sessions].reverse(),
    );
    expect(recent.snapshots[0]?.asOf).toBe(`${latestSession}T17:00:00.000Z`);
  });

  it("isolates legacy 0.1.0 from recent trend series", async () => {
    const dataRoot = tempDataRoot();
    const store = createFilesystemBreadthSnapshotStore({ dataRoot });
    const currentSessions = tradingDaysEndingAt("2026-08-07", 5);
    for (const session of currentSessions) {
      const snapshot = computePublishableSnapshotForSession(
        session,
        `${session}T16:00:00.000Z`,
      );
      await publishBreadthSnapshot(store, snapshot, `${session}T16:05:00.000Z`);
    }

    const legacySessions = tradingDaysEndingAt("2026-07-31", 3);
    for (const session of legacySessions) {
      const snapshot = computePublishableSnapshotForSession(
        session,
        `${session}T16:00:00.000Z`,
      );
      const identity = breadthSnapshotIdentity(snapshot);
      const relativePath = breadthSnapshotRelativePath(
        "spy_etf_holdings",
        identity,
      );
      const absolutePath = join(dataRoot, "breadth", relativePath);
      mkdirSync(join(dataRoot, "breadth", "spy_etf_holdings", "snapshots"), {
        recursive: true,
      });
      writeFileSync(absolutePath, legacyStoredSnapshotJson(snapshot));
    }

    const recent = await store.readRecentSnapshots({ limit: 10 });
    expect(recent.status).toBe("available");
    expect(recent.snapshots).toHaveLength(5);
    expect(
      recent.snapshots.every(
        (row) => row.schemaVersion === BREADTH_INTERNALS_SCHEMA_VERSION,
      ),
    ).toBe(true);
    expect(
      recent.snapshots.some((row) =>
        legacySessions.includes(row.marketSessionDate),
      ),
    ).toBe(false);

    const legacySession = legacySessions[0]!;
    const legacyRead = await store.readSnapshotBySessionDate(legacySession);
    expect(legacyRead).not.toBeNull();
    expect(isLegacyBreadthInternalsSnapshot(legacyRead!)).toBe(true);
    expect(legacyRead?.schemaVersion).toBe(BREADTH_INTERNALS_LEGACY_SCHEMA_VERSION);
    expect(legacyRead?.metrics).toHaveProperty("new20DayHigh");
    expect(legacyRead?.metrics).not.toHaveProperty("new20DayClosingHigh");
  });

  it("returns insufficient_history without padding legacy snapshots", async () => {
    const dataRoot = tempDataRoot();
    const store = createFilesystemBreadthSnapshotStore({ dataRoot });
    const sessions = tradingDaysEndingAt("2026-08-06", 3);
    for (const session of sessions) {
      const snapshot = computePublishableSnapshotForSession(
        session,
        `${session}T16:00:00.000Z`,
      );
      await publishBreadthSnapshot(store, snapshot, `${session}T16:05:00.000Z`);
    }

    const legacySnapshot = computePublishableSnapshotForSession(
      "2026-07-25",
      "2026-07-25T16:00:00.000Z",
    );
    const legacyIdentity = breadthSnapshotIdentity(legacySnapshot);
    const legacyPath = join(
      dataRoot,
      "breadth",
      breadthSnapshotRelativePath("spy_etf_holdings", legacyIdentity),
    );
    mkdirSync(join(dataRoot, "breadth", "spy_etf_holdings", "snapshots"), {
      recursive: true,
    });
    writeFileSync(legacyPath, legacyStoredSnapshotJson(legacySnapshot));

    const recent = await store.readRecentSnapshots({ limit: 10 });
    expect(recent.status).toBe("insufficient_history");
    expect(recent.snapshots).toHaveLength(3);
    expect(recent.missingReason).toMatch(/Only 3 schema 0\.2\.0/);
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

    const second = computePublishableSnapshotForSession(
      "2026-08-07",
      "2026-08-07T16:00:00.000Z",
    );

    const failingClient = createInMemoryBlobStoreClient(
      Object.fromEntries(client.entries),
    );
    const failingStore = createBlobBreadthSnapshotStore({
      client: {
        put: failingClient.put,
        get: failingClient.get,
        list: failingClient.list,
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

  it("reads recent and session snapshots from blob store", async () => {
    const client = createInMemoryBlobStoreClient();
    const store = createBlobBreadthSnapshotStore({ client, prefix: "breadth" });
    const sessions = tradingDaysEndingAt("2026-08-07", 5);
    for (const session of sessions) {
      const snapshot = computePublishableSnapshotForSession(
        session,
        `${session}T16:00:00.000Z`,
      );
      await publishBreadthSnapshot(store, snapshot, `${session}T16:05:00.000Z`);
    }

    const latestSession = sessions.at(-1)!;
    const bySession = await store.readSnapshotBySessionDate(latestSession);
    expect(bySession?.schemaVersion).toBe(BREADTH_INTERNALS_SCHEMA_VERSION);

    const recent = await store.readRecentSnapshots({ limit: 6 });
    expect(recent.status).toBe("available");
    expect(recent.snapshots.map((row) => row.marketSessionDate)).toEqual(
      [...sessions].reverse(),
    );
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
