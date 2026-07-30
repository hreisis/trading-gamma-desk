/**
 * LLM config for M2-3C. Defaults live here — business/enhance logic must call
 * these helpers rather than hardcoding model names.
 */

/** Default when CATALYST_LLM_MODEL is unset (config layer only). */
export const DEFAULT_CATALYST_LLM_MODEL = "gpt-5.6-luna";

export const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

export const AI_BRIEF_TIMEOUT_MS = 45_000;
export const AI_BRIEF_MAX_RETRIES = 1;
export const AI_BRIEF_MAX_OUTPUT_TOKENS = 800;
export const AI_BRIEF_MAX_CONCURRENCY = 2;
export const AI_BRIEF_MAX_PER_RUN = 12;
export const AI_BRIEF_FEED_DAYS = 30;

export function resolveCatalystLlmModel(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const fromEnv = (env.CATALYST_LLM_MODEL ?? "").trim();
  return fromEnv || DEFAULT_CATALYST_LLM_MODEL;
}

export function resolveOpenAiApiKey(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const key = (env.OPENAI_API_KEY ?? "").trim();
  return key.length > 0 ? key : null;
}

export interface CatalystLlmRuntimeConfig {
  readonly apiKey: string | null;
  readonly model: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly maxOutputTokens: number;
  readonly maxConcurrency: number;
  readonly maxPerRun: number;
}

export function loadCatalystLlmConfig(
  env: NodeJS.ProcessEnv = process.env,
  overrides: Partial<CatalystLlmRuntimeConfig> = {},
): CatalystLlmRuntimeConfig {
  return {
    apiKey: overrides.apiKey ?? resolveOpenAiApiKey(env),
    model: overrides.model ?? resolveCatalystLlmModel(env),
    timeoutMs: overrides.timeoutMs ?? AI_BRIEF_TIMEOUT_MS,
    maxRetries: overrides.maxRetries ?? AI_BRIEF_MAX_RETRIES,
    maxOutputTokens: overrides.maxOutputTokens ?? AI_BRIEF_MAX_OUTPUT_TOKENS,
    maxConcurrency: overrides.maxConcurrency ?? AI_BRIEF_MAX_CONCURRENCY,
    maxPerRun: overrides.maxPerRun ?? AI_BRIEF_MAX_PER_RUN,
  };
}
