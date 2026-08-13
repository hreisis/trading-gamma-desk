import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DominantDriver } from "@/contracts";
import type { MacroSnapshot } from "@/ingest";
import { interpretSnapshot } from "@/interpret";
import { writeJsonAtomic } from "@/desk/atomic-write";
import {
  artifactSourceLabel,
  readJson,
  writeJson,
  type RuntimeJsonStore,
} from "@/desk/runtime-store";
import {
  writePipelineError,
  writePipelineOk,
} from "@/desk/pipeline-status";

export interface InterpretWriteResult {
  readonly driver: DominantDriver;
  readonly driverPath: string;
  readonly session: string;
}

function latestSnapshotSession(root: string): string {
  const dir = join(root, "snapshots");
  if (!existsSync(dir)) {
    throw new Error(`no snapshots under ${dir}; run npm run ingest first`);
  }
  const sessions = readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.replace(/\.json$/, ""))
    .filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name))
    .sort();
  const latest = sessions.at(-1);
  if (!latest) {
    throw new Error(`no snapshots under ${dir}; run npm run ingest first`);
  }
  return latest;
}

/**
 * Read a compute snapshot, build DominantDriver, atomically replace the
 * driver file. On failure the previous driver file is left untouched.
 */
export function interpretAndWriteDriver(options: {
  readonly dataRoot?: string;
  readonly session?: string;
  readonly updatePipelineStatus?: boolean;
}): InterpretWriteResult {
  const root = options.dataRoot ?? "data";
  const updateStatus = options.updatePipelineStatus !== false;
  const session =
    options.session && /^\d{4}-\d{2}-\d{2}$/.test(options.session)
      ? options.session
      : latestSnapshotSession(root);

  const snapshotPath = join(root, "snapshots", `${session}.json`);
  if (!existsSync(snapshotPath)) {
    const message = `missing snapshot ${snapshotPath}`;
    if (updateStatus) {
      writePipelineError({
        dataRoot: root,
        stage: "interpret",
        error: message,
        attemptedSession: session,
      });
    }
    throw new Error(message);
  }

  try {
    const snapshot = JSON.parse(
      readFileSync(snapshotPath, "utf8"),
    ) as MacroSnapshot;
    if (snapshot.kind !== "MacroComputeSnapshot") {
      throw new Error(
        `expected MacroComputeSnapshot at ${snapshotPath}, got ${String(snapshot.kind)}`,
      );
    }

    const driver = interpretSnapshot(snapshot);
    const driverPath = join(root, "drivers", `${session}.json`);
    // Atomic replace: validate first (interpretSnapshot already parsed), then
    // temp+rename so a crash cannot leave a truncated live driver.
    writeJsonAtomic(driverPath, driver);

    if (updateStatus) {
      writePipelineOk({
        dataRoot: root,
        stage: "interpret",
        session,
        driverPath,
      });
    }

    return { driver, driverPath, session };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (updateStatus) {
      writePipelineError({
        dataRoot: root,
        stage: "interpret",
        error: message,
        attemptedSession: session,
      });
    }
    throw error instanceof Error ? error : new Error(message);
  }
}

/**
 * Interpret macro snapshot and persist driver to durable artifact store.
 * Ephemeral pipeline status still writes to dataRoot filesystem.
 */
export async function interpretAndWriteDriverAsync(options: {
  readonly dataRoot?: string;
  readonly session?: string;
  readonly updatePipelineStatus?: boolean;
  readonly artifactStore?: RuntimeJsonStore;
}): Promise<InterpretWriteResult> {
  const root = options.dataRoot ?? "data";
  const updateStatus = options.updatePipelineStatus !== false;
  const session =
    options.session && /^\d{4}-\d{2}-\d{2}$/.test(options.session)
      ? options.session
      : latestSnapshotSession(root);

  const snapshotRelativePath = `snapshots/${session}.json`;
  const snapshotPath = join(root, "snapshots", `${session}.json`);

  let snapshotRaw: unknown | null = null;
  if (options.artifactStore) {
    snapshotRaw = await readJson(options.artifactStore, snapshotRelativePath);
  }
  if (snapshotRaw === null && existsSync(snapshotPath)) {
    snapshotRaw = JSON.parse(readFileSync(snapshotPath, "utf8")) as unknown;
  }

  if (snapshotRaw === null) {
    const message = `missing snapshot ${snapshotPath}`;
    if (updateStatus) {
      writePipelineError({
        dataRoot: root,
        stage: "interpret",
        error: message,
        attemptedSession: session,
      });
    }
    throw new Error(message);
  }

  try {
    const snapshot = snapshotRaw as MacroSnapshot;
    if (snapshot.kind !== "MacroComputeSnapshot") {
      throw new Error(
        `expected MacroComputeSnapshot at ${snapshotPath}, got ${String(snapshot.kind)}`,
      );
    }

    const driver = interpretSnapshot(snapshot);
    const driverRelativePath = `drivers/${session}.json`;
    const driverPath = join(root, "drivers", `${session}.json`);

    if (options.artifactStore) {
      await writeJson(options.artifactStore, driverRelativePath, driver, {
        allowOverwrite: true,
      });
    }
    writeJsonAtomic(driverPath, driver);

    const driverLabel = options.artifactStore
      ? artifactSourceLabel(options.artifactStore, driverRelativePath)
      : driverPath;

    if (updateStatus) {
      writePipelineOk({
        dataRoot: root,
        stage: "interpret",
        session,
        driverPath: driverLabel,
      });
    }

    return { driver, driverPath: driverLabel, session };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (updateStatus) {
      writePipelineError({
        dataRoot: root,
        stage: "interpret",
        error: message,
        attemptedSession: session,
      });
    }
    throw error instanceof Error ? error : new Error(message);
  }
}
