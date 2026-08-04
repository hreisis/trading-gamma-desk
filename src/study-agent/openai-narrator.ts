import { StudyMemoNarratorRawOutput } from "@/contracts";
import type { FetchLike } from "@/ingest/http";
import { buildCitationCatalogFromPacketEntries } from "./citation-catalog-utils";
import {
  OPENAI_RESPONSES_URL,
  STUDY_MEMO_MAX_OUTPUT_TOKENS,
  STUDY_MEMO_PARSE_RETRIES,
  STUDY_MEMO_TIMEOUT_MS,
  type StudyMemoLlmRuntimeConfig,
} from "./config";
import type {
  StudyMemoInputPacket,
  StudyMemoNarrator,
  StudyMemoNarratorFailureCategory,
  StudyMemoNarratorResult,
  StudyMemoNarratorUsage,
} from "./narrator";
import {
  STUDY_MEMO_NARRATOR_JSON_SCHEMA,
  STUDY_MEMO_SYSTEM_PROMPT,
  buildStudyMemoUserPrompt,
} from "./prompt";
import { resolveStudyMemoNarratorOutput } from "./resolve-narrator-output";

export interface OpenAiStudyMemoNarratorOptions {
  readonly config: StudyMemoLlmRuntimeConfig;
  readonly fetchImpl?: FetchLike;
  readonly apiUrl?: string;
}

export interface OpenAiStudyMemoParseAttempt {
  readonly ok: true;
  readonly raw: StudyMemoNarratorRawOutput;
  readonly usage?: StudyMemoNarratorUsage;
  readonly attempts: number;
}

export type OpenAiStudyMemoParseFailure = {
  readonly ok: false;
  readonly error: string;
  readonly failureCategory: StudyMemoNarratorFailureCategory;
  readonly attempts: number;
};

export function extractOutputText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const o = payload as Record<string, unknown>;
  if (typeof o.output_text === "string" && o.output_text.trim()) {
    return o.output_text;
  }
  if (!Array.isArray(o.output)) return null;
  for (const item of o.output) {
    if (!item || typeof item !== "object") continue;
    const block = item as Record<string, unknown>;
    if (block.type === "refusal") return null;
    if (Array.isArray(block.content)) {
      for (const c of block.content) {
        if (!c || typeof c !== "object") continue;
        const part = c as Record<string, unknown>;
        if (typeof part.text === "string" && part.text.trim()) {
          return part.text;
        }
      }
    }
  }
  return null;
}

export function parseUsage(payload: unknown): StudyMemoNarratorUsage | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const u = (payload as Record<string, unknown>).usage;
  if (!u || typeof u !== "object") return undefined;
  const usage = u as Record<string, unknown>;
  return {
    inputTokens:
      typeof usage.input_tokens === "number" ? usage.input_tokens : undefined,
    outputTokens:
      typeof usage.output_tokens === "number" ? usage.output_tokens : undefined,
    totalTokens:
      typeof usage.total_tokens === "number" ? usage.total_tokens : undefined,
  };
}

/**
 * Parse OpenAI Responses payload into raw narrator output.
 * Retries at most once for malformed/non-JSON/schema-invalid model output.
 */
export async function parseOpenAiStudyMemoResponse(input: {
  readonly fetchImpl: FetchLike;
  readonly apiUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly packet: StudyMemoInputPacket;
  readonly timeoutMs: number;
  readonly maxOutputTokens: number;
  readonly parseRetries?: number;
}): Promise<OpenAiStudyMemoParseAttempt | OpenAiStudyMemoParseFailure> {
  const body = {
    model: input.model,
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: STUDY_MEMO_SYSTEM_PROMPT }],
      },
      {
        role: "user",
        content: [
          { type: "input_text", text: buildStudyMemoUserPrompt(input.packet) },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "study_memo",
        strict: true,
        schema: STUDY_MEMO_NARRATOR_JSON_SCHEMA,
      },
    },
    reasoning: { effort: "none" },
    max_output_tokens: input.maxOutputTokens,
  };

  const maxAttempts = 1 + (input.parseRetries ?? STUDY_MEMO_PARSE_RETRIES);
  let lastError = "unknown error";

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.timeoutMs);
    try {
      const response = await input.fetchImpl(input.apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const rawText = await response.text();
      if (!response.ok) {
        return {
          ok: false,
          error: `OpenAI HTTP ${response.status}: ${rawText.slice(0, 200)}`,
          failureCategory: "http_error",
          attempts: attempt + 1,
        };
      }
      let json: unknown;
      try {
        json = JSON.parse(rawText) as unknown;
      } catch {
        lastError = "OpenAI response is not JSON";
        if (attempt + 1 < maxAttempts) continue;
        return {
          ok: false,
          error: lastError,
          failureCategory: "provider_parse",
          attempts: attempt + 1,
        };
      }
      const text = extractOutputText(json);
      if (!text) {
        lastError = "OpenAI response missing structured output text";
        if (attempt + 1 < maxAttempts) continue;
        return {
          ok: false,
          error: lastError,
          failureCategory: "provider_parse",
          attempts: attempt + 1,
        };
      }
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(text) as unknown;
      } catch {
        lastError = "Model output is not JSON";
        if (attempt + 1 < maxAttempts) continue;
        return {
          ok: false,
          error: lastError,
          failureCategory: "provider_parse",
          attempts: attempt + 1,
        };
      }
      const parsed = StudyMemoNarratorRawOutput.safeParse(parsedJson);
      if (!parsed.success) {
        lastError = `Model output schema invalid: ${parsed.error.issues[0]?.message ?? "schema"}`;
        if (attempt + 1 < maxAttempts) continue;
        return {
          ok: false,
          error: lastError,
          failureCategory: "provider_parse",
          attempts: attempt + 1,
        };
      }
      return {
        ok: true,
        raw: parsed.data,
        usage: parseUsage(json),
        attempts: attempt + 1,
      };
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        (error.name === "AbortError" || /timed out/i.test(error.message))
      ) {
        return {
          ok: false,
          error: `OpenAI timed out after ${input.timeoutMs}ms`,
          failureCategory: "provider_error",
          attempts: attempt + 1,
        };
      }
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        failureCategory: "provider_error",
        attempts: attempt + 1,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    ok: false,
    error: lastError,
    failureCategory: "provider_parse",
    attempts: maxAttempts,
  };
}

/**
 * OpenAI Responses API study memo narrator with strict Structured Outputs.
 */
export function createOpenAiStudyMemoNarrator(
  options: OpenAiStudyMemoNarratorOptions,
): StudyMemoNarrator {
  const config = options.config;
  const fetchImpl = options.fetchImpl ?? fetch;
  const apiUrl = options.apiUrl ?? OPENAI_RESPONSES_URL;

  return {
    providerId: "openai",
    async narrate(packet: StudyMemoInputPacket): Promise<StudyMemoNarratorResult> {
      if (!config.apiKey) {
        return {
          ok: false,
          provider: "openai",
          model: config.model,
          error: "OPENAI_API_KEY missing — study memo unavailable",
          unavailable: true,
          attempts: 0,
          failureCategory: "missing_api_key",
        };
      }

      const parsed = await parseOpenAiStudyMemoResponse({
        fetchImpl,
        apiUrl,
        apiKey: config.apiKey,
        model: config.model,
        packet,
        timeoutMs: config.timeoutMs ?? STUDY_MEMO_TIMEOUT_MS,
        maxOutputTokens: config.maxOutputTokens ?? STUDY_MEMO_MAX_OUTPUT_TOKENS,
        parseRetries: config.parseRetries ?? STUDY_MEMO_PARSE_RETRIES,
      });

      if (!parsed.ok) {
        return {
          ok: false,
          provider: "openai",
          model: config.model,
          error: parsed.error,
          unavailable: parsed.failureCategory === "missing_api_key",
          attempts: parsed.attempts,
          failureCategory: parsed.failureCategory,
        };
      }

      const catalog = buildCitationCatalogFromPacketEntries(packet.citationCatalog);
      const resolved = resolveStudyMemoNarratorOutput({
        packet,
        catalog,
        raw: parsed.raw,
      });
      if (!resolved.ok) {
        return {
          ok: false,
          provider: "openai",
          model: config.model,
          error: resolved.errors.join("; "),
          attempts: parsed.attempts,
          failureCategory: "citation_resolution",
        };
      }

      return {
        ok: true,
        output: resolved.output,
        provider: "openai",
        model: config.model,
        usage: parsed.usage,
        attempts: parsed.attempts,
      };
    },
  };
}
