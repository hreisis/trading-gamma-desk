import { AiMarketReactionNarratorOutput } from "@/contracts";
import type { FetchLike } from "@/ingest/http";
import {
  AI_REACTION_MAX_OUTPUT_TOKENS,
  AI_REACTION_MAX_RETRIES,
  AI_REACTION_TIMEOUT_MS,
  OPENAI_RESPONSES_URL,
  type CatalystReactionLlmRuntimeConfig,
} from "./config";
import type { ReactionNarratorInputPacket } from "./evidence";
import type {
  MarketReactionNarrator,
  ReactionNarratorResult,
  ReactionNarratorUsage,
} from "./narrator";
import {
  AI_REACTION_NARRATOR_JSON_SCHEMA,
  AI_REACTION_SYSTEM_PROMPT,
  buildReactionUserPrompt,
} from "./prompt";

export interface OpenAiReactionNarratorOptions {
  readonly config: CatalystReactionLlmRuntimeConfig;
  readonly fetchImpl?: FetchLike;
  readonly apiUrl?: string;
}

function extractOutputText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const o = payload as Record<string, unknown>;
  if (typeof o.output_text === "string" && o.output_text.trim()) {
    return o.output_text;
  }
  if (!Array.isArray(o.output)) return null;
  for (const item of o.output) {
    if (!item || typeof item !== "object") continue;
    const block = item as Record<string, unknown>;
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

function parseUsage(payload: unknown): ReactionNarratorUsage | undefined {
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

export function createOpenAiMarketReactionNarrator(
  options: OpenAiReactionNarratorOptions,
): MarketReactionNarrator {
  const config = options.config;
  const fetchImpl = options.fetchImpl ?? fetch;
  const apiUrl = options.apiUrl ?? OPENAI_RESPONSES_URL;

  return {
    providerId: "openai",
    async narrate(
      packet: ReactionNarratorInputPacket,
    ): Promise<ReactionNarratorResult> {
      if (!config.apiKey) {
        return {
          ok: false,
          provider: "openai",
          model: config.model,
          error: "OPENAI_API_KEY missing — AI market reaction unavailable",
          unavailable: true,
        };
      }

      const body = {
        model: config.model,
        input: [
          {
            role: "system",
            content: [{ type: "input_text", text: AI_REACTION_SYSTEM_PROMPT }],
          },
          {
            role: "user",
            content: [
              { type: "input_text", text: buildReactionUserPrompt(packet) },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "catalyst_ai_market_reaction",
            strict: true,
            schema: AI_REACTION_NARRATOR_JSON_SCHEMA,
          },
        },
        reasoning: { effort: "none" },
        max_output_tokens:
          config.maxOutputTokens ?? AI_REACTION_MAX_OUTPUT_TOKENS,
      };

      const maxAttempts = 1 + (config.maxRetries ?? AI_REACTION_MAX_RETRIES);
      let lastError = "unknown error";

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(
          () => controller.abort(),
          config.timeoutMs ?? AI_REACTION_TIMEOUT_MS,
        );
        try {
          const response = await fetchImpl(apiUrl, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${config.apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
            signal: controller.signal,
          });
          const rawText = await response.text();
          if (!response.ok) {
            lastError = `OpenAI HTTP ${response.status}: ${rawText.slice(0, 200)}`;
            continue;
          }
          let json: unknown;
          try {
            json = JSON.parse(rawText) as unknown;
          } catch {
            lastError = "OpenAI response is not JSON";
            continue;
          }
          const text = extractOutputText(json);
          if (!text) {
            lastError = "OpenAI response missing structured output text";
            continue;
          }
          let parsedJson: unknown;
          try {
            parsedJson = JSON.parse(text) as unknown;
          } catch {
            lastError = "Model output is not JSON";
            continue;
          }
          const parsed = AiMarketReactionNarratorOutput.safeParse(parsedJson);
          if (!parsed.success) {
            lastError = `Model output schema invalid: ${parsed.error.issues[0]?.message ?? "schema"}`;
            continue;
          }
          return {
            ok: true,
            output: parsed.data,
            provider: "openai",
            model: config.model,
            usage: parseUsage(json),
          };
        } catch (error: unknown) {
          if (
            error instanceof Error &&
            (error.name === "AbortError" || /timed out/i.test(error.message))
          ) {
            lastError = `OpenAI timed out after ${config.timeoutMs ?? AI_REACTION_TIMEOUT_MS}ms`;
          } else {
            lastError =
              error instanceof Error ? error.message : String(error);
          }
        } finally {
          clearTimeout(timer);
        }
      }

      return {
        ok: false,
        provider: "openai",
        model: config.model,
        error: lastError,
      };
    },
  };
}
