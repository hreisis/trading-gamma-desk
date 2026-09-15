import {
  CatalystFeed,
  compareCatalystImportance,
  type CatalystFeed as CatalystFeedDto,
} from "@/contracts";
import type { Catalyst } from "@/contracts";
import type { CatalystFeedResponse } from "./types";

const NEWS_UPCOMING_HORIZON_MS = 14 * 86_400_000;
const NEWS_RECENT_RELEASE_MS = 5 * 86_400_000;

const PATHISH =
  /(?:^|\s)(?:data\/|\/Users\/|\/home\/|\/var\/|\/tmp\/|[A-Za-z]:\\)/;

function stripPathishDisclaimer(disclaimer: string): string {
  // Internal loader may append cache-missing messages with filesystem paths.
  const cut = disclaimer.search(PATHISH);
  if (cut === -1) return disclaimer;
  return disclaimer.slice(0, cut).trim();
}

function publicSourceName(
  type: CatalystFeedResponse["source"]["type"],
  synthetic: boolean,
): string {
  if (synthetic || type === "fixture") return "synthetic_fixtures";
  return "official_calendar";
}

/** Tier-1 macro catalysts for the desk surface (FOMC, CPI, PCE, payrolls, GDP). */
const TIER1_RELEASE_FAMILIES = new Set([
  "cpi",
  "employment_situation",
  "fomc_policy",
  "gdp",
  "personal_income_outlays",
]);

const TIER1_HEADLINE =
  /\b(fomc|consumer price index|\bcpi\b|personal income and outlays|\bpce\b|employment situation|nonfarm|payrolls|gross domestic product|\bgdp\b)/i;

export function isTier1Catalyst(catalyst: Catalyst): boolean {
  const family = (catalyst as Catalyst & { releaseFamily?: string })
    .releaseFamily;
  if (family && TIER1_RELEASE_FAMILIES.has(family)) return true;
  return TIER1_HEADLINE.test(catalyst.headline);
}

export function filterTier1Catalysts(
  catalysts: readonly Catalyst[],
): Catalyst[] {
  return catalysts.filter(isTier1Catalyst);
}

/** Desk news rail: high/critical importance or tier-1 macro within a near-term window. */
export function isNewsFeedCandidate(catalyst: Catalyst): boolean {
  if (catalyst.importance === "critical" || catalyst.importance === "high") {
    return true;
  }
  if (catalyst.importance === "medium" && isTier1Catalyst(catalyst)) {
    return true;
  }
  return false;
}

function newsFeedTemporalScore(catalyst: Catalyst, nowMs: number): number {
  const at = Date.parse(catalyst.occurredAt);
  if (!Number.isFinite(at)) return -1;
  const deltaDays = (at - nowMs) / 86_400_000;
  if (
    catalyst.status === "upcoming" &&
    deltaDays >= 0 &&
    deltaDays <= NEWS_UPCOMING_HORIZON_MS / 86_400_000
  ) {
    return 1_000 - deltaDays;
  }
  if (catalyst.status === "developing") {
    return 900;
  }
  if (
    (catalyst.status === "released" || catalyst.status === "resolved") &&
    deltaDays <= 0 &&
    deltaDays >= -(NEWS_RECENT_RELEASE_MS / 86_400_000)
  ) {
    return 800 + deltaDays;
  }
  return -1;
}

/** Up to five near-term market-moving catalysts — deterministic, no AI ranking. */
export function selectNewsFeedCatalysts(
  catalysts: readonly Catalyst[],
  options?: { readonly now?: Date; readonly maxItems?: number },
): Catalyst[] {
  const nowMs = (options?.now ?? new Date()).getTime();
  const maxItems = Math.min(5, Math.max(1, options?.maxItems ?? 5));

  return catalysts
    .filter(
      (catalyst) =>
        isNewsFeedCandidate(catalyst) &&
        newsFeedTemporalScore(catalyst, nowMs) >= 0,
    )
    .sort((a, b) => {
      const scoreDelta =
        newsFeedTemporalScore(b, nowMs) - newsFeedTemporalScore(a, nowMs);
      if (scoreDelta !== 0) return scoreDelta;
      const importanceDelta = compareCatalystImportance(
        b.importance,
        a.importance,
      );
      if (importanceDelta !== 0) return importanceDelta;
      return Date.parse(a.occurredAt) - Date.parse(b.occurredAt);
    })
    .slice(0, maxItems);
}

function layerWithoutError<T extends { error?: string }>(
  layer: T | undefined,
): Omit<T, "error"> | undefined {
  if (!layer) return undefined;
  const { error: _error, ...rest } = layer;
  void _error;
  return rest;
}

/**
 * Project the internal feed loader payload to the frontend/API DTO.
 * Drops cache paths, raw provider errors, AI usage, and join-identity fields.
 */
export function toPublicCatalystFeed(
  feed: CatalystFeedResponse,
): CatalystFeedDto {
  const source = feed.source;
  const docsSources = source.documents?.sources?.map((s) => ({
    id: s.id,
    name: s.name,
    status: s.status,
    ...(s.mappedDocumentCount !== undefined
      ? { mappedDocumentCount: s.mappedDocumentCount }
      : {}),
  }));

  const publicFeed = {
    kind: "CatalystFeed" as const,
    schemaVersion: "0.1.0" as const,
    generatedAt: feed.generatedAt,
    mode: feed.mode,
    isPublicDemo: feed.isPublicDemo,
    banner: feed.banner,
    disclaimer: stripPathishDisclaimer(feed.disclaimer),
    source: {
      type: source.type,
      name: publicSourceName(source.type, source.synthetic),
      synthetic: source.synthetic,
      ...(source.fetchedAt ? { fetchedAt: source.fetchedAt } : {}),
      ...(source.stale !== undefined ? { stale: source.stale } : {}),
      ...(source.partialFailure !== undefined
        ? { partialFailure: source.partialFailure }
        : {}),
      ...(source.window ? { window: source.window } : {}),
      ...(source.sources
        ? {
            sources: source.sources.map((s) => ({
              id: s.id,
              name: s.name,
              status: s.status,
              ...(s.mappedEventCount !== undefined
                ? { mappedEventCount: s.mappedEventCount }
                : {}),
            })),
          }
        : {}),
      ...(source.results
        ? { results: layerWithoutError(source.results) }
        : {}),
      ...(source.documents
        ? {
            documents: (() => {
              const d = layerWithoutError(source.documents)!;
              const {
                sources: _s,
                ...rest
              } = d as typeof d & { sources?: unknown };
              void _s;
              return {
                ...rest,
                ...(docsSources ? { sources: docsSources } : {}),
              };
            })(),
          }
        : {}),
      ...(source.briefs
        ? {
            briefs: (() => {
              const b = layerWithoutError(source.briefs)!;
              const {
                extractorVersion: _ev,
                ...rest
              } = b as typeof b & { extractorVersion?: string };
              void _ev;
              return rest;
            })(),
          }
        : {}),
      ...(source.aiBriefs
        ? { aiBriefs: layerWithoutError(source.aiBriefs) }
        : {}),
      ...(source.marketContext
        ? {
            marketContext: (() => {
              const m = layerWithoutError(source.marketContext)!;
              const {
                calculationVersion: _cv,
                ...rest
              } = m as typeof m & { calculationVersion?: string };
              void _cv;
              return rest;
            })(),
          }
        : {}),
      ...(source.marketReactions
        ? { marketReactions: layerWithoutError(source.marketReactions) }
        : {}),
      ...(source.aiMarketReactions
        ? { aiMarketReactions: layerWithoutError(source.aiMarketReactions) }
        : {}),
    },
    count: feed.count,
    catalysts: feed.isPublicDemo
      ? feed.catalysts
      : filterTier1Catalysts(feed.catalysts),
    ...(feed.documents ? { documents: feed.documents } : {}),
    ...(feed.briefs ? { briefs: feed.briefs } : {}),
    ...(feed.aiBriefs
      ? {
          aiBriefs: feed.aiBriefs.map(
            ({ documentContentHash: _h, extractorVersion: _e, ...rest }) => {
              void _h;
              void _e;
              return rest;
            },
          ),
        }
      : {}),
    ...(feed.marketContext
      ? {
          marketContext: feed.marketContext.map(({ errors: _err, ...rest }) => {
            void _err;
            return rest;
          }),
        }
      : {}),
    ...(feed.marketReactions
      ? {
          marketReactions: feed.marketReactions.map(
            ({
              officialFactsIdentity: _f,
              marketContextIdentity: _m,
              limitations: _l,
              ...rest
            }) => {
              void _f;
              void _m;
              void _l;
              return rest;
            },
          ),
        }
      : {}),
    ...(feed.aiMarketReactions
      ? {
          aiMarketReactions: feed.aiMarketReactions.map(
            ({
              marketContextIdentity: _c,
              marketReactionIdentity: _r,
              usage: _u,
              validationErrors: _v,
              ...rest
            }) => {
              void _c;
              void _r;
              void _u;
              void _v;
              return rest;
            },
          ),
        }
      : {}),
    validationIssueCount: feed.validationErrors.length,
    ...(feed.linkingWarnings && feed.linkingWarnings.length > 0
      ? {
          linkingWarnings: feed.linkingWarnings.map((w) => ({
            ...(w.releaseFamily ? { releaseFamily: w.releaseFamily } : {}),
            ...(w.referencePeriod
              ? { referencePeriod: w.referencePeriod }
              : {}),
            ...(w.reason ? { reason: w.reason } : {}),
          })),
        }
      : {}),
  };

  return CatalystFeed.parse({
    ...publicFeed,
    count: publicFeed.catalysts.length,
  });
}
