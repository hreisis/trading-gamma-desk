import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DominantDriver,
  type DominantDriver as DominantDriverType,
} from "@/contracts";

export const FIXTURE_DRIVER_PATH =
  "fixtures/macro/dominant-driver.rates-led-easing.json";

export type DeskPayloadSource = "local_driver" | "fixture";

export interface MacroDeskPayload {
  readonly driver: DominantDriverType;
  /** Where the DominantDriver was loaded from. Never recomputed in the UI. */
  readonly source: DeskPayloadSource;
  /** Present when a matching MacroComputeSnapshot exists locally. */
  readonly snapshotPresent: boolean;
  readonly snapshotPath: string | null;
  readonly driverPath: string;
}

function latestJsonSession(dir: string): string | null {
  if (!existsSync(dir)) return null;
  const sessions = readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.replace(/\.json$/, ""))
    .filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name))
    .sort();
  return sessions.at(-1) ?? null;
}

function readDriverFile(path: string): DominantDriverType {
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  return DominantDriver.parse(raw);
}

/**
 * Load the desk surface from precomputed artifacts only.
 *
 * Prefer `data/drivers/<session>.json` (interpretation). Never classify or
 * re-score here — that stays in ingest/interpret scripts. Falls back to the
 * checked-in DominantDriver fixture so CI/build need no local `data/`.
 */
export function loadMacroDesk(
  dataRoot: string = "data",
  fixturePath: string = FIXTURE_DRIVER_PATH,
): MacroDeskPayload {
  const driversDir = join(dataRoot, "drivers");
  const snapshotsDir = join(dataRoot, "snapshots");
  const localSession = latestJsonSession(driversDir);

  if (localSession !== null) {
    const driverPath = join(driversDir, `${localSession}.json`);
    const snapshotPath = join(snapshotsDir, `${localSession}.json`);
    const snapshotPresent = existsSync(snapshotPath);
    return {
      driver: readDriverFile(driverPath),
      source: "local_driver",
      snapshotPresent,
      snapshotPath: snapshotPresent ? snapshotPath : null,
      driverPath,
    };
  }

  return {
    driver: readDriverFile(fixturePath),
    source: "fixture",
    snapshotPresent: false,
    snapshotPath: null,
    driverPath: fixturePath,
  };
}
