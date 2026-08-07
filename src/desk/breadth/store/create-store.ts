import {
  createBlobBreadthSnapshotStore,
  createFilesystemBreadthSnapshotStore,
  createFetchVercelBlobStoreClient,
  readBreadthBlobToken,
  type BreadthSnapshotStore,
} from "./index";

export function createBreadthSnapshotStoreFromEnv(
  env: Record<string, string | undefined> = process.env,
  options?: {
    readonly fetchImpl?: typeof fetch;
    readonly dataRoot?: string;
    readonly blobPrefix?: string;
  },
): BreadthSnapshotStore {
  const token = readBreadthBlobToken(env);
  if (token) {
    return createBlobBreadthSnapshotStore({
      client: createFetchVercelBlobStoreClient({
        token,
        fetchImpl: options?.fetchImpl,
      }),
      prefix: options?.blobPrefix ?? "breadth",
    });
  }

  return createFilesystemBreadthSnapshotStore({
    dataRoot: options?.dataRoot ?? "data",
  });
}
