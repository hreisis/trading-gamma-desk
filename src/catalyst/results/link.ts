import { createHash } from "node:crypto";
import type { Catalyst, CatalystReleaseFamily } from "@/contracts";
import { matchOfficialEvent } from "../registry";
import { compareReferencePeriod } from "./period";
import type { BuiltRelease } from "./types";

export interface LinkingWarning {
  readonly error: string;
  readonly releaseFamily: CatalystReleaseFamily;
  readonly referencePeriod: string;
  readonly reason:
    | "no_matching_schedule"
    | "calendar_unavailable"
    | "schedule_missing_reference_period";
}

export interface LinkResult {
  readonly catalysts: Catalyst[];
  readonly linkingWarnings: LinkingWarning[];
  readonly linkedCount: number;
  /** Standalone feed events materialized (≤ one per family). */
  readonly unmatchedReleaseCount: number;
  /** Total historical release records considered (cache size). */
  readonly archiveReleaseCount: number;
  readonly materializedStandaloneCount: number;
}

export interface MaterializeOptions {
  readonly scheduled: readonly Catalyst[];
  readonly releases: readonly BuiltRelease[];
  readonly calendarAvailable: boolean;
  readonly calendarUnavailableReason?: string;
}

function buildStandaloneId(family: CatalystReleaseFamily, period: string): string {
  const digest = createHash("sha256")
    .update(`bls-result:${family}:${period}`)
    .digest("hex")
    .slice(0, 16);
  return `cat_${digest}`;
}

function standaloneFromRelease(
  release: BuiltRelease,
  reason: LinkingWarning["reason"],
  detail: string,
): Catalyst {
  const mapping =
    release.releaseFamily === "cpi"
      ? matchOfficialEvent("bls", "Consumer Price Index")
      : matchOfficialEvent("bls", "Employment Situation");
  if (!mapping) {
    throw new Error(`Missing registry mapping for ${release.releaseFamily}`);
  }

  const id = buildStandaloneId(release.releaseFamily, release.referencePeriod);
  const obsLines = release.observations
    .map(
      (o) =>
        `${o.metric}=${o.actual} ${o.unit}` +
        (o.preliminary ? " (preliminary)" : ""),
    )
    .join("; ");

  const mergeNote =
    "When a scheduled catalyst with the same releaseFamily + referencePeriod is available, this observation merges into that event (stable schedule identity) and is not duplicated.";

  return {
    schemaVersion: "0.1.0",
    id,
    occurredAt: release.observedAt,
    observedAt: release.observedAt,
    sourceType: "calendar",
    sourceName: release.releaseResult.sourceName,
    sourceUrl: release.releaseResult.sourceUrl,
    headline: `${mapping.headline.replace(" scheduled release", "")} — ${release.referencePeriod} (independent observation)`,
    summary: `Official BLS series observation for ${release.referencePeriod}. ${detail} Consensus/surprise unavailable. ${obsLines} ${mergeNote}`,
    category: mapping.category,
    importance: mapping.importance,
    status: "released",
    affectedAssets: [...mapping.affectedAssets],
    macroChannels: [...mapping.macroChannels],
    direction: "unclear",
    confidence: {
      score: 70,
      calibrated: false,
      note: "classification clarity only — not a market direction probability",
    },
    evidence: [
      {
        id: `${id}_ev1`,
        statement: `Independent BLS observation ${release.releaseFamily} ${release.referencePeriod} (${reason}): ${obsLines}`,
        basis: "official_bls_series",
      },
    ],
    dedupeKey: `ext:bls-result-${release.releaseFamily}-${release.referencePeriod}`,
    synthetic: false,
    releaseFamily: release.releaseFamily,
    referencePeriod: release.referencePeriod,
    releaseResult: release.releaseResult,
  };
}

function applyReleaseToCatalyst(
  catalyst: Catalyst,
  release: BuiltRelease,
): Catalyst {
  const obsLines = release.observations
    .map(
      (o) =>
        `${o.metric}=${o.actual} ${o.unit}` +
        (o.preliminary ? " (preliminary)" : ""),
    )
    .join("; ");

  // Drop prior result evidence rows so re-link/revision stays a single result note.
  const baseEvidence = catalyst.evidence.filter(
    (e) => e.basis !== "official_bls_series",
  );

  const evidence = [
    ...baseEvidence,
    {
      id: `${catalyst.id}_result`,
      statement: `Official BLS series values for ${release.referencePeriod} observed at ${release.observedAt}: ${obsLines}. Consensus unavailable; surprise unavailable.`,
      basis: "official_bls_series",
    },
  ];

  return {
    ...catalyst,
    status: "released",
    direction: catalyst.synthetic ? catalyst.direction : "unclear",
    observedAt: release.observedAt,
    releaseFamily: release.releaseFamily,
    referencePeriod: release.referencePeriod,
    releaseResult: release.releaseResult,
    evidence,
  };
}

function latestReleaseByFamily(
  releases: readonly BuiltRelease[],
): Map<CatalystReleaseFamily, BuiltRelease> {
  const latest = new Map<CatalystReleaseFamily, BuiltRelease>();
  for (const release of releases) {
    const prev = latest.get(release.releaseFamily);
    if (
      !prev ||
      compareReferencePeriod(release.referencePeriod, prev.referencePeriod) > 0
    ) {
      latest.set(release.releaseFamily, release);
    }
  }
  return latest;
}

/**
 * Materialize the default Catalyst feed from scheduled events + full results archive.
 *
 * - Results cache may hold all historical periods.
 * - Feed emits: all scheduled catalysts (with strict links applied) + at most one
 *   independent observation per release family (the latest unmatched period).
 * - Historical unmatched periods stay in the archive only — never dozens of
 *   top-level catalysts.
 */
export function materializeResultsFeed(options: MaterializeOptions): LinkResult {
  const {
    scheduled,
    releases,
    calendarAvailable,
    calendarUnavailableReason,
  } = options;

  const warnings: LinkingWarning[] = [];
  const usedReleaseKeys = new Set<string>();
  const out: Catalyst[] = [];

  for (const catalyst of scheduled) {
    const family = catalyst.releaseFamily;
    const period = catalyst.referencePeriod;
    if (!family || !period) {
      out.push(catalyst);
      continue;
    }
    const release = releases.find(
      (r) => r.releaseFamily === family && r.referencePeriod === period,
    );
    if (!release) {
      out.push(catalyst);
      continue;
    }
    usedReleaseKeys.add(`${family}|${period}`);
    out.push(applyReleaseToCatalyst(catalyst, release));
  }

  const latestByFamily = latestReleaseByFamily(releases);
  let materializedStandaloneCount = 0;

  for (const [family, release] of latestByFamily) {
    const key = `${family}|${release.referencePeriod}`;
    if (usedReleaseKeys.has(key)) continue;

    let reason: LinkingWarning["reason"];
    let detail: string;
    if (!calendarAvailable) {
      reason = "calendar_unavailable";
      detail =
        `BLS calendar schedule unavailable` +
        (calendarUnavailableReason
          ? ` (${calendarUnavailableReason})`
          : "") +
        `; keeping latest ${family} observation as an independent released event.`;
    } else {
      reason = "no_matching_schedule";
      detail = `No strictly matched scheduled catalyst for ${family} ${release.referencePeriod}; keeping independent observation.`;
    }

    warnings.push({
      error: detail,
      releaseFamily: family,
      referencePeriod: release.referencePeriod,
      reason,
    });
    out.push(standaloneFromRelease(release, reason, detail));
    materializedStandaloneCount += 1;
  }

  out.sort((a, b) => {
    const byOccurred =
      a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0;
    if (byOccurred !== 0) return byOccurred;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return {
    catalysts: out,
    linkingWarnings: warnings,
    linkedCount: usedReleaseKeys.size,
    unmatchedReleaseCount: materializedStandaloneCount,
    archiveReleaseCount: releases.length,
    materializedStandaloneCount,
  };
}

/** @deprecated Prefer materializeResultsFeed — kept for call-site compatibility. */
export function linkReleasesToCatalysts(
  catalysts: readonly Catalyst[],
  releases: readonly BuiltRelease[],
): LinkResult {
  return materializeResultsFeed({
    scheduled: catalysts,
    releases,
    calendarAvailable: true,
  });
}
