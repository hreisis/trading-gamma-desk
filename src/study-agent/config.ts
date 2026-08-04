import {
  resolveCatalystLlmModel,
  resolveOpenAiApiKey,
  AI_BRIEF_MAX_RETRIES,
  AI_BRIEF_MAX_OUTPUT_TOKENS,
  AI_BRIEF_TIMEOUT_MS,
  OPENAI_RESPONSES_URL,
} from "@/catalyst/briefs/ai/config";

export {
  OPENAI_RESPONSES_URL,
  resolveOpenAiApiKey,
} from "@/catalyst/briefs/ai/config";

export const DEFAULT_STUDY_MEMO_LLM_MODEL = "gpt-5.6-luna";

export const STUDY_MEMO_TIMEOUT_MS = AI_BRIEF_TIMEOUT_MS;
/** Retries after initial attempt for malformed/non-JSON/schema-invalid provider output only. */
export const STUDY_MEMO_PARSE_RETRIES = 1;
export const STUDY_MEMO_MAX_RETRIES = AI_BRIEF_MAX_RETRIES;
export const STUDY_MEMO_MAX_OUTPUT_TOKENS = 1200;

export function resolveStudyMemoLlmModel(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const fromEnv = (env.STUDY_MEMO_LLM_MODEL ?? "").trim();
  return fromEnv || resolveCatalystLlmModel(env);
}

export interface StudyMemoLlmRuntimeConfig {
  readonly apiKey: string | null;
  readonly model: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly maxOutputTokens: number;
  readonly parseRetries?: number;
}

export function loadStudyMemoLlmConfig(
  env: NodeJS.ProcessEnv = process.env,
  overrides: Partial<StudyMemoLlmRuntimeConfig> = {},
): StudyMemoLlmRuntimeConfig {
  return {
    apiKey: overrides.apiKey ?? resolveOpenAiApiKey(env),
    model: overrides.model ?? resolveStudyMemoLlmModel(env),
    timeoutMs: overrides.timeoutMs ?? STUDY_MEMO_TIMEOUT_MS,
    maxRetries: overrides.maxRetries ?? STUDY_MEMO_MAX_RETRIES,
    maxOutputTokens: overrides.maxOutputTokens ?? STUDY_MEMO_MAX_OUTPUT_TOKENS,
  };
}
