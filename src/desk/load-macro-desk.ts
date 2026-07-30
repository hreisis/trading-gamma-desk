import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DominantDriver,
  type DominantDriver as DominantDriverType,
} from "@/contracts";
import { deskSourceLabel } from "./format";
import { readPipelineStatus } from "./pipeline-status";
import type {
  DeskError,
  DeskPayloadSource,
  MacroDeskView,
  PipelineStatus,
} from "./types";

export const FIXTURE_DRIVER_PATH =
  "fixtures/macro/dominant-driver.rates-led-easing.json";

export type { DeskPayloadSource, MacroDeskView };

export interface LoadMacroDeskOptions {
  readonly dataRoot?: string;
  readonly fixturePath?: string;
  /**
   * Force the checked-in demo fixture even when live drivers exist.
   * Used for manual acceptance (`?source=fixture`).
   */
  readonly preferFixture?: boolean;
  /**
   * When false, never serve the fixture. Empty live store → `empty` status.
   */
  readonly allowFixture?: boolean;
  /**
   * @deprecated Prefer `resolveDeskRequest({ publicDemo: true })`, which loads
   * the bundled synthetic fixture. When set, still avoids `data/drivers` but
   * may read `fixturePath` from disk (local/dev only).
   */
  readonly publicDemoMode?: boolean;
}

function listDriverSessions(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.replace(/\.json$/, ""))
    .filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name))
    .sort();
}

function tryParseDriver(
  path: string,
):
  | { ok: true; driver: DominantDriverType }
  | { ok: false; error: string } {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return { ok: true, driver: DominantDriver.parse(raw) };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}

export function isSessionStale(driver: DominantDriverType): boolean {
  if (!driver.isCompleteSession) return true;
  if (driver.sessionAlignment !== "aligned") return true;
  return Object.values(driver.staleDaysByAsset).some(
    (days) => days !== undefined && days !== null && days > 0,
  );
}

function readyView(options: {
  readonly source: DeskPayloadSource;
  readonly driver: DominantDriverType;
  readonly driverPath: string;
  readonly snapshotPresent: boolean;
  readonly snapshotPath: string | null;
  readonly pipeline: PipelineStatus | null;
  readonly error: DeskError | null;
  readonly forceSessionStale?: boolean;
}): MacroDeskView {
  const isDemo = options.source === "fixture";
  const pipelineFailed = options.pipeline !== null && !options.pipeline.ok;
  return {
    status: pipelineFailed ? "pipeline_error" : "ready",
    source: options.source,
    sourceLabel: deskSourceLabel(options.source),
    isDemo,
    isPublicDemo: false,
    isLiveDriver: options.source === "local_driver",
    driver: options.driver,
    driverPath: options.driverPath,
    snapshotPresent: options.snapshotPresent,
    snapshotPath: options.snapshotPath,
    sessionStale:
      options.forceSessionStale === true ||
      isSessionStale(options.driver) ||
      pipelineFailed,
    pipeline: options.pipeline,
    error: options.error,
  };
}

function fixtureView(
  fixturePath: string,
  pipeline: PipelineStatus | null,
): MacroDeskView {
  const parsed = tryParseDriver(fixturePath);
  if (!parsed.ok) {
    return {
      status: "empty",
      source: null,
      sourceLabel: null,
      isDemo: false,
      isPublicDemo: false,
      isLiveDriver: false,
      driver: null,
      driverPath: null,
      snapshotPresent: false,
      snapshotPath: null,
      sessionStale: false,
      pipeline,
      error: {
        code: "empty",
        message: `fixture missing or invalid at ${fixturePath}: ${parsed.error}`,
        path: fixturePath,
      },
    };
  }
  return readyView({
    source: "fixture",
    driver: parsed.driver,
    driverPath: fixturePath,
    snapshotPresent: false,
    snapshotPath: null,
    pipeline,
    error: null,
  });
}

function emptyView(
  pipeline: PipelineStatus | null,
  message: string,
): MacroDeskView {
  return {
    status: "empty",
    source: null,
    sourceLabel: null,
    isDemo: false,
    isPublicDemo: false,
    isLiveDriver: false,
    driver: null,
    driverPath: null,
    snapshotPresent: false,
    snapshotPath: null,
    sessionStale: false,
    pipeline,
    error: { code: "empty", message },
  };
}

/**
 * Load the desk surface from precomputed artifacts only.
 *
 * Rules:
 * - Prefer `data/drivers/<session>.json` (live interpretation).
 * - A present but malformed live driver never silently falls back to fixture.
 * - Fixture is only used when no live driver files exist (or preferFixture).
 * - Pipeline failure keeps the last good driver and surfaces as error/stale.
 */
export function loadMacroDesk(
  options: LoadMacroDeskOptions = {},
): MacroDeskView {
  const dataRoot = options.dataRoot ?? "data";
  const fixturePath = options.fixturePath ?? FIXTURE_DRIVER_PATH;
  const allowFixture = options.allowFixture !== false;
  const pipeline = options.publicDemoMode
    ? null
    : readPipelineStatus(dataRoot);

  // Public demo never opens data/drivers — fixture only.
  if (options.publicDemoMode) {
    return fixtureView(fixturePath, null);
  }

  if (options.preferFixture) {
    if (!allowFixture) {
      return emptyView(pipeline, "fixture requested but allowFixture is false");
    }
    return fixtureView(fixturePath, pipeline);
  }

  const driversDir = join(dataRoot, "drivers");
  const snapshotsDir = join(dataRoot, "snapshots");
  const sessions = listDriverSessions(driversDir);

  if (sessions.length === 0) {
    if (allowFixture) return fixtureView(fixturePath, pipeline);
    return emptyView(
      pipeline,
      `no drivers under ${driversDir}; run npm run daily`,
    );
  }

  const latest = sessions[sessions.length - 1]!;
  const latestPath = join(driversDir, `${latest}.json`);
  const latestParsed = tryParseDriver(latestPath);

  if (!latestParsed.ok) {
    // Live file exists but is corrupt — never degrade to fixture.
    let previous: {
      driver: DominantDriverType;
      path: string;
      session: string;
    } | null = null;
    for (let i = sessions.length - 2; i >= 0; i -= 1) {
      const session = sessions[i]!;
      const path = join(driversDir, `${session}.json`);
      const parsed = tryParseDriver(path);
      if (parsed.ok) {
        previous = { driver: parsed.driver, path, session };
        break;
      }
    }

    const error: DeskError = {
      code: "malformed",
      message: `live driver malformed at ${latestPath}: ${latestParsed.error}`,
      path: latestPath,
    };

    if (previous) {
      const snapshotPath = join(snapshotsDir, `${previous.session}.json`);
      const snapshotPresent = existsSync(snapshotPath);
      return {
        status: "malformed",
        source: "local_driver",
        sourceLabel: deskSourceLabel("local_driver"),
        isDemo: false,
        isPublicDemo: false,
        isLiveDriver: true,
        driver: previous.driver,
        driverPath: previous.path,
        snapshotPresent,
        snapshotPath: snapshotPresent ? snapshotPath : null,
        sessionStale: true,
        pipeline,
        error,
      };
    }

    return {
      status: "malformed",
      source: null,
      sourceLabel: null,
      isDemo: false,
      isPublicDemo: false,
      isLiveDriver: false,
      driver: null,
      driverPath: latestPath,
      snapshotPresent: false,
      snapshotPath: null,
      sessionStale: false,
      pipeline,
      error,
    };
  }

  const snapshotPath = join(snapshotsDir, `${latest}.json`);
  const snapshotPresent = existsSync(snapshotPath);
  const pipelineFailed = pipeline !== null && !pipeline.ok;

  return readyView({
    source: "local_driver",
    driver: latestParsed.driver,
    driverPath: latestPath,
    snapshotPresent,
    snapshotPath: snapshotPresent ? snapshotPath : null,
    pipeline,
    forceSessionStale: pipelineFailed,
    error: pipelineFailed
      ? {
          code: "pipeline",
          message: pipeline.error ?? "pipeline failed",
          stage: pipeline.stage,
          path: pipeline.lastGoodDriverPath ?? latestPath,
        }
      : null,
  });
}

/** @deprecated Prefer loadMacroDesk(); kept for narrow test helpers. */
export type MacroDeskPayload = MacroDeskView;
