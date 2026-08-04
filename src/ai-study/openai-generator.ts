import { AiStudyNarratorRawOutput } from "@/contracts/ai-study-briefing";
import type { FetchLike } from "@/ingest/http";
import { extractOutputText } from "@/study-agent/openai-narrator";
import type { AiStudyLlmRuntimeConfig } from "./config";
import { OPENAI_RESPONSES_URL } from "./config";
import type { AiStudyInputPacket } from "./collect-inputs";
import {
  AI_STUDY_NARRATOR_JSON_SCHEMA,
  AI_STUDY_SYSTEM_PROMPT,
  buildAiStudyUserPrompt,
} from "./prompt";

export type AiStudyGeneratorResult =
  | {
      readonly ok: true;
      readonly report: AiStudyNarratorRawOutput;
      readonly model: string;
    }
  | {
      readonly ok: false;
      readonly error: string;
    };

export async function generateAiStudyWithOpenAi(input: {
  readonly packet: AiStudyInputPacket;
  readonly config: AiStudyLlmRuntimeConfig;
  readonly fetchImpl?: FetchLike;
  readonly apiUrl?: string;
}): Promise<AiStudyGeneratorResult> {
  if (!input.config.apiKey) {
    return {
      ok: false,
      error: "OPENAI_API_KEY missing — AI Study unavailable",
    };
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const apiUrl = input.apiUrl ?? OPENAI_RESPONSES_URL;
  const body = {
    model: input.config.model,
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: AI_STUDY_SYSTEM_PROMPT }],
      },
      {
        role: "user",
        content: [
          { type: "input_text", text: buildAiStudyUserPrompt(input.packet) },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "ai_study_briefing",
        strict: true,
        schema: AI_STUDY_NARRATOR_JSON_SCHEMA,
      },
    },
    reasoning: { effort: "none" },
    max_output_tokens: input.config.maxOutputTokens,
  };

  const maxAttempts = 1 + input.config.parseRetries;
  let lastError = "unknown error";

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.config.timeoutMs);
    try {
      const response = await fetchImpl(apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.config.apiKey}`,
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
        };
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
      const parsed = AiStudyNarratorRawOutput.safeParse(parsedJson);
      if (!parsed.success) {
        lastError = `Model output schema invalid: ${parsed.error.issues[0]?.message ?? "schema"}`;
        continue;
      }
      return {
        ok: true,
        report: parsed.data,
        model: input.config.model,
      };
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        (error.name === "AbortError" || controller.signal.aborted)
      ) {
        return {
          ok: false,
          error: `OpenAI timed out after ${input.config.timeoutMs}ms`,
        };
      }
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return { ok: false, error: lastError };
}
