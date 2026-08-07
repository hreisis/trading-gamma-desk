/**
 * Minimal Blob client surface injected into the breadth store adapter.
 * Production wiring can wrap `@vercel/blob` or the REST API; tests use in-memory fakes.
 */
export interface BlobStoreClient {
  put(path: string, body: string): Promise<void>;
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
