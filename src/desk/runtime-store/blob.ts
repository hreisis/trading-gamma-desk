import type { BlobStoreClient } from "@/desk/breadth/store/blob-client";
import { assertSafeStoreRelativePath } from "./path-safety";
import type { RuntimeJsonStore, RuntimeJsonStorePutOptions } from "./types";

export interface BlobRuntimeJsonStoreOptions {
  readonly client: BlobStoreClient;
  readonly prefix?: string;
}

function blobKey(prefix: string, relativePath: string): string {
  assertSafeStoreRelativePath(relativePath);
  const trimmedPrefix = prefix.replace(/\/+$/g, "");
  if (trimmedPrefix.length === 0) {
    return relativePath;
  }
  assertSafeStoreRelativePath(trimmedPrefix);
  return `${trimmedPrefix}/${relativePath}`;
}

function relativeFromBlobKey(prefix: string, pathname: string): string {
  const trimmedPrefix = prefix.replace(/\/+$/g, "");
  const storeKeyPrefix =
    trimmedPrefix.length > 0 ? `${trimmedPrefix}/` : "";
  if (
    storeKeyPrefix.length > 0 &&
    pathname.startsWith(storeKeyPrefix)
  ) {
    return pathname.slice(storeKeyPrefix.length);
  }
  return pathname;
}

export function createBlobRuntimeJsonStore(
  options: BlobRuntimeJsonStoreOptions,
): RuntimeJsonStore {
  const client = options.client;
  const prefix = options.prefix ?? "desk";

  return {
    mode: "blob",
    rootLabel: `blob:${prefix}`,

    async readText(relativePath) {
      return await client.get(blobKey(prefix, relativePath));
    },

    async writeText(relativePath, body, putOptions?: RuntimeJsonStorePutOptions) {
      const key = blobKey(prefix, relativePath);
      const exists = await client.get(key);
      if (exists !== null && putOptions?.allowOverwrite !== true) {
        return false;
      }
      await client.put(key, body, {
        allowOverwrite: putOptions?.allowOverwrite ?? false,
      });
      return true;
    },

    async exists(relativePath) {
      const raw = await client.get(blobKey(prefix, relativePath));
      return raw !== null;
    },

    async list(prefixSegment) {
      assertSafeStoreRelativePath(prefixSegment);
      const listPrefix = blobKey(prefix, prefixSegment);
      const pathnames = await client.list(listPrefix);
      return pathnames
        .filter((pathname) => pathname.endsWith(".json"))
        .map((pathname) => relativeFromBlobKey(prefix, pathname));
    },
  };
}
