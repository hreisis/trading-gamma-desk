import { BreadthStoreError } from "./errors";

const SAFE_SEGMENT = /^[a-zA-Z0-9._-]+$/;

/**
 * Reject path traversal, absolute paths, and unsafe segments in store-relative paths.
 */
export function assertSafeStoreRelativePath(path: string): void {
  if (
    path.length === 0 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("\0")
  ) {
    throw new BreadthStoreError(
      "path_escape",
      `unsafe store-relative path: ${path}`,
    );
  }

  const segments = path.split("/");
  for (const segment of segments) {
    if (
      segment.length === 0 ||
      segment === "." ||
      segment === ".." ||
      !SAFE_SEGMENT.test(segment)
    ) {
      throw new BreadthStoreError(
        "path_escape",
        `unsafe path segment in store-relative path: ${path}`,
      );
    }
  }
}

export function joinStoreRelativePath(...segments: string[]): string {
  const path = segments.join("/");
  assertSafeStoreRelativePath(path);
  return path;
}
