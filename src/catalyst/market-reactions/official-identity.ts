import { createHash } from "node:crypto";
import type {
  Catalyst,
  EventMarketContext,
  OfficialBrief,
  ReleaseResult,
} from "@/contracts";

export function releaseResultFingerprint(rr: ReleaseResult): string {
  const payload = {
    referencePeriod: rr.referencePeriod,
    observedAt: rr.observedAt,
    sourceName: rr.sourceName,
    observations: rr.observations.map((o) => ({
      metric: o.metric,
      actual: o.actual,
      unit: o.unit,
      sourceSeriesId: o.sourceSeriesId,
      sourcePeriod: o.sourcePeriod,
      transformation: o.transformation,
    })),
  };
  return createHash("sha256")
    .update(JSON.stringify(payload), "utf8")
    .digest("hex")
    .slice(0, 16);
}

export function briefIdentityLine(brief: OfficialBrief): string {
  return [
    brief.id,
    brief.documentId,
    brief.documentContentHash,
    brief.extractorVersion,
    brief.status,
    brief.facts.map((f) => f.id).sort().join(","),
  ].join(":");
}

/**
 * Stable official event + facts identity for M2-4B input reuse.
 * Excludes generatedAt / transient UI fields.
 */
export function officialEventFactsIdentity(parts: {
  readonly catalystId: string;
  readonly eventTimestamp: string;
  readonly releaseFamily?: string;
  readonly referencePeriod?: string;
  readonly releaseResultFingerprint?: string;
  readonly documentIdentities: readonly string[];
  readonly briefIdentities: readonly string[];
}): string {
  return [
    parts.catalystId,
    parts.eventTimestamp,
    parts.releaseFamily ?? "",
    parts.referencePeriod ?? "",
    parts.releaseResultFingerprint ?? "",
    parts.documentIdentities.join(","),
    parts.briefIdentities.join(","),
  ].join("|");
}

export function officialEventFactsIdentityForCatalyst(
  catalyst: Pick<
    Catalyst,
    | "id"
    | "occurredAt"
    | "releaseFamily"
    | "referencePeriod"
    | "releaseResult"
    | "officialDocuments"
  >,
  briefsByDocumentId: ReadonlyMap<string, OfficialBrief>,
): string {
  const documentIdentities = [...(catalyst.officialDocuments ?? [])]
    .map((d) => `${d.id}:${d.contentHash}`)
    .sort();
  const briefIdentities = [...(catalyst.officialDocuments ?? [])]
    .map((d) => briefsByDocumentId.get(d.id))
    .filter((b): b is OfficialBrief => Boolean(b))
    .map(briefIdentityLine)
    .sort();
  return officialEventFactsIdentity({
    catalystId: catalyst.id,
    eventTimestamp: catalyst.occurredAt,
    releaseFamily: catalyst.releaseFamily,
    referencePeriod:
      catalyst.referencePeriod ?? catalyst.releaseResult?.referencePeriod,
    releaseResultFingerprint: catalyst.releaseResult
      ? releaseResultFingerprint(catalyst.releaseResult)
      : undefined,
    documentIdentities,
    briefIdentities: briefIdentities.length > 0 ? briefIdentities : ["none"],
  });
}

/**
 * Resolve 4B official-event/facts identity. Prefers linked catalyst + briefs;
 * otherwise falls back to market-context event fields with facts:none.
 */
export function officialEventFactsIdentityFromContext(
  ctx: EventMarketContext,
  options: {
    readonly catalyst?: Pick<
      Catalyst,
      | "id"
      | "occurredAt"
      | "releaseFamily"
      | "referencePeriod"
      | "releaseResult"
      | "officialDocuments"
    >;
    readonly briefsByDocumentId?: ReadonlyMap<string, OfficialBrief>;
  } = {},
): string {
  if (options.catalyst) {
    return officialEventFactsIdentityForCatalyst(
      options.catalyst,
      options.briefsByDocumentId ?? new Map(),
    );
  }
  return officialEventFactsIdentity({
    catalystId: ctx.catalystId,
    eventTimestamp: ctx.eventTimestamp,
    releaseFamily: ctx.releaseFamily,
    documentIdentities: [],
    briefIdentities: ["none"],
  });
}

/** Index current officialFactsIdentity for feed filters (by catalystId). */
export function officialFactsIdentityIndex(
  catalysts: readonly Pick<
    Catalyst,
    | "id"
    | "occurredAt"
    | "releaseFamily"
    | "referencePeriod"
    | "releaseResult"
    | "officialDocuments"
  >[],
  briefs: readonly OfficialBrief[] | undefined,
): Map<string, string> {
  const briefsByDocumentId = new Map<string, OfficialBrief>();
  for (const b of briefs ?? []) {
    briefsByDocumentId.set(b.documentId, b);
  }
  const out = new Map<string, string>();
  for (const c of catalysts) {
    out.set(c.id, officialEventFactsIdentityForCatalyst(c, briefsByDocumentId));
  }
  return out;
}
