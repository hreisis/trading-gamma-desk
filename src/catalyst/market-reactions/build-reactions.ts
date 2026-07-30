import { writeJsonAtomic } from "@/desk/atomic-write";
import { isPublicDemoMode } from "@/desk/public-demo";
import type {
  Catalyst,
  EventMarketContext,
  EventMarketReaction,
  OfficialBrief,
} from "@/contracts";
import { loadBriefsCache } from "../briefs/cache";
import { loadCalendarCache } from "../cache";
import { loadDocumentsCache } from "../documents/cache";
import { linkDocumentsToCatalysts } from "../documents/link";
import { loadMarketContextCache } from "../market-context/cache";
import { MARKET_CONTEXT_FEED_DAYS } from "../market-context/config";
import { loadResultsCache } from "../results/cache";
import { materializeResultsFeed } from "../results/link";
import { loadMarketReactionsCache } from "./cache";
import { classifyMarketReaction, marketContextIdentity } from "./classify";
import { MARKET_REACTION_FEED_DAYS } from "./materialize";
import {
  officialEventFactsIdentityForCatalyst,
  officialEventFactsIdentityFromContext,
} from "./official-identity";
import {
  DEFAULT_MARKET_REACTIONS_DATA_ROOT,
  marketReactionsLatestPath,
} from "./paths";
import type {
  CatalystMarketReactionsCache,
  MarketReactionBuildError,
  MarketReactionInputRef,
  MarketReactionRevisionRecord,
} from "./types";
import { REACTION_RULES_VERSION } from "./version";

export {
  DEFAULT_MARKET_REACTIONS_DATA_ROOT,
  MARKET_REACTIONS_LATEST_RELATIVE,
  marketReactionsLatestPath,
} from "./paths";

export interface BuildMarketReactionsOptions {
  readonly now?: Date;
  readonly dataRoot?: string;
  readonly marketContextDataRoot?: string;
  readonly publicDemo?: boolean;
  readonly write?: boolean;
  readonly force?: boolean;
  /** Test injection. */
  readonly snapshots?: readonly EventMarketContext[];
  /** Test injection: catalystId → officialFactsIdentity. */
  readonly officialFactsIdentityByCatalystId?: ReadonlyMap<string, string>;
  readonly maxPerRun?: number;
}

export interface BuildMarketReactionsResult {
  readonly cache: CatalystMarketReactionsCache;
  readonly path: string | null;
}

function isEligibleSnapshot(
  snap: EventMarketContext,
  now: Date,
  days: number,
): boolean {
  if (snap.status === "unavailable") return false;
  const eventMs = Date.parse(snap.eventTimestamp);
  if (!Number.isFinite(eventMs)) return false;
  const start = now.getTime() - days * 24 * 60 * 60 * 1000;
  return eventMs >= start && eventMs <= now.getTime();
}

function loadOfficialFactsIdentityIndex(
  dataRoot: string,
  now: Date,
): {
  readonly byCatalystId: Map<string, string>;
  readonly warnings: string[];
} {
  const warnings: string[] = [];
  const briefsLoaded = loadBriefsCache({ dataRoot, now });
  const briefsByDocumentId = new Map<string, OfficialBrief>();
  if (briefsLoaded.ok) {
    for (const b of briefsLoaded.cache.briefs) {
      briefsByDocumentId.set(b.documentId, b);
    }
  } else {
    warnings.push(
      "Official briefs cache unavailable — 4B identity uses event fields with facts:none where unlinked.",
    );
  }

  const calendar = loadCalendarCache({ dataRoot, now });
  const results = loadResultsCache({ dataRoot, now });
  const docs = loadDocumentsCache({ dataRoot, now });

  let catalysts: Catalyst[] = [];
  if (calendar.ok) {
    catalysts = [...calendar.cache.catalysts];
    if (results.ok) {
      catalysts = materializeResultsFeed({
        scheduled: catalysts,
        releases: results.cache.releases,
        calendarAvailable: true,
      }).catalysts;
    }
    if (docs.ok) {
      catalysts = linkDocumentsToCatalysts(
        catalysts,
        docs.cache.documents,
      ).catalysts;
    } else {
      warnings.push(
        "Documents cache unavailable — 4B officialFactsIdentity has no document refs.",
      );
    }
  } else {
    warnings.push(
      "Calendar unavailable — 4B officialFactsIdentity falls back to market-context event fields.",
    );
  }

  const byCatalystId = new Map<string, string>();
  for (const c of catalysts) {
    byCatalystId.set(
      c.id,
      officialEventFactsIdentityForCatalyst(c, briefsByDocumentId),
    );
  }
  return { byCatalystId, warnings };
}

/**
 * Build deterministic market reactions from local M2-4A + official facts identity.
 * Never fetches Alpaca or OpenAI. Classification stays 4A-rule-based; official
 * event/facts identity is part of the input cache key.
 */
export function buildMarketReactions(
  options: BuildMarketReactionsOptions = {},
): BuildMarketReactionsResult {
  const publicDemo = options.publicDemo ?? isPublicDemoMode();
  if (publicDemo) {
    throw new Error(
      "Market reactions build is disabled in public demo (GAMMADESK_PUBLIC_DEMO). " +
        "Public demo derives reactions from synthetic market-context fixtures.",
    );
  }

  const now = options.now ?? new Date();
  const generatedAt = now.toISOString();
  const dataRoot = options.dataRoot ?? DEFAULT_MARKET_REACTIONS_DATA_ROOT;
  const mctxRoot = options.marketContextDataRoot ?? dataRoot;
  const maxPerRun = options.maxPerRun ?? 50;

  let snapshots: EventMarketContext[];
  if (options.snapshots) {
    snapshots = [...options.snapshots];
  } else {
    const loaded = loadMarketContextCache({ dataRoot: mctxRoot, now });
    if (!loaded.ok) {
      throw new Error(
        `Cannot build market reactions: ${loaded.reason}: ${loaded.error}`,
      );
    }
    snapshots = loaded.cache.snapshots;
  }

  const eligible = snapshots
    .filter((s) => isEligibleSnapshot(s, now, MARKET_CONTEXT_FEED_DAYS))
    .slice(0, maxPerRun);

  const prior = loadMarketReactionsCache({ dataRoot, now });
  const priorByCatalyst = new Map<string, EventMarketReaction>();
  if (prior.ok) {
    for (const r of prior.cache.reactions) {
      priorByCatalyst.set(r.catalystId, r);
    }
  }

  const outReactions: EventMarketReaction[] = prior.ok
    ? [
        ...prior.cache.reactions.filter(
          (r) => !eligible.some((e) => e.catalystId === r.catalystId),
        ),
      ]
    : [];
  const inputRefs: MarketReactionInputRef[] = prior.ok
    ? [...prior.cache.inputRefs]
    : [];
  const revisions: MarketReactionRevisionRecord[] = prior.ok
    ? [...prior.cache.revisions]
    : [];
  const errors: MarketReactionBuildError[] = [];
  const warnings: string[] = [];

  let factsIndex: ReadonlyMap<string, string>;
  if (options.officialFactsIdentityByCatalystId) {
    factsIndex = options.officialFactsIdentityByCatalystId;
  } else {
    const loaded = loadOfficialFactsIdentityIndex(dataRoot, now);
    factsIndex = loaded.byCatalystId;
    warnings.push(...loaded.warnings);
  }

  let successCount = 0;
  let failCount = 0;

  for (const snap of eligible) {
    const identity = marketContextIdentity(snap);
    const factsIdentity =
      factsIndex.get(snap.catalystId) ??
      officialEventFactsIdentityFromContext(snap);
    const previous = priorByCatalyst.get(snap.catalystId);
    if (
      !options.force &&
      previous &&
      previous.marketContextIdentity === identity &&
      previous.officialFactsIdentity === factsIdentity &&
      previous.reactionRulesVersion === REACTION_RULES_VERSION &&
      previous.marketContextId === snap.id &&
      (previous.status === "complete" || previous.status === "partial")
    ) {
      outReactions.push(previous);
      successCount += 1;
      continue;
    }

    try {
      const reaction = classifyMarketReaction(snap, {
        generatedAt,
        officialFactsIdentity: factsIdentity,
      });
      outReactions.push(reaction);
      inputRefs.push({
        catalystId: snap.catalystId,
        marketContextId: snap.id,
        marketContextIdentity: identity,
        officialFactsIdentity: factsIdentity,
        reactionRulesVersion: REACTION_RULES_VERSION,
        marketContextCalculationVersion: snap.calculationVersion,
      });
      if (previous && previous.id !== reaction.id) {
        revisions.push({
          catalystId: snap.catalystId,
          previousId: previous.id,
          currentId: reaction.id,
          observedAt: generatedAt,
          reason: options.force
            ? "force rebuild"
            : previous.reactionRulesVersion !== REACTION_RULES_VERSION
              ? "rules version changed"
              : previous.officialFactsIdentity !== factsIdentity
                ? "official facts identity changed"
                : "market context identity changed",
        });
      }
      if (reaction.status === "insufficient") {
        failCount += 1;
        errors.push({
          catalystId: snap.catalystId,
          error: "insufficient source coverage",
          status: reaction.status,
        });
      } else {
        successCount += 1;
      }
    } catch (error: unknown) {
      failCount += 1;
      const message = error instanceof Error ? error.message : String(error);
      errors.push({ catalystId: snap.catalystId, error: message });
      // Keep prior good reaction for this catalyst if present.
      if (previous) outReactions.push(previous);
    }
  }

  const byCatalyst = new Map<string, EventMarketReaction>();
  for (const r of outReactions) byCatalyst.set(r.catalystId, r);
  const deduped = [...byCatalyst.values()];

  const allFailed = eligible.length > 0 && successCount === 0;
  const buildStatus: CatalystMarketReactionsCache["buildStatus"] =
    eligible.length === 0
      ? prior.ok
        ? prior.cache.buildStatus
        : "ok"
      : allFailed
        ? "failed"
        : failCount > 0
          ? "partial"
          : "ok";

  // Dedupe input refs
  const refMap = new Map<string, MarketReactionInputRef>();
  for (const r of inputRefs) refMap.set(r.catalystId, r);

  const cache: CatalystMarketReactionsCache = {
    kind: "CatalystMarketReactionsCache",
    schemaVersion: "0.1.0",
    generatedAt,
    reactionRulesVersion: REACTION_RULES_VERSION,
    buildStatus,
    inputRefs: [...refMap.values()],
    reactions: deduped,
    revisions: revisions.slice(-100),
    errors,
    warnings,
  };

  let path: string | null = null;
  if (options.write !== false) {
    if (
      allFailed &&
      prior.ok &&
      prior.cache.reactions.some(
        (r) => r.status === "complete" || r.status === "partial",
      ) &&
      successCount === 0 &&
      errors.every((e) => e.error !== "insufficient source coverage")
    ) {
      warnings.push(
        "Build produced no usable reactions — prior market-reactions cache left untouched.",
      );
    } else {
      path = marketReactionsLatestPath(dataRoot);
      writeJsonAtomic(path, cache);
    }
  }

  return { cache, path };
}

export { MARKET_REACTION_FEED_DAYS };
