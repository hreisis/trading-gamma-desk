import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createBreadthSnapshotStoreFromEnv,
  resolveBreadthSnapshotStoreFromEnv,
} from "@/desk/breadth/store/create-store";

describe("resolveBreadthSnapshotStoreFromEnv", () => {
  it("uses filesystem store in local development without blob token", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "gammadesk-breadth-store-env-"));
    const resolution = resolveBreadthSnapshotStoreFromEnv({}, { dataRoot });

    expect(resolution.ok).toBe(true);
    if (resolution.ok) {
      expect(resolution.store.mode).toBe("filesystem");
    }
  });

  it("fail closed on Vercel/production host without blob token", () => {
    const resolution = resolveBreadthSnapshotStoreFromEnv({ VERCEL: "1" });

    expect(resolution).toEqual({
      ok: false,
      reason: "blob_unconfigured",
      message:
        "Breadth durable storage requires BLOB_READ_WRITE_TOKEN on Vercel — filesystem fallback is disabled in production",
    });
  });

  it("uses blob store when production host has blob token configured", () => {
    const resolution = resolveBreadthSnapshotStoreFromEnv({
      VERCEL: "1",
      BLOB_READ_WRITE_TOKEN: "test-blob-token",
    });

    expect(resolution.ok).toBe(true);
    if (resolution.ok) {
      expect(resolution.store.mode).toBe("blob");
    }
    expect(JSON.stringify(resolution)).not.toContain("test-blob-token");
  });

  it("createBreadthSnapshotStoreFromEnv throws on production without blob token", () => {
    expect(() =>
      createBreadthSnapshotStoreFromEnv({ VERCEL: "1" }),
    ).toThrow(/BLOB_READ_WRITE_TOKEN/);
  });
});
