/**
 * Minimal Blob client surface injected into the breadth store adapter.
 * Production wiring uses `@vercel/blob` SDK; tests use in-memory fakes.
 */
export interface BlobStorePutOptions {
  /** When false (default), put rejects overwriting an existing pathname. */
  readonly allowOverwrite?: boolean;
}

export interface BlobStoreClient {
  put(path: string, body: string, options?: BlobStorePutOptions): Promise<void>;
  get(path: string): Promise<string | null>;
}

export const BREADTH_BLOB_TOKEN_ENV_KEYS = [
  "BLOB_READ_WRITE_TOKEN",
  "VERCEL_BLOB_READ_WRITE_TOKEN",
] as const;

export function readBreadthBlobToken(
  env: Record<string, string | undefined> = process.env,
): string | null {
  for (const key of BREADTH_BLOB_TOKEN_ENV_KEYS) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return null;
}

export function isBreadthBlobConfigured(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return readBreadthBlobToken(env) !== null;
}
