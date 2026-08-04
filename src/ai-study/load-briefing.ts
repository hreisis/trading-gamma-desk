import type { FetchLike } from "@/ingest/http";
import {
  AI_STUDY_BRIEFING_SCHEMA_VERSION,
  AI_STUDY_METHODOLOGY_ID,
  AI_STUDY_METHODOLOGY_VERSION,
  type AiStudyBriefing,
} from "@/contracts/ai-study-briefing";
import { isPublicDemoMode } from "@/desk/public-demo";
import { collectAiStudyInputs } from "./collect-inputs";
import { loadAiStudyLlmConfig, type AiStudyLlmRuntimeConfig } from "./config";
import { loadSyntheticAiStudyBriefing } from "./demo-fixture";
import { generateAiStudyWithFake } from "./fake-generator";
import { generateAiStudyWithOpenAi } from "./openai-generator";

export interface LoadAiStudyBriefingOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly now?: Date;
  readonly config?: AiStudyLlmRuntimeConfig;
  readonly fetchImpl?: FetchLike;
  readonly publicDemo?: boolean;
  readonly useFakeGenerator?: boolean;
}

export async function loadAiStudyBriefing(
  options: LoadAiStudyBriefingOptions = {},
): Promise<AiStudyBriefing> {
  const env = options.env ?? process.env;
  const generatedAt = (options.now ?? new Date()).toISOString();
  const publicDemo = options.publicDemo ?? isPublicDemoMode(env);

  if (publicDemo) {
    return loadSyntheticAiStudyBriefing({ generatedAt });
  }

  const packet = await collectAiStudyInputs(env);
  const config = options.config ?? loadAiStudyLlmConfig(env);

  if (!config.apiKey && !options.useFakeGenerator) {
    return {
      kind: "AiStudyBriefing",
      schemaVersion: AI_STUDY_BRIEFING_SCHEMA_VERSION,
      generatedAt,
      sessionDate: packet.sessionDate,
      status: "unavailable",
      message: "OPENAI_API_KEY missing — AI Study unavailable",
      provider: "unavailable",
      model: null,
      methodologyId: AI_STUDY_METHODOLOGY_ID,
      methodologyVersion: AI_STUDY_METHODOLOGY_VERSION,
      inputs: [...packet.inputs],
      report: null,
    };
  }

  const generated = options.useFakeGenerator
    ? await generateAiStudyWithFake({ packet })
    : await generateAiStudyWithOpenAi({
        packet,
        config,
        fetchImpl: options.fetchImpl,
      });

  if (!generated.ok) {
    return {
      kind: "AiStudyBriefing",
      schemaVersion: AI_STUDY_BRIEFING_SCHEMA_VERSION,
      generatedAt,
      sessionDate: packet.sessionDate,
      status: "error",
      message: generated.error,
      provider: "unavailable",
      model: config.model,
      methodologyId: AI_STUDY_METHODOLOGY_ID,
      methodologyVersion: AI_STUDY_METHODOLOGY_VERSION,
      inputs: [...packet.inputs],
      report: null,
    };
  }

  return {
    kind: "AiStudyBriefing",
    schemaVersion: AI_STUDY_BRIEFING_SCHEMA_VERSION,
    generatedAt,
    sessionDate: packet.sessionDate,
    status: "ready",
    message: "AI Study briefing generated from available desk inputs",
    provider: "openai",
    model: generated.model,
    methodologyId: AI_STUDY_METHODOLOGY_ID,
    methodologyVersion: AI_STUDY_METHODOLOGY_VERSION,
    inputs: [...packet.inputs],
    report: generated.report,
  };
}
