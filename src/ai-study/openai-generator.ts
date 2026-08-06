import { AiStudyNarratorRawOutput } from "@/contracts/ai-study-briefing";
import type { AiStudyLlmUsage } from "@/contracts/ai-study-briefing";
import type { FetchLike } from "@/ingest/http";
import { extractOutputText, parseUsage } from "./openai-utils";
import type { AiStudyLlmRuntimeConfig } from "./config";
import { OPENAI_RESPONSES_URL } from "./config";
import type { AiStudyInputPacket } from "./collect-inputs";
import { buildAiStudyEvidenceCorpus } from "./evidence-corpus";
import {
  AI_STUDY_NARRATOR_JSON_SCHEMA,
  AI_STUDY_SYSTEM_PROMPT,
  buildAiStudyUserPrompt,
} from "./prompt";
import { buildAiStudyUsage } from "./usage";

export type AiStudyGeneratorResult =
  | {
      readonly ok: true;
      readonly report: AiStudyNarratorRawOutput;
      readonly model: string;
      readonly usage: AiStudyLlmUsage;
    }
  | {
      readonly ok: false;
      readonly error: string;
      readonly usage: AiStudyLlmUsage | null;
    };

export async function generateAiStudyWithOpenAi(input: {
  readonly packet: AiStudyInputPacket;
  readonly config: AiStudyLlmRuntimeConfig;
  readonly fetchImpl?: FetchLike;
  readonly apiUrl?: string;
  readonly env?: NodeJS.ProcessEnv;
}): Promise<AiStudyGeneratorResult> {
  if (!input.config.apiKey) {
    return {
      ok: false,
      error: "OPENAI_API_KEY missing — AI Study unavailable",
      usage: null,
    };
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const apiUrl = input.apiUrl ?? OPENAI_RESPONSES_URL;
  const evidence = buildAiStudyEvidenceCorpus(input.packet.facts, input.packet.inputs);
  const validIds = evidence.map((e) => e.id);
  const baseUserPrompt = buildAiStudyUserPrompt(input.packet);
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
          { type: "input_text", text: baseUserPrompt },
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
  let retryCount = 0;
  let lastUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (attempt > 0) retryCount += 1;
    const repairNote =
      attempt > 0
        ? `\n\nRepair attempt ${attempt}: prior output failed validation (${lastError}). Use evidenceIds ONLY from this list: ${validIds.join(", ")}`
        : "";
    const requestBody =
      attempt === 0
        ? body
        : {
            ...body,
            input: [
              body.input[0],
              {
                role: "user",
                content: [
                  {
                    type: "input_text",
                    text: `${baseUserPrompt}${repairNote}`,
                  },
                ],
              },
            ],
          };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.config.timeoutMs);
    try {
      const response = await fetchImpl(apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      const rawText = await response.text();
      if (!response.ok) {
        return {
          ok: false,
          error: `OpenAI HTTP ${response.status}: ${rawText.slice(0, 200)}`,
          usage: buildAiStudyUsage({
            model: input.config.model,
            inputTokens: lastUsage.inputTokens,
            outputTokens: lastUsage.outputTokens,
            retryCount,
            env: input.env,
          }),
        };
      }
      let json: unknown;
      try {
        json = JSON.parse(rawText) as unknown;
      } catch {
        lastError = "OpenAI response is not JSON";
        continue;
      }
      const usageParsed = parseUsage(json);
      if (usageParsed) {
        lastUsage = {
          inputTokens: usageParsed.inputTokens ?? 0,
          outputTokens: usageParsed.outputTokens ?? 0,
          totalTokens: usageParsed.totalTokens ?? 0,
        };
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
        usage: buildAiStudyUsage({
          model: input.config.model,
          inputTokens: lastUsage.inputTokens,
          outputTokens: lastUsage.outputTokens,
          retryCount,
          env: input.env,
        }),
      };
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        (error.name === "AbortError" || controller.signal.aborted)
      ) {
        return {
          ok: false,
          error: `OpenAI timed out after ${input.config.timeoutMs}ms`,
          usage: buildAiStudyUsage({
            model: input.config.model,
            inputTokens: lastUsage.inputTokens,
            outputTokens: lastUsage.outputTokens,
            retryCount,
            env: input.env,
          }),
        };
      }
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        usage: buildAiStudyUsage({
          model: input.config.model,
          inputTokens: lastUsage.inputTokens,
          outputTokens: lastUsage.outputTokens,
          retryCount,
          env: input.env,
        }),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    ok: false,
    error: lastError,
    usage: buildAiStudyUsage({
      model: input.config.model,
      inputTokens: lastUsage.inputTokens,
      outputTokens: lastUsage.outputTokens,
      retryCount,
      env: input.env,
    }),
  };
}
