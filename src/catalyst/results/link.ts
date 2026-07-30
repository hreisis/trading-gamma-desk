import { createHash } from "node:crypto";
import type { Catalyst, CatalystReleaseFamily } from "@/contracts";
import { matchOfficialEvent } from "../registry";
import type { BuiltRelease } from "./types";

export interface LinkResult {
  readonly catalysts: Catalyst[];
  readonly linkingWarnings: Array<{
    readonly error: string;
    readonly releaseFamily?: CatalystReleaseFamily;
    readonly referencePeriod?: string;
  }>;
  readonly linkedCount: number;
  readonly unmatchedReleaseCount: number;
}

function buildStandaloneId(family: CatalystReleaseFamily, period: string): string {
  const digest = createHash("sha256")
    .update(`bls-result:${family}:${period}`)
    .digest("hex")
    .slice(0, 16);
  return `cat_${digest}`;
}

function standaloneFromRelease(release: BuiltRelease): Catalyst {
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

  return {
    schemaVersion: "0.1.0",
    id,
    occurredAt: release.observedAt,
    observedAt: release.observedAt,
    sourceType: "calendar",
    sourceName: release.releaseResult.sourceName,
    sourceUrl: release.releaseResult.sourceUrl,
    headline: `${mapping.headline.replace(" scheduled release", "")} — ${release.referencePeriod} (unlinked observation)`,
    summary: `Official BLS series observation for ${release.referencePeriod} without a strictly matched scheduled catalyst. Consensus/surprise unavailable. ${obsLines}`,
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
        statement: `Unlinked BLS observation ${release.releaseFamily} ${release.referencePeriod}: ${obsLines}`,
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

  const evidence = [
    ...catalyst.evidence,
    {
      id: `${catalyst.id}_result`,
      statement: `Official BLS series values for ${release.referencePeriod} observed at ${release.observedAt}: ${obsLines}. Consensus unavailable; surprise unavailable.`,
      basis: "official_bls_series",
    },
  ];

  return {
    ...catalyst,
    status: "released",
    // Official results never imply market direction; synthetic demo may keep fixture direction.
    direction: catalyst.synthetic ? catalyst.direction : "unclear",
    observedAt: release.observedAt,
    releaseFamily: release.releaseFamily,
    referencePeriod: release.referencePeriod,
    releaseResult: release.releaseResult,
    evidence,
  };
}

/**
 * Strict link: same releaseFamily + referencePeriod.
 * Matched scheduled rows become released (identity preserved).
 * Unmatched releases become standalone observations with warnings.
 * Never supersede on weak/fuzzy match. Never set released from clock alone.
 */
export function linkReleasesToCatalysts(
  catalysts: readonly Catalyst[],
  releases: readonly BuiltRelease[],
): LinkResult {
  const warnings: LinkResult["linkingWarnings"] = [];
  const usedReleaseKeys = new Set<string>();
  const out: Catalyst[] = [];

  for (const catalyst of catalysts) {
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

  // Unmatched historical periods stay in the results cache only.
  // Emit at most one standalone observation per family (latest unmatched period).
  const latestUnmatched = new Map<CatalystReleaseFamily, BuiltRelease>();
  for (const release of releases) {
    const key = `${release.releaseFamily}|${release.referencePeriod}`;
    if (usedReleaseKeys.has(key)) continue;
    const prev = latestUnmatched.get(release.releaseFamily);
    if (!prev || release.referencePeriod > prev.referencePeriod) {
      latestUnmatched.set(release.releaseFamily, release);
    }
  }

  let unmatchedReleaseCount = 0;
  for (const release of latestUnmatched.values()) {
    unmatchedReleaseCount += 1;
    warnings.push({
      error: `No strictly matched scheduled catalyst for ${release.releaseFamily} ${release.referencePeriod}; keeping independent observation`,
      releaseFamily: release.releaseFamily,
      referencePeriod: release.referencePeriod,
    });
    out.push(standaloneFromRelease(release));
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
    unmatchedReleaseCount,
  };
}
