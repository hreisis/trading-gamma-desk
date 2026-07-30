import type { DominantDriver } from "@/contracts";

/** Provenance of a renderable DominantDriver payload. */
export type DeskPayloadSource = "local_driver" | "fixture";

export type DeskStatusKind =
  | "ready"
  | "empty"
  | "malformed"
  | "pipeline_error";

export type PipelineStage =
  | "ingest"
  | "compute"
  | "interpret"
  | "write"
  | "daily";

export interface PipelineStatus {
  readonly kind: "MacroPipelineStatus";
  readonly schemaVersion: "0.1.0";
  readonly updatedAt: string;
  readonly ok: boolean;
  readonly stage: PipelineStage | null;
  readonly error: string | null;
  readonly attemptedSession: string | null;
  readonly lastGoodSession: string | null;
  readonly lastGoodDriverPath: string | null;
}

export interface DeskError {
  readonly code: "empty" | "malformed" | "pipeline";
  readonly message: string;
  readonly path?: string;
  readonly stage?: PipelineStage | null;
}

/**
 * Read-only desk view model. The UI never classifies or re-scores; it only
 * renders this payload (plus loading, which is a Next.js suspense shell).
 */
export interface MacroDeskView {
  readonly status: DeskStatusKind;
  readonly source: DeskPayloadSource | null;
  readonly sourceLabel: string | null;
  readonly isDemo: boolean;
  readonly isLiveDriver: boolean;
  readonly driver: DominantDriver | null;
  readonly driverPath: string | null;
  readonly snapshotPresent: boolean;
  readonly snapshotPath: string | null;
  readonly sessionStale: boolean;
  readonly pipeline: PipelineStatus | null;
  readonly error: DeskError | null;
}
