import type {
  CatalystReleaseFamily,
  ReleaseObservation,
  ReleaseResult,
} from "@/contracts";

export interface BlsSeriesPoint {
  readonly year: number;
  readonly month: number;
  readonly referencePeriod: string;
  readonly sourcePeriod: string;
  readonly value: number;
  readonly preliminary: boolean;
}

export interface BlsSeriesData {
  readonly seriesId: string;
  readonly points: readonly BlsSeriesPoint[];
}

export interface BuiltRelease {
  readonly releaseFamily: CatalystReleaseFamily;
  readonly referencePeriod: string;
  readonly observedAt: string;
  readonly observations: ReleaseObservation[];
  readonly fingerprint: string;
  readonly releaseResult: ReleaseResult;
}

export interface ReleaseRevisionRecord {
  readonly releaseFamily: CatalystReleaseFamily;
  readonly referencePeriod: string;
  readonly observedAt: string;
  readonly previousFingerprint: string;
  readonly currentFingerprint: string;
  readonly previousObservations: ReleaseObservation[];
  readonly currentObservations: ReleaseObservation[];
}

export interface ResultsSourceStatus {
  readonly id: "bls_api";
  readonly name: string;
  readonly url: string;
  readonly status: "ok" | "error";
  readonly error?: string;
  readonly seriesCount?: number;
}

export interface ResultsSeriesMetadata {
  readonly seriesId: string;
  readonly releaseFamily: CatalystReleaseFamily;
  readonly seasonalAdjustment: "SA" | "NSA";
  readonly description: string;
  readonly pointCount: number;
  readonly latestReferencePeriod: string | null;
}

export interface CatalystResultsCache {
  readonly kind: "CatalystResultsCache";
  readonly schemaVersion: "0.1.0";
  readonly fetchedAt: string;
  readonly sources: readonly ResultsSourceStatus[];
  readonly seriesMetadata: readonly ResultsSeriesMetadata[];
  readonly releases: readonly BuiltRelease[];
  readonly revisions: readonly ReleaseRevisionRecord[];
  readonly validationErrors: Array<{
    readonly error: string;
    readonly path?: string;
  }>;
  readonly linkingWarnings: Array<{
    readonly error: string;
    readonly releaseFamily?: CatalystReleaseFamily;
    readonly referencePeriod?: string;
  }>;
  readonly partialFailure: boolean;
}
