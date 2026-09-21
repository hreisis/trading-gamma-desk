import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createInMemoryBlobStoreClient } from "@/desk/breadth/store/blob";
import { createBlobRuntimeJsonStore } from "@/desk/runtime-store/blob";
import { createFilesystemRuntimeJsonStore } from "@/desk/runtime-store/filesystem";
import { readJson, writeJson } from "@/desk/runtime-store/json";
import { resolveRuntimeJsonStore } from "@/desk/runtime-store/resolve";

describe("runtime json store filesystem", () => {
  it("reads and writes JSON under a data root", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "runtime-store-fs-"));
    try {
      const store = createFilesystemRuntimeJsonStore({ dataRoot });
      const relativePath = "risk-decision-v1/2026-08-12.json";
      const payload = { sessionDate: "2026-08-12", riskScore: 55 };

      expect(await writeJson(store, relativePath, payload)).toBe(true);
      expect(await readJson(store, relativePath)).toEqual(payload);
      expect(await writeJson(store, relativePath, payload)).toBe(false);
      expect(
        await writeJson(store, relativePath, { riskScore: 60 }, {
          allowOverwrite: true,
        }),
      ).toBe(true);

      const onDisk = JSON.parse(
        readFileSync(join(dataRoot, relativePath), "utf8"),
      ) as { riskScore: number };
      expect(onDisk.riskScore).toBe(60);
      expect(await store.list("risk-decision-v1")).toEqual([
        "risk-decision-v1/2026-08-12.json",
      ]);
    } finally {
      rmSync(dataRoot, { recursive: true, force: true });
    }
  });

  it("resolveRuntimeJsonStore uses local filesystem when data/ exists", () => {
    const store = resolveRuntimeJsonStore({ ...process.env, VERCEL: "" });
    expect(store.mode).toBe("filesystem");
    expect(store.rootLabel).toContain("data");
  });
});

describe("runtime json store blob", () => {
  it("overwrites without a read but keeps create-only protection", async () => {
    const client = createInMemoryBlobStoreClient();
    const get = vi.spyOn(client, "get");
    const store = createBlobRuntimeJsonStore({ client });
    await store.writeText("test.json", "first", { allowOverwrite: true });
    await store.writeText("test.json", "second", { allowOverwrite: true });
    expect(get).not.toHaveBeenCalled();
    expect(await store.writeText("test.json", "third")).toBe(false);
    expect(await store.readText("test.json")).toBe("second");
  });
  it("reads and writes JSON via in-memory blob client", async () => {
    const client = createInMemoryBlobStoreClient();
    const store = createBlobRuntimeJsonStore({ client, prefix: "desk" });
    const relativePath =
      "gamma/providers/marketdata-app/SPY-bounded-latest.json";
    const payload = { symbol: "SPY", sessionDate: "2026-08-12" };

    expect(await writeJson(store, relativePath, payload)).toBe(true);
    expect(await readJson(store, relativePath)).toEqual(payload);
    expect(await writeJson(store, relativePath, payload)).toBe(false);
    expect(
      await writeJson(store, relativePath, { symbol: "SPY", sessionDate: "2026-08-13" }, {
        allowOverwrite: true,
      }),
    ).toBe(true);
    expect(await store.list("gamma/providers/marketdata-app")).toEqual([
      relativePath,
    ]);
  });
});
