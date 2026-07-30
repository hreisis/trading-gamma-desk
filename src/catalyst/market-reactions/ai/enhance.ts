import { writeJsonAtomic } from "@/desk/atomic-write";
import { isPublicDemoMode } from "@/desk/public-demo";
import type {
  AiMarketReactionNarrative,
  EventMarketContext,
  EventMarketReaction,
} from "@/contracts";
import { marketContextIdentity } from "../classify";
import { loadMarketContextCache } from "../../market-context/cache";
import { loadMarketReactionsCache } from "../cache";
import { REACTION_RULES_VERSION } from "../version";
import { loadAiMarketReactionsCache } from "./cache";
import {
  AI_REACTION_FEED_DAYS,
  loadCatalystReactionLlmConfig,
  type CatalystReactionLlmRuntimeConfig,
} from "./config";
import {
  buildReactionNarratorPacket,
  marketReactionIdentity,
} from "./evidence";
import type { MarketReactionNarrator } from "./narrator";
import { createOpenAiMarketReactionNarrator } from "./openai-narrator";
import { AI_REACTION_PROMPT_VERSION } from "./prompt";
import {
  DEFAULT_AI_MARKET_REACTIONS_DATA_ROOT,
  aiMarketReactionsLatestPath,
} from "./paths";
import type {
  AiMarketReactionBuildError,
  AiMarketReactionInputRef,
  AiMarketReactionRevisionRecord,
  AiMarketReactionUsageRecord,
  CatalystAiMarketReactionsCache,
} from "./types";
import {
  aiMarketReactionIdFor,
  unavailableAiMarketReaction,
  validateAiMarketReactionOutput,
} from "./validate";

export {
  DEFAULT_AI_MARKET_REACTIONS_DATA_ROOT,
  AI_MARKET_REACTIONS_LATEST_RELATIVE,
  aiMarketReactionsLatestPath,
} from "./paths";

export interface EnhanceMarketReactionsOptions {
  readonly now?: Date;
  readonly dataRoot?: string;
  readonly marketContextDataRoot?: string;
  readonly marketReactionsDataRoot?: string;
  readonly publicDemo?: boolean;
  readonly write?: boolean;
  readonly force?: boolean;
  readonly narrator?: MarketReactionNarrator;
  readonly config?: Partial<CatalystReactionLlmRuntimeConfig>;
  readonly contexts?: readonly EventMarketContext[];
  readonly reactions?: readonly EventMarketReaction[];
  readonly maxPerRun?: number;
}

export interface EnhanceMarketReactionsResult {
  readonly cache: CatalystAiMarketReactionsCache;
  readonly path: string | null;
}

async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let i = 0;
  async function worker(): Promise<void> {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]!);
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

function isEligiblePair(
  ctx: EventMarketContext,
  reaction: EventMarketReaction,
  now: Date,
  days: number,
): boolean {
  if (reaction.status === "insufficient") return false;
  if (ctx.status === "unavailable") return false;
  if (reaction.marketContextId !== ctx.id) return false;
  const eventMs = Date.parse(reaction.eventTimestamp);
  if (!Number.isFinite(eventMs)) return false;
  const start = now.getTime() - days * 24 * 60 * 60 * 1000;
  return eventMs >= start && eventMs <= now.getTime();
}

/**
 * Enhance local 4A+4B caches with evidence-grounded LLM narratives.
 * Never fetches Alpaca/calendar/docs/briefs.
 */
export async function enhanceMarketReactions(
  options: EnhanceMarketReactionsOptions = {},
): Promise<EnhanceMarketReactionsResult> {
  const publicDemo = options.publicDemo ?? isPublicDemoMode();
  if (publicDemo) {
    throw new Error(
      "AI market-reaction enhance is disabled in public demo (GAMMADESK_PUBLIC_DEMO). " +
        "Public demo serves synthetic AI reaction fixtures only.",
    );
  }

  const now = options.now ?? new Date();
  const generatedAt = now.toISOString();
  const dataRoot = options.dataRoot ?? DEFAULT_AI_MARKET_REACTIONS_DATA_ROOT;
  const mctxRoot = options.marketContextDataRoot ?? dataRoot;
  const mrxnRoot = options.marketReactionsDataRoot ?? dataRoot;
  const runtime = loadCatalystReactionLlmConfig(
    process.env,
    options.config ?? {},
  );
  const narrator =
    options.narrator ??
    createOpenAiMarketReactionNarrator({ config: runtime });

  let contexts: EventMarketContext[];
  let reactions: EventMarketReaction[];
  if (options.contexts && options.reactions) {
    contexts = [...options.contexts];
    reactions = [...options.reactions];
  } else {
    const mctx = loadMarketContextCache({ dataRoot: mctxRoot, now });
    const mrxn = loadMarketReactionsCache({ dataRoot: mrxnRoot, now });
    if (!mctx.ok) {
      throw new Error(
        `Cannot enhance market reactions: market-context ${mctx.reason}: ${mctx.error}`,
      );
    }
    if (!mrxn.ok) {
      throw new Error(
        `Cannot enhance market reactions: market-reactions ${mrxn.reason}: ${mrxn.error}`,
      );
    }
    contexts = mctx.cache.snapshots;
    reactions = mrxn.cache.reactions;
  }

  const ctxById = new Map(contexts.map((c) => [c.id, c]));
  const pairs = reactions
    .map((r) => {
      const ctx = ctxById.get(r.marketContextId);
      return ctx ? { ctx, reaction: r } : null;
    })
    .filter((p): p is { ctx: EventMarketContext; reaction: EventMarketReaction } =>
      p !== null && isEligiblePair(p.ctx, p.reaction, now, AI_REACTION_FEED_DAYS),
    )
    .slice(0, options.maxPerRun ?? runtime.maxPerRun);

  const prior = loadAiMarketReactionsCache({ dataRoot, now });
  const priorByCatalyst = new Map<string, AiMarketReactionNarrative>();
  if (prior.ok) {
    for (const n of prior.cache.narratives) {
      priorByCatalyst.set(n.catalystId, n);
    }
  }

  if (!runtime.apiKey && !options.narrator) {
    const unavailableCache: CatalystAiMarketReactionsCache = {
      kind: "CatalystAiMarketReactionsCache",
      schemaVersion: "0.1.0",
      generatedAt,
      provider: narrator.providerId,
      model: runtime.model,
      promptVersion: AI_REACTION_PROMPT_VERSION,
      reactionRulesVersion: REACTION_RULES_VERSION,
      buildStatus: "unavailable",
      inputRefs: prior.ok ? prior.cache.inputRefs : [],
      narratives: prior.ok ? prior.cache.narratives : [],
      usage: prior.ok ? prior.cache.usage : [],
      revisions: prior.ok ? prior.cache.revisions : [],
      errors: [
        {
          catalystId: "*",
          error: "OPENAI_API_KEY missing — AI market reaction unavailable",
          status: "unavailable",
        },
      ],
      warnings: [
        "OPENAI_API_KEY missing — prior AI market-reaction cache preserved; UI falls back to rule-based patterns.",
      ],
    };
    return { cache: unavailableCache, path: null };
  }

  const outNarratives: AiMarketReactionNarrative[] = prior.ok
    ? [
        ...prior.cache.narratives.filter(
          (n) => !pairs.some((p) => p.reaction.catalystId === n.catalystId),
        ),
      ]
    : [];
  const inputRefs: AiMarketReactionInputRef[] = prior.ok
    ? [...prior.cache.inputRefs]
    : [];
  const usage: AiMarketReactionUsageRecord[] = prior.ok
    ? [...prior.cache.usage]
    : [];
  const revisions: AiMarketReactionRevisionRecord[] = prior.ok
    ? [...prior.cache.revisions]
    : [];
  const errors: AiMarketReactionBuildError[] = [];
  const warnings: string[] = [];

  const results = await mapPool(
    pairs,
    runtime.maxConcurrency,
    async ({ ctx, reaction }) => {
      const ctxIdentity = marketContextIdentity(ctx);
      const rxnIdentity = marketReactionIdentity(reaction);
      const expectedId = aiMarketReactionIdFor({
        catalystId: reaction.catalystId,
        marketContextIdentity: ctxIdentity,
        marketReactionIdentity: rxnIdentity,
        reactionRulesVersion: reaction.reactionRulesVersion,
        promptVersion: AI_REACTION_PROMPT_VERSION,
        model: runtime.model,
      });
      const previous = priorByCatalyst.get(reaction.catalystId);
      if (
        !options.force &&
        previous &&
        previous.id === expectedId &&
        previous.marketContextIdentity === ctxIdentity &&
        previous.marketReactionIdentity === rxnIdentity &&
        previous.reactionRulesVersion === reaction.reactionRulesVersion &&
        previous.promptVersion === AI_REACTION_PROMPT_VERSION &&
        previous.model === runtime.model &&
        (previous.status === "complete" || previous.status === "partial")
      ) {
        return { kind: "reuse" as const, narrative: previous };
      }

      const packet = buildReactionNarratorPacket(
        ctx,
        reaction,
        ctxIdentity,
        rxnIdentity,
      );

      try {
        const narrated = await narrator.narrate(packet);
        if (!narrated.ok) {
          const ai = unavailableAiMarketReaction({
            context: ctx,
            reaction,
            marketContextIdentity: ctxIdentity,
            marketReactionIdentity: rxnIdentity,
            provider: narrated.provider,
            model: narrated.model,
            generatedAt,
            error: narrated.error,
          });
          return {
            kind: "done" as const,
            narrative: ai,
            error: narrated.error,
            usage: undefined,
            previous,
          };
        }
        const validated = validateAiMarketReactionOutput({
          context: ctx,
          reaction,
          evidence: packet.evidence,
          marketContextIdentity: ctxIdentity,
          marketReactionIdentity: rxnIdentity,
          output: narrated.output,
          provider: narrated.provider,
          model: narrated.model,
          generatedAt,
          synthetic: reaction.synthetic,
          usage: narrated.usage,
        });
        return {
          kind: "done" as const,
          narrative: validated,
          error:
            validated.status === "rejected"
              ? validated.validationErrors.join("; ")
              : undefined,
          usage: narrated.usage,
          previous,
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const ai = unavailableAiMarketReaction({
          context: ctx,
          reaction,
          marketContextIdentity: ctxIdentity,
          marketReactionIdentity: rxnIdentity,
          provider: narrator.providerId,
          model: runtime.model,
          generatedAt,
          error: message,
        });
        return {
          kind: "done" as const,
          narrative: ai,
          error: message,
          previous,
        };
      }
    },
  );

  let successCount = 0;
  let failCount = 0;
  for (let i = 0; i < pairs.length; i++) {
    const { reaction } = pairs[i]!;
    const result = results[i]!;
    const narrative = result.narrative;
    outNarratives.push(narrative);
    const ctxIdentity = narrative.marketContextIdentity;
    const rxnIdentity = narrative.marketReactionIdentity;
    inputRefs.push({
      catalystId: reaction.catalystId,
      marketContextId: narrative.marketContextId,
      marketContextIdentity: ctxIdentity,
      marketReactionId: narrative.marketReactionId,
      marketReactionIdentity: rxnIdentity,
      reactionRulesVersion: narrative.reactionRulesVersion,
      promptVersion: AI_REACTION_PROMPT_VERSION,
      model: runtime.model,
    });
    if (result.kind === "done" && result.usage) {
      usage.push({
        catalystId: reaction.catalystId,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        totalTokens: result.usage.totalTokens,
      });
    }
    if (
      result.kind === "done" &&
      result.previous &&
      (result.previous.id !== narrative.id || options.force)
    ) {
      revisions.push({
        catalystId: reaction.catalystId,
        previousId: result.previous.id,
        currentId: narrative.id,
        observedAt: generatedAt,
        reason: options.force ? "force refresh" : "identity changed",
      });
    }
    if (narrative.status === "complete" || narrative.status === "partial") {
      successCount += 1;
    } else {
      failCount += 1;
      if (result.kind === "done" && result.error) {
        errors.push({
          catalystId: reaction.catalystId,
          error: result.error,
          status: narrative.status,
        });
      }
    }
  }

  const byCatalyst = new Map<string, AiMarketReactionNarrative>();
  for (const n of outNarratives) byCatalyst.set(n.catalystId, n);
  const deduped = [...byCatalyst.values()];

  const allFailed = pairs.length > 0 && successCount === 0;
  const providerTotalFailure =
    allFailed &&
    errors.every((e) =>
      /OPENAI_API_KEY missing|timed out|HTTP 5|provider failure/i.test(
        e.error,
      ),
    );

  const buildStatus: CatalystAiMarketReactionsCache["buildStatus"] =
    pairs.length === 0
      ? prior.ok
        ? prior.cache.buildStatus
        : "ok"
      : allFailed
        ? "failed"
        : failCount > 0
          ? "partial"
          : "ok";

  const refMap = new Map<string, AiMarketReactionInputRef>();
  for (const r of inputRefs) refMap.set(r.catalystId, r);

  const cache: CatalystAiMarketReactionsCache = {
    kind: "CatalystAiMarketReactionsCache",
    schemaVersion: "0.1.0",
    generatedAt,
    provider: narrator.providerId,
    model: runtime.model,
    promptVersion: AI_REACTION_PROMPT_VERSION,
    reactionRulesVersion: REACTION_RULES_VERSION,
    buildStatus,
    inputRefs: [...refMap.values()],
    narratives: deduped,
    usage: usage.slice(-200),
    revisions: revisions.slice(-100),
    errors,
    warnings,
  };

  const shouldWrite =
    options.write !== false &&
    !(
      providerTotalFailure &&
      prior.ok &&
      prior.cache.narratives.length > 0
    );

  let path: string | null = null;
  if (shouldWrite) {
    path = aiMarketReactionsLatestPath(dataRoot);
    writeJsonAtomic(path, cache);
  } else if (providerTotalFailure) {
    warnings.push(
      "Provider-wide failure — prior AI market-reaction cache left untouched.",
    );
  }

  return { cache, path };
}

export function filterAiMarketReactionsForFeed(
  narratives: readonly AiMarketReactionNarrative[],
  reactions: readonly EventMarketReaction[],
): AiMarketReactionNarrative[] {
  const byId = new Map(reactions.map((r) => [r.id, r]));
  return narratives.filter((n) => {
    if (n.status !== "complete" && n.status !== "partial") return false;
    if (n.validationErrors.length > 0) return false;
    const r = byId.get(n.marketReactionId);
    if (!r) return false;
    if (n.marketReactionIdentity !== marketReactionIdentity(r)) return false;
    if (n.marketContextIdentity !== r.marketContextIdentity) return false;
    if (n.reactionRulesVersion !== r.reactionRulesVersion) return false;
    return true;
  });
}
