import { z } from "zod";
import { IsoDateTime } from "./common";
import { Catalyst } from "./catalyst";
import { OfficialDocument, OfficialDocumentProvider } from "./official-document";
import { OfficialBrief } from "./official-brief";
import { OfficialAiBrief } from "./ai-brief";
import { EventMarketContext } from "./market-context";
import { EventMarketReaction } from "./market-reaction";
import { AiMarketReactionNarrative } from "./ai-market-reaction";

export const CATALYST_FEED_SCHEMA_VERSION = "0.1.0";

export const CatalystFeedMode = z.enum([
  "synthetic_demo",
  "official_calendar",
  "stale_calendar",
  "live_unavailable",
]);

export const CatalystFeedSourceStatusPublic = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  status: z.enum(["ok", "error", "skipped"]),
  mappedEventCount: z.number().int().nonnegative().optional(),
});

export const CatalystLayerStatus = z.enum([
  "ok",
  "error",
  "missing",
  "synthetic",
  "partial",
  "failed",
  "unavailable",
]);

const LayerMeta = z.object({
  available: z.boolean(),
  status: CatalystLayerStatus.optional(),
  fetchedAt: IsoDateTime.optional(),
  stale: z.boolean().optional(),
  partialFailure: z.boolean().optional(),
});

/** Frontend-safe market reaction — omits cache/join identity strings. */
export const PublicEventMarketReaction = EventMarketReaction.omit({
  officialFactsIdentity: true,
  marketContextIdentity: true,
  limitations: true,
});

/** Frontend-safe AI reaction — omits identities, usage, and validation dump. */
export const PublicAiMarketReactionNarrative = AiMarketReactionNarrative.omit({
  marketContextIdentity: true,
  marketReactionIdentity: true,
  usage: true,
  validationErrors: true,
});

/** Frontend-safe AI brief — omits document hash / extractor internals. */
export const PublicOfficialAiBrief = OfficialAiBrief.omit({
  documentContentHash: true,
  extractorVersion: true,
});

/** Frontend-safe market context — omits provider error strings. */
export const PublicEventMarketContext = EventMarketContext.omit({
  errors: true,
});

export const PublicOfficialDocument = OfficialDocument;

export const PublicOfficialBrief = OfficialBrief;

export const CatalystFeedSourcePublic = z.object({
  type: z.enum(["fixture", "official_calendar"]),
  /** Logical source label — never a filesystem path. */
  name: z.string().min(1),
  synthetic: z.boolean(),
  fetchedAt: IsoDateTime.optional(),
  stale: z.boolean().optional(),
  partialFailure: z.boolean().optional(),
  window: z
    .object({
      now: IsoDateTime,
      start: IsoDateTime,
      end: IsoDateTime,
    })
    .optional(),
  sources: z.array(CatalystFeedSourceStatusPublic).optional(),
  results: LayerMeta.extend({
    archiveReleaseCount: z.number().int().nonnegative().optional(),
    materializedStandaloneCount: z.number().int().nonnegative().optional(),
    linkedCount: z.number().int().nonnegative().optional(),
  }).optional(),
  documents: LayerMeta.extend({
    archiveDocumentCount: z.number().int().nonnegative().optional(),
    feedDocumentCount: z.number().int().nonnegative().optional(),
    linkedCount: z.number().int().nonnegative().optional(),
    sources: z
      .array(
        z.object({
          id: OfficialDocumentProvider,
          name: z.string().min(1),
          status: z.enum(["ok", "error", "skipped"]),
          mappedDocumentCount: z.number().int().nonnegative().optional(),
        }),
      )
      .optional(),
  }).optional(),
  briefs: LayerMeta.extend({
    archiveBriefCount: z.number().int().nonnegative().optional(),
    feedBriefCount: z.number().int().nonnegative().optional(),
  }).optional(),
  aiBriefs: LayerMeta.extend({
    archiveBriefCount: z.number().int().nonnegative().optional(),
    feedBriefCount: z.number().int().nonnegative().optional(),
    promptVersion: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
  }).optional(),
  marketContext: LayerMeta.extend({
    archiveSnapshotCount: z.number().int().nonnegative().optional(),
    feedSnapshotCount: z.number().int().nonnegative().optional(),
    provider: z.string().min(1).optional(),
    feed: z.string().min(1).optional(),
  }).optional(),
  marketReactions: LayerMeta.extend({
    archiveReactionCount: z.number().int().nonnegative().optional(),
    feedReactionCount: z.number().int().nonnegative().optional(),
    reactionRulesVersion: z.string().min(1).optional(),
  }).optional(),
  aiMarketReactions: LayerMeta.extend({
    archiveNarrativeCount: z.number().int().nonnegative().optional(),
    feedNarrativeCount: z.number().int().nonnegative().optional(),
    promptVersion: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    reactionRulesVersion: z.string().min(1).optional(),
  }).optional(),
});

/**
 * Frontend / API Catalyst feed DTO (M3-0.5).
 * Omits cache paths, raw provider errors, AI token usage, and internal
 * identity/debug fields. Layer status + counts used by the desk UI remain.
 */
export const CatalystFeed = z.object({
  kind: z.literal("CatalystFeed"),
  schemaVersion: z.literal(CATALYST_FEED_SCHEMA_VERSION),
  generatedAt: IsoDateTime,
  mode: CatalystFeedMode,
  isPublicDemo: z.boolean(),
  banner: z.string().min(1),
  disclaimer: z.string().min(1),
  source: CatalystFeedSourcePublic,
  count: z.number().int().nonnegative(),
  catalysts: z.array(Catalyst),
  documents: z.array(PublicOfficialDocument).optional(),
  briefs: z.array(PublicOfficialBrief).optional(),
  aiBriefs: z.array(PublicOfficialAiBrief).optional(),
  marketContext: z.array(PublicEventMarketContext).optional(),
  marketReactions: z.array(PublicEventMarketReaction).optional(),
  aiMarketReactions: z.array(PublicAiMarketReactionNarrative).optional(),
  /** Count only — raw validation strings stay internal. */
  validationIssueCount: z.number().int().nonnegative(),
  /** Sanitized linking diagnostics (no raw error text). */
  linkingWarnings: z
    .array(
      z.object({
        releaseFamily: z.string().optional(),
        referencePeriod: z.string().optional(),
        reason: z.string().optional(),
      }),
    )
    .optional(),
});

export type CatalystFeed = z.infer<typeof CatalystFeed>;
export type CatalystFeedMode = z.infer<typeof CatalystFeedMode>;
export type PublicEventMarketReaction = z.infer<typeof PublicEventMarketReaction>;
export type PublicAiMarketReactionNarrative = z.infer<
  typeof PublicAiMarketReactionNarrative
>;
export type PublicOfficialAiBrief = z.infer<typeof PublicOfficialAiBrief>;
export type PublicEventMarketContext = z.infer<typeof PublicEventMarketContext>;
