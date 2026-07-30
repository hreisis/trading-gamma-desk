import {
  CatalystFeed,
  type CatalystFeed as CatalystFeedDto,
} from "@/contracts";
import type { CatalystFeedResponse } from "./types";

const PATHISH =
  /(?:^|\s)(?:data\/|\/Users\/|\/home\/|\/var\/|\/tmp\/|[A-Za-z]:\\)/;

function publicSourceName(
  type: CatalystFeedResponse["source"]["type"],
  synthetic: boolean,
): string {
  if (synthetic || type === "fixture") return "synthetic_fixtures";
  return "official_calendar";
}

function stripPathishDisclaimer(disclaimer: string): string {
  // Internal loader may append cache-missing messages with filesystem paths.
  const cut = disclaimer.search(PATHISH);
  if (cut === -1) return disclaimer;
  return disclaimer.slice(0, cut).trim();
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
    catalysts: feed.catalysts,
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

  return CatalystFeed.parse(publicFeed);
}
