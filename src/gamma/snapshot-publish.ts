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

/** Test-only hooks; production callers omit. */
export interface SnapshotPublishHooks {
  afterTempWrite?: (ctx: SnapshotPublishContext) => void;
  beforeLink?: (ctx: SnapshotPublishContext) => void;
}

export type AtomicPublishResult =
  | { readonly outcome: "published" }
  | { readonly outcome: "already_exists"; readonly finalPath: string };

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
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
 */
export function writeSnapshotTempFile(
  finalPath: string,
  payload: string,
): string {
  const dir = dirname(finalPath);
  const tempPath = join(
    dir,
    `.${basename(finalPath)}.tmp.${process.pid}.${Date.now()}`,
  );
  mkdirSync(dir, { recursive: true });

  const fd = openSync(tempPath, "wx");
  try {
    writeSync(fd, payload, undefined, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  return tempPath;
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
    tempPath = writeSnapshotTempFile(finalPath, payload);
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
