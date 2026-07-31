import type { GammaSnapshotCaptureKind } from "@/contracts";

const UNDERLYING_PATTERN = /^[A-Z0-9._-]{1,32}$/;
const SESSION_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ISO_INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export interface GammaSnapshotIdParts {
  readonly underlying: string;
  readonly sessionDate: string;
  readonly captureKind: GammaSnapshotCaptureKind;
  readonly asOf: string;
}

export class GammaSnapshotIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GammaSnapshotIdentityError";
  }
}

function assertSafeUnderlying(underlying: string): void {
  if (!UNDERLYING_PATTERN.test(underlying)) {
    throw new GammaSnapshotIdentityError(
      `unsafe underlying for snapshot identity: ${underlying}`,
    );
  }
}

function assertSafeSessionDate(sessionDate: string): void {
  if (!SESSION_DATE_PATTERN.test(sessionDate)) {
    throw new GammaSnapshotIdentityError(
      `unsafe sessionDate for snapshot identity: ${sessionDate}`,
    );
  }
}

function assertSafeAsOf(asOf: string): void {
  if (!ISO_INSTANT_PATTERN.test(asOf)) {
    throw new GammaSnapshotIdentityError(
      `unsafe asOf for snapshot identity: ${asOf}`,
    );
  }
  parseIsoInstantMs(asOf);
}

function parseIsoInstantMs(iso: string): number {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) {
    throw new GammaSnapshotIdentityError(`invalid ISO instant: ${iso}`);
  }
  return ms;
}

/**
 * Validate snapshot identity components before building IDs or filesystem paths.
 */
export function validateSnapshotIdParts(parts: GammaSnapshotIdParts): void {
  assertSafeUnderlying(parts.underlying);
  assertSafeSessionDate(parts.sessionDate);
  if (
    parts.captureKind !== "open" &&
    parts.captureKind !== "intraday" &&
    parts.captureKind !== "close"
  ) {
    throw new GammaSnapshotIdentityError(
      `invalid captureKind: ${parts.captureKind}`,
    );
  }
  assertSafeAsOf(parts.asOf);
}

/**
 * Encode one underlying segment for filesystem storage.
 */
export function encodeSnapshotPathSegment(segment: string): string {
  assertSafeUnderlying(segment);
  return segment;
}

/**
 * Encode sessionDate (YYYY-MM-DD) for filesystem paths.
 */
export function encodeSnapshotSessionDate(sessionDate: string): string {
  if (!SESSION_DATE_PATTERN.test(sessionDate)) {
    throw new GammaSnapshotIdentityError(
      `unsafe sessionDate for snapshot path: ${sessionDate}`,
    );
  }
  return sessionDate;
}

/**
 * Encode captureKind + asOf into a single filename stem.
 */
export function encodeSnapshotFileStem(
  captureKind: GammaSnapshotCaptureKind,
  asOf: string,
): string {
  assertSafeAsOf(asOf);
  const safeAsOf = asOf.replace(/:/g, "").replace(/\+/g, "_plus_");
  return `${captureKind}_${safeAsOf}`;
}

/**
 * Stable snapshot identity. Components are explicit capture labels — never
 * derived from wall-clock inference.
 */
export function buildGammaSnapshotId(parts: GammaSnapshotIdParts): string {
  validateSnapshotIdParts(parts);
  return [
    parts.underlying,
    parts.sessionDate,
    parts.captureKind,
    parts.asOf,
  ].join("|");
}

export function parseGammaSnapshotId(snapshotId: string): GammaSnapshotIdParts {
  const parts = snapshotId.split("|");
  if (parts.length !== 4) {
    throw new GammaSnapshotIdentityError(
      `invalid gamma snapshotId (expected underlying|sessionDate|captureKind|asOf): ${snapshotId}`,
    );
  }
  const underlying = parts[0]!;
  const sessionDate = parts[1]!;
  const captureKind = parts[2] as GammaSnapshotCaptureKind;
  const asOf = parts[3]!;
  validateSnapshotIdParts({ underlying, sessionDate, captureKind, asOf });
  return { underlying, sessionDate, captureKind, asOf };
}
