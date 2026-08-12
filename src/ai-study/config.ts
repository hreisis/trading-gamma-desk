import {
  resolveOpenAiApiKey,
  OPENAI_RESPONSES_URL,
  AI_BRIEF_TIMEOUT_MS,
  AI_BRIEF_MAX_RETRIES,
} from "@/catalyst/briefs/ai/config";

export {
  OPENAI_RESPONSES_URL,
  resolveOpenAiApiKey,
} from "@/catalyst/briefs/ai/config";

export const AI_STUDY_MAX_OUTPUT_TOKENS = 1400;
export const AI_STUDY_PARSE_RETRIES = 2;
export const AI_STUDY_DEFAULT_LLM_MODEL = "gpt-4.1-mini";

export function resolveAiStudyLlmModel(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const fromEnv = (env.AI_STUDY_LLM_MODEL ?? "").trim();
  return fromEnv || AI_STUDY_DEFAULT_LLM_MODEL;
}

export interface AiStudyLlmRuntimeConfig {
  readonly apiKey: string | null;
  readonly model: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly maxOutputTokens: number;
  readonly parseRetries: number;
}

export function describeMissingAiStudyLlmEnv(
  env: NodeJS.ProcessEnv = process.env,
): readonly string[] {
  const missing: string[] = [];
  if (!resolveOpenAiApiKey(env)) {
    missing.push("OPENAI_API_KEY");
  }
  return missing;
}

export function describeAiStudyLlmModelSource(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const fromEnv = (env.AI_STUDY_LLM_MODEL ?? "").trim();
  if (fromEnv) return `AI_STUDY_LLM_MODEL=${fromEnv}`;
  return `default (${AI_STUDY_DEFAULT_LLM_MODEL})`;
}

/**
 * Responses API `reasoning.effort` is only accepted on reasoning-model families
 * (e.g. gpt-5*, o-series). Chat models such as gpt-4.1-mini reject the parameter.
 */
export function openAiResponsesReasoningEffort(
  model: string,
): { readonly effort: "none" } | undefined {
  const id = model.trim().toLowerCase();
  if (!id) return undefined;
  if (/^gpt-5/.test(id) || /^o\d/.test(id)) {
    return { effort: "none" };
  }
  return undefined;
}

export function loadAiStudyLlmConfig(
  env: NodeJS.ProcessEnv = process.env,
  overrides: Partial<AiStudyLlmRuntimeConfig> = {},
): AiStudyLlmRuntimeConfig {
  return {
    apiKey: overrides.apiKey ?? resolveOpenAiApiKey(env),
    model: overrides.model ?? resolveAiStudyLlmModel(env),
    timeoutMs: overrides.timeoutMs ?? AI_BRIEF_TIMEOUT_MS,
    maxRetries: overrides.maxRetries ?? AI_BRIEF_MAX_RETRIES,
    maxOutputTokens: overrides.maxOutputTokens ?? AI_STUDY_MAX_OUTPUT_TOKENS,
    parseRetries: overrides.parseRetries ?? AI_STUDY_PARSE_RETRIES,
  };
}
