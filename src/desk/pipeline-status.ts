import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { PipelineStage, PipelineStatus } from "./types";

export const PIPELINE_STATUS_SCHEMA = "0.1.0" as const;

export function pipelineStatusPath(dataRoot: string): string {
  return join(dataRoot, "pipeline", "status.json");
}

export function readPipelineStatus(
  dataRoot: string,
): PipelineStatus | null {
  const path = pipelineStatusPath(dataRoot);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as PipelineStatus;
    if (raw.kind !== "MacroPipelineStatus") return null;
    return raw;
  } catch {
    return null;
  }
}

function writeStatusAtomic(dataRoot: string, status: PipelineStatus): string {
  const dir = join(dataRoot, "pipeline");
  mkdirSync(dir, { recursive: true });
  const path = pipelineStatusPath(dataRoot);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(status, null, 2) + "\n");
  renameSync(tmp, path);
  return path;
}

export function writePipelineOk(options: {
  readonly dataRoot: string;
  readonly stage: PipelineStage;
  readonly session: string;
  readonly driverPath: string;
}): string {
  return writeStatusAtomic(options.dataRoot, {
    kind: "MacroPipelineStatus",
    schemaVersion: PIPELINE_STATUS_SCHEMA,
    updatedAt: new Date().toISOString(),
    ok: true,
    stage: options.stage,
    error: null,
    attemptedSession: options.session,
    lastGoodSession: options.session,
    lastGoodDriverPath: options.driverPath,
  });
}

export function writePipelineError(options: {
  readonly dataRoot: string;
  readonly stage: PipelineStage;
  readonly error: string;
  readonly attemptedSession?: string | null;
  readonly lastGoodSession?: string | null;
  readonly lastGoodDriverPath?: string | null;
}): string {
  const prior = readPipelineStatus(options.dataRoot);
  return writeStatusAtomic(options.dataRoot, {
    kind: "MacroPipelineStatus",
    schemaVersion: PIPELINE_STATUS_SCHEMA,
    updatedAt: new Date().toISOString(),
    ok: false,
    stage: options.stage,
    error: options.error,
    attemptedSession: options.attemptedSession ?? null,
    lastGoodSession:
      options.lastGoodSession ?? prior?.lastGoodSession ?? null,
    lastGoodDriverPath:
      options.lastGoodDriverPath ?? prior?.lastGoodDriverPath ?? null,
  });
}
