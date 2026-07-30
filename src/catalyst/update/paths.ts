import { join } from "node:path";

export const DEFAULT_CATALYST_UPDATE_DATA_ROOT = join(process.cwd(), "data");

export const CATALYST_UPDATE_MANIFEST_RELATIVE =
  "catalyst/update-latest.json";
export const CATALYST_UPDATE_LOCK_RELATIVE = "catalyst/update.lock.json";

export function catalystUpdateManifestPath(
  dataRoot: string = DEFAULT_CATALYST_UPDATE_DATA_ROOT,
): string {
  return join(dataRoot, CATALYST_UPDATE_MANIFEST_RELATIVE);
}

export function catalystUpdateLockPath(
  dataRoot: string = DEFAULT_CATALYST_UPDATE_DATA_ROOT,
): string {
  return join(dataRoot, CATALYST_UPDATE_LOCK_RELATIVE);
}
