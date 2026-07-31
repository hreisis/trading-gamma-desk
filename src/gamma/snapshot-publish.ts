import { randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

export interface SnapshotPublishContext {
  readonly tempPath: string;
  readonly finalPath: string;
}

/** Injectable hooks for temp-file write failures (tests only). */
export interface SnapshotTempWriteHooks {
  afterOpen?: (ctx: { readonly tempPath: string; readonly fd: number }) => void;
  beforeFsync?: (ctx: { readonly tempPath: string; readonly fd: number }) => void;
}

/** Test-only hooks; production callers omit. */
export interface SnapshotPublishHooks {
  afterTempWrite?: (ctx: SnapshotPublishContext) => void;
  beforeLink?: (ctx: SnapshotPublishContext) => void;
  tempWrite?: SnapshotTempWriteHooks;
}

export type AtomicPublishResult =
  | { readonly outcome: "published" }
  | { readonly outcome: "already_exists"; readonly finalPath: string };

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}

function uniqueTempSuffix(): string {
  return `${process.pid}.${Date.now()}.${randomBytes(8).toString("hex")}`;
}

export function buildSnapshotTempPath(finalPath: string): string {
  const dir = dirname(finalPath);
  return join(
    dir,
    `.${basename(finalPath)}.tmp.${uniqueTempSuffix()}`,
  );
}

export function cleanupSnapshotTempFile(tempPath: string): void {
  try {
    if (existsSync(tempPath)) unlinkSync(tempPath);
  } catch {
    // best-effort — publication may have already unlinked the temp name
  }
}

/**
 * Write the full payload to a same-directory exclusive temp file, fsync, and close.
 * Removes the temp file when write/fsync/close fails before returning.
 */
export function writeSnapshotTempFile(
  finalPath: string,
  payload: string,
  hooks?: SnapshotTempWriteHooks,
): string {
  const dir = dirname(finalPath);
  const tempPath = buildSnapshotTempPath(finalPath);
  mkdirSync(dir, { recursive: true });

  let fd: number | null = null;
  try {
    fd = openSync(tempPath, "wx");
    hooks?.afterOpen?.({ tempPath, fd });
    writeSync(fd, payload, undefined, "utf8");
    hooks?.beforeFsync?.({ tempPath, fd });
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    return tempPath;
  } catch (err) {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        // ignore close errors during failure cleanup
      }
    }
    cleanupSnapshotTempFile(tempPath);
    throw err;
  }
}

/**
 * Publish a fully written temp file via hard link (no-replace). The final path
 * becomes visible only after the link succeeds; readers never see partial JSON.
 */
export function publishSnapshotAtomically(
  finalPath: string,
  payload: string,
  hooks?: SnapshotPublishHooks,
): AtomicPublishResult {
  mkdirSync(dirname(finalPath), { recursive: true });

  let tempPath: string | null = null;
  try {
    tempPath = writeSnapshotTempFile(finalPath, payload, hooks?.tempWrite);
    const ctx: SnapshotPublishContext = { tempPath, finalPath };

    hooks?.afterTempWrite?.(ctx);
    hooks?.beforeLink?.(ctx);

    try {
      linkSync(tempPath, finalPath);
      unlinkSync(tempPath);
      tempPath = null;
      return { outcome: "published" };
    } catch (err) {
      if (isNodeError(err) && err.code === "EEXIST") {
        cleanupSnapshotTempFile(tempPath as string);
        tempPath = null;
        return { outcome: "already_exists", finalPath };
      }
      throw err;
    }
  } finally {
    if (tempPath !== null) {
      cleanupSnapshotTempFile(tempPath);
    }
  }
}
