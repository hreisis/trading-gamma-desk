/**
 * LLM config for M2-4C market-reaction narratives.
 * Defaults live here — enhance logic must not hardcode model names.
 * Shares OPENAI_API_KEY resolution with M2-3C.
 */

import {
  OPENAI_RESPONSES_URL,
  resolveOpenAiApiKey,
} from "../../briefs/ai/config";

export { OPENAI_RESPONSES_URL, resolveOpenAiApiKey };

/** Default when CATALYST_REACTION_LLM_MODEL is unset (config layer only). */
export const DEFAULT_CATALYST_REACTION_LLM_MODEL = "gpt-5.6-luna";

export const AI_REACTION_TIMEOUT_MS = 45_000;
export const AI_REACTION_MAX_RETRIES = 1;
export const AI_REACTION_MAX_OUTPUT_TOKENS = 800;
export const AI_REACTION_MAX_CONCURRENCY = 2;
export const AI_REACTION_MAX_PER_RUN = 12;
export const AI_REACTION_FEED_DAYS = 30;

export function resolveCatalystReactionLlmModel(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const fromEnv = (env.CATALYST_REACTION_LLM_MODEL ?? "").trim();
  return fromEnv || DEFAULT_CATALYST_REACTION_LLM_MODEL;
}

export interface CatalystReactionLlmRuntimeConfig {
  readonly apiKey: string | null;
  readonly model: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly maxOutputTokens: number;
  readonly maxConcurrency: number;
  readonly maxPerRun: number;
}

export function loadCatalystReactionLlmConfig(
  env: NodeJS.ProcessEnv = process.env,
  overrides: Partial<CatalystReactionLlmRuntimeConfig> = {},
): CatalystReactionLlmRuntimeConfig {
  return {
    apiKey: overrides.apiKey ?? resolveOpenAiApiKey(env),
    model: overrides.model ?? resolveCatalystReactionLlmModel(env),
    timeoutMs: overrides.timeoutMs ?? AI_REACTION_TIMEOUT_MS,
    maxRetries: overrides.maxRetries ?? AI_REACTION_MAX_RETRIES,
    maxOutputTokens: overrides.maxOutputTokens ?? AI_REACTION_MAX_OUTPUT_TOKENS,
    maxConcurrency: overrides.maxConcurrency ?? AI_REACTION_MAX_CONCURRENCY,
    maxPerRun: overrides.maxPerRun ?? AI_REACTION_MAX_PER_RUN,
  };
}
