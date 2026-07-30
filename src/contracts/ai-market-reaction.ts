import { z } from "zod";
import { IsoDateTime } from "./common";

export const AI_MARKET_REACTION_SCHEMA_VERSION = "0.1.0";

export const AiMarketReactionStatus = z.enum([
  "complete",
  "partial",
  "rejected",
  "unavailable",
]);

export const AiMarketReactionBullet = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  evidenceIds: z.array(z.string().min(1)).min(1),
});

export const AiMarketReactionUsage = z.object({
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  totalTokens: z.number().int().nonnegative().optional(),
});

/**
 * Evidence-grounded LLM narrative over M2-4A/4B market observations (M2-4C).
 * Never overwrites deterministic reaction or price caches.
 */
export const AiMarketReactionNarrative = z.object({
  schemaVersion: z.literal(AI_MARKET_REACTION_SCHEMA_VERSION),
  id: z.string().min(1),
  catalystId: z.string().min(1),
  marketContextId: z.string().min(1),
  marketContextIdentity: z.string().min(1),
  marketReactionId: z.string().min(1),
  marketReactionIdentity: z.string().min(1),
  reactionRulesVersion: z.string().min(1),
  promptVersion: z.string().min(1),
  provider: z.string().min(1),
  model: z.string().min(1),
  status: AiMarketReactionStatus,
  headline: z.string().min(1).optional(),
  bullets: z.array(AiMarketReactionBullet).optional(),
  validationErrors: z.array(z.string()),
  usage: AiMarketReactionUsage.optional(),
  generatedAt: IsoDateTime,
  synthetic: z.boolean(),
});

/** Strict structured output from the model before local wrap. */
export const AiMarketReactionNarratorOutput = z.object({
  headline: z.string().min(1),
  bullets: z
    .array(
      z.object({
        id: z.string().min(1),
        text: z.string().min(1),
        evidenceIds: z.array(z.string().min(1)).min(1),
      }),
    )
    .min(2)
    .max(4),
  limitations: z.array(z.string()),
});

export type AiMarketReactionNarrative = z.infer<
  typeof AiMarketReactionNarrative
>;
export type AiMarketReactionStatus = z.infer<typeof AiMarketReactionStatus>;
export type AiMarketReactionBullet = z.infer<typeof AiMarketReactionBullet>;
export type AiMarketReactionNarratorOutput = z.infer<
  typeof AiMarketReactionNarratorOutput
>;
export type AiMarketReactionUsage = z.infer<typeof AiMarketReactionUsage>;
