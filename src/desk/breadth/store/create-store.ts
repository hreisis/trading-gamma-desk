import { isServerlessHost } from "@/desk/production-runtime";
import { breadthConfigForFund } from "../config";
import {
  createBlobBreadthSnapshotStore,
  createFilesystemBreadthSnapshotStore,
  createVercelBlobStoreClient,
  readBreadthBlobToken,
  type BreadthSnapshotStore,
} from "./index";

export type BreadthStoreResolution =
  | { readonly ok: true; readonly store: BreadthSnapshotStore }
  | {
      readonly ok: false;
      readonly reason: "blob_unconfigured";
      readonly message: string;
    };

export function resolveBreadthSnapshotStoreFromEnv(
  env: Record<string, string | undefined> = process.env,
  options?: {
    readonly fetchImpl?: typeof fetch;
    readonly dataRoot?: string;
    readonly blobPrefix?: string;
    readonly fundSymbol?: "SPY" | "QQQ";
  },
): BreadthStoreResolution {
  const config = breadthConfigForFund(options?.fundSymbol ?? "SPY");
  const token = readBreadthBlobToken(env);
  if (token) {
    return {
      ok: true,
      store: createBlobBreadthSnapshotStore({
        client: createVercelBlobStoreClient({
          token,
        }),
        prefix: options?.blobPrefix ?? "breadth",
        universeId: config.universeId,
        fundSymbol: config.fundSymbol,
      }),
    };
  }

  if (isServerlessHost(env as NodeJS.ProcessEnv)) {
    return {
      ok: false,
      reason: "blob_unconfigured",
      message:
        "Breadth durable storage requires BLOB_READ_WRITE_TOKEN on Vercel — filesystem fallback is disabled in production",
    };
  }

  return {
    ok: true,
    store: createFilesystemBreadthSnapshotStore({
      dataRoot: options?.dataRoot ?? "data",
      universeId: config.universeId,
      fundSymbol: config.fundSymbol,
    }),
  };
}

/** Local-dev convenience; throws when production host has no blob token configured. */
export function createBreadthSnapshotStoreFromEnv(
  env: Record<string, string | undefined> = process.env,
  options?: {
    readonly fetchImpl?: typeof fetch;
    readonly dataRoot?: string;
    readonly blobPrefix?: string;
  },
): BreadthSnapshotStore {
  const resolution = resolveBreadthSnapshotStoreFromEnv(env, options);
  if (!resolution.ok) {
    throw new Error(resolution.message);
  }
  return resolution.store;
}
