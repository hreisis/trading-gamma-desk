import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  readBreadthBlobToken,
} from "@/desk/breadth/store/blob-client";
import { createVercelBlobStoreClient } from "@/desk/breadth/store/vercel-blob-sdk";
import { createFilesystemRuntimeJsonStore } from "./filesystem";
import { createBlobRuntimeJsonStore } from "./blob";
import type { RuntimeJsonStore } from "./types";

function isServerlessHost(env: NodeJS.ProcessEnv): boolean {
  return Boolean((env.VERCEL ?? "").trim());
}

export const RUNTIME_ARTIFACT_BLOB_PREFIX = "desk" as const;

/**
 * Ephemeral serverless scratch (bars cache, catalyst, pipeline status).
 * Not the durable artifact source of truth when Blob is configured.
 */
export function resolveEphemeralDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  const localRoot = join(process.cwd(), "data");
  if (!isServerlessHost(env) || existsSync(localRoot)) {
    return localRoot;
  }
  return join("/tmp", "gammadesk-data");
}

/**
 * Durable runtime JSON artifacts: local `data/` filesystem, or Vercel Blob `desk/`
 * on serverless when `BLOB_READ_WRITE_TOKEN` is set.
 */
export function resolveRuntimeJsonStore(
  env: NodeJS.ProcessEnv = process.env,
): RuntimeJsonStore {
  const localRoot = join(process.cwd(), "data");
  const useLocalFilesystem =
    !isServerlessHost(env) || existsSync(localRoot);

  if (useLocalFilesystem) {
    return createFilesystemRuntimeJsonStore({ dataRoot: localRoot });
  }

  const token = readBreadthBlobToken(env);
  if (token) {
    return createBlobRuntimeJsonStore({
      client: createVercelBlobStoreClient({ token }),
      prefix: RUNTIME_ARTIFACT_BLOB_PREFIX,
    });
  }

  return createFilesystemRuntimeJsonStore({
    dataRoot: resolveEphemeralDataRoot(env),
  });
}

export function artifactSourceLabel(
  store: RuntimeJsonStore,
  relativePath: string,
): string {
  if (store.mode === "blob") {
    return `${store.rootLabel}/${relativePath}`;
  }
  return join(store.rootLabel, relativePath);
}
