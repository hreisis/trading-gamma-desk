import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { writeJsonAtomic } from "@/desk/atomic-write";
import { catalystUpdateLockPath } from "./paths";

export const CATALYST_UPDATE_LOCK_STALE_MS = 30 * 60 * 1000;

export interface CatalystUpdateLock {
  readonly kind: "CatalystUpdateLock";
  readonly schemaVersion: "0.1.0";
  readonly runId: string;
  readonly pid: number;
  readonly startedAt: string;
  readonly hostname?: string;
}

export type LockAcquireResult =
  | { readonly ok: true; readonly lock: CatalystUpdateLock; readonly path: string }
  | {
      readonly ok: false;
      readonly reason: "held" | "error";
      readonly error: string;
      readonly existing?: CatalystUpdateLock;
    };

function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function readUpdateLock(
  dataRoot: string,
): CatalystUpdateLock | null {
  const path = catalystUpdateLockPath(dataRoot);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!raw || typeof raw !== "object") return null;
    const o = raw as Record<string, unknown>;
    if (o.kind !== "CatalystUpdateLock") return null;
    if (typeof o.runId !== "string" || typeof o.pid !== "number") return null;
    if (typeof o.startedAt !== "string") return null;
    return {
      kind: "CatalystUpdateLock",
      schemaVersion: "0.1.0",
      runId: o.runId,
      pid: o.pid,
      startedAt: o.startedAt,
      hostname: typeof o.hostname === "string" ? o.hostname : undefined,
    };
  } catch {
    return null;
  }
}

function isStale(lock: CatalystUpdateLock, now: Date): boolean {
  const started = Date.parse(lock.startedAt);
  if (!Number.isFinite(started)) return true;
  if (now.getTime() - started > CATALYST_UPDATE_LOCK_STALE_MS) return true;
  if (!isPidAlive(lock.pid)) return true;
  return false;
}

/**
 * Acquire single-instance update lock. Stale locks (dead PID or >30m) are cleared.
 */
export function acquireUpdateLock(options: {
  readonly dataRoot: string;
  readonly runId: string;
  readonly now?: Date;
}): LockAcquireResult {
  const now = options.now ?? new Date();
  const path = catalystUpdateLockPath(options.dataRoot);
  const existing = readUpdateLock(options.dataRoot);
  if (existing) {
    if (!isStale(existing, now)) {
      return {
        ok: false,
        reason: "held",
        error: `Update lock held by run ${existing.runId} (pid ${existing.pid}) since ${existing.startedAt}`,
        existing,
      };
    }
    // Safe stale-lock recovery
    try {
      unlinkSync(path);
    } catch {
      // continue — writeJsonAtomic rename may still succeed
    }
  }

  const lock: CatalystUpdateLock = {
    kind: "CatalystUpdateLock",
    schemaVersion: "0.1.0",
    runId: options.runId,
    pid: process.pid,
    startedAt: now.toISOString(),
  };
  try {
    writeJsonAtomic(path, lock);
    // Verify we own it (detect race)
    const verify = readUpdateLock(options.dataRoot);
    if (!verify || verify.runId !== options.runId || verify.pid !== process.pid) {
      return {
        ok: false,
        reason: "held",
        error: "Update lock race — another process acquired the lock",
        existing: verify ?? undefined,
      };
    }
    return { ok: true, lock, path };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: "error", error: message };
  }
}

export function releaseUpdateLock(options: {
  readonly dataRoot: string;
  readonly runId: string;
}): void {
  const path = catalystUpdateLockPath(options.dataRoot);
  const existing = readUpdateLock(options.dataRoot);
  if (!existing) return;
  if (existing.runId !== options.runId) return;
  try {
    unlinkSync(path);
  } catch {
    // best-effort
  }
}
