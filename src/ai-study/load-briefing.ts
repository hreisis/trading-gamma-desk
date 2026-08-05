import type { FetchLike } from "@/ingest/http";
import {
  AI_STUDY_BRIEFING_SCHEMA_VERSION,
  AI_STUDY_METHODOLOGY_ID,
  AI_STUDY_METHODOLOGY_VERSION,
  type AiStudyBriefing,
} from "@/contracts/ai-study-briefing";
import { collectAiStudyInputs } from "./collect-inputs";
import { loadAiStudyLlmConfig, type AiStudyLlmRuntimeConfig } from "./config";
import { loadSyntheticAiStudyBriefing } from "./demo-fixture";
import { buildAiStudyEvidenceCorpus } from "./evidence-corpus";
import { generateAiStudyWithFake } from "./fake-generator";
import { generateAiStudyWithOpenAi } from "./openai-generator";
import {
  buildRuleBasedAiStudyReport,
  RULE_BASED_AI_STUDY_MODEL,
} from "./rule-based-briefing";
import {
  AI_STUDY_TIMEZONE,
  resolveAiStudyMarketStatus,
} from "./session";
import { validateAiStudyReport } from "./validate";

export interface LoadAiStudyBriefingOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly now?: Date;
  /** Set only for explicit historical replay via ?date=YYYY-MM-DD. */
  readonly sessionDate?: string | null;
  readonly config?: AiStudyLlmRuntimeConfig;
  readonly fetchImpl?: FetchLike;
  readonly publicDemo?: boolean;
  readonly useFakeGenerator?: boolean;
}

function baseBriefing(
  partial: Omit<AiStudyBriefing, "kind" | "schemaVersion" | "methodologyId" | "methodologyVersion">,
): AiStudyBriefing {
  return {
    kind: "AiStudyBriefing",
    schemaVersion: AI_STUDY_BRIEFING_SCHEMA_VERSION,
    methodologyId: AI_STUDY_METHODOLOGY_ID,
    methodologyVersion: AI_STUDY_METHODOLOGY_VERSION,
    ...partial,
  };
}

function sessionMeta(
  options: LoadAiStudyBriefingOptions,
  mode: AiStudyBriefing["mode"],
): Pick<AiStudyBriefing, "mode" | "marketStatus" | "timezone"> {
  const now = options.now ?? new Date();
  return {
    mode,
    marketStatus: resolveAiStudyMarketStatus(now),
    timezone: AI_STUDY_TIMEZONE,
  };
}

function resolveBriefingStatus(input: {
  readonly packetAligned: boolean;
  readonly mode: AiStudyBriefing["mode"];
  readonly groundingOk: boolean;
  readonly hasReport: boolean;
}): AiStudyBriefing["status"] {
  if (!input.hasReport) return "unavailable";
  if (!input.groundingOk) return "error";
  if (input.mode === "current" && !input.packetAligned) return "partial";
  return "ready";
}

function resolveBriefingMessage(input: {
  readonly status: AiStudyBriefing["status"];
  readonly mode: AiStudyBriefing["mode"];
  readonly sessionDate: string | null;
  readonly conflicts: readonly string[];
}): string {
  switch (input.status) {
    case "partial":
      return `Current session ${input.sessionDate ?? "unknown"} — live quotes with partial cached inputs (macro/gamma/historical may lag today).`;
    case "ready":
      return input.mode === "current"
        ? `Current session ${input.sessionDate ?? "unknown"} briefing from live and cached desk inputs.`
        : `Historical session ${input.sessionDate ?? "unknown"} briefing from aligned desk inputs.`;
    case "error":
      return "Grounding validation flagged issues — review evidence before relying on this briefing.";
    default:
      return input.conflicts.length
        ? `Session alignment conflict: ${input.conflicts.join("; ")}`
        : "AI Study unavailable";
  }
}

export async function loadAiStudyBriefing(
  options: LoadAiStudyBriefingOptions = {},
): Promise<AiStudyBriefing> {
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const generatedAt = now.toISOString();
  const publicDemo = options.publicDemo ?? false;

  if (publicDemo) {
    return loadSyntheticAiStudyBriefing({ generatedAt, now });
  }

  const packet = await collectAiStudyInputs({
    env,
    now,
    sessionDate: options.sessionDate,
    publicDemo,
  });
  const sessionFields = sessionMeta(options, packet.mode);
  const config = options.config ?? loadAiStudyLlmConfig(env);

  if (packet.blocked) {
    return baseBriefing({
      generatedAt,
      sessionDate: packet.sessionDate,
      ...sessionFields,
      status: "session_conflict",
      message: packet.blockReason ?? "Session alignment conflict — AI Study blocked",
      provider: "unavailable",
      model: null,
      inputs: [...packet.inputs],
      sessionAlignment: packet.sessionAlignment,
      usage: null,
      grounding: null,
      report: null,
    });
  }

  if (!config.apiKey && !options.useFakeGenerator) {
    const evidence = buildAiStudyEvidenceCorpus(packet.facts, packet.inputs);
    const fallbackReport = buildRuleBasedAiStudyReport(packet);
    const fallbackValidated = validateAiStudyReport({
      report: fallbackReport,
      evidence,
    });
    const status = resolveBriefingStatus({
      packetAligned: packet.sessionAlignment.aligned,
      mode: packet.mode,
      groundingOk: fallbackValidated.ok,
      hasReport: true,
    });
    return baseBriefing({
      generatedAt,
      sessionDate: packet.sessionDate,
      ...sessionFields,
      status,
      message:
        "OPENAI_API_KEY missing — rule-based grounded briefing from desk inputs.",
      provider: "rule_based",
      model: RULE_BASED_AI_STUDY_MODEL,
      inputs: [...packet.inputs],
      sessionAlignment: packet.sessionAlignment,
      usage: null,
      grounding: fallbackValidated.grounding,
      report: fallbackReport,
    });
  }

  const generated = options.useFakeGenerator
    ? await generateAiStudyWithFake({ packet })
    : await generateAiStudyWithOpenAi({
        packet,
        config,
        fetchImpl: options.fetchImpl,
        env,
      });

  if (!generated.ok) {
    const evidence = buildAiStudyEvidenceCorpus(packet.facts, packet.inputs);
    const fallbackReport = buildRuleBasedAiStudyReport(packet);
    const fallbackValidated = validateAiStudyReport({
      report: fallbackReport,
      evidence,
    });
    const status = resolveBriefingStatus({
      packetAligned: packet.sessionAlignment.aligned,
      mode: packet.mode,
      groundingOk: fallbackValidated.ok,
      hasReport: true,
    });
    return baseBriefing({
      generatedAt,
      sessionDate: packet.sessionDate,
      ...sessionFields,
      status,
      message: `LLM generation failed (${generated.error}) — rule-based grounded fallback.`,
      provider: "rule_based",
      model: RULE_BASED_AI_STUDY_MODEL,
      inputs: [...packet.inputs],
      sessionAlignment: packet.sessionAlignment,
      usage: generated.usage,
      grounding: fallbackValidated.grounding,
      report: fallbackReport,
    });
  }

  const evidence = buildAiStudyEvidenceCorpus(packet.facts, packet.inputs);
  const validated = validateAiStudyReport({
    report: generated.report,
    evidence,
  });
  if (!validated.ok) {
    const fallbackReport = buildRuleBasedAiStudyReport(packet);
    const fallbackValidated = validateAiStudyReport({
      report: fallbackReport,
      evidence,
    });
    const status = resolveBriefingStatus({
      packetAligned: packet.sessionAlignment.aligned,
      mode: packet.mode,
      groundingOk: fallbackValidated.ok,
      hasReport: true,
    });
    return baseBriefing({
      generatedAt,
      sessionDate: packet.sessionDate,
      ...sessionFields,
      status,
      message: `LLM briefing failed grounding (${validated.grounding.errors[0] ?? "invalid claims"}) — rule-based grounded fallback.`,
      provider: "rule_based",
      model: RULE_BASED_AI_STUDY_MODEL,
      inputs: [...packet.inputs],
      sessionAlignment: packet.sessionAlignment,
      usage: generated.usage,
      grounding: fallbackValidated.grounding,
      report: fallbackReport,
    });
  }

  const grounding = validated.grounding;
  const groundingOk = validated.ok;
  const status = resolveBriefingStatus({
    packetAligned: packet.sessionAlignment.aligned,
    mode: packet.mode,
    groundingOk,
    hasReport: true,
  });
  const message =
    status === "error"
      ? `Grounding validation failed: ${grounding.errors[0] ?? "invalid claims"}`
      : resolveBriefingMessage({
          status,
          mode: packet.mode,
          sessionDate: packet.sessionDate,
          conflicts: packet.sessionAlignment.conflicts,
        });

  return baseBriefing({
    generatedAt,
    sessionDate: packet.sessionDate,
    ...sessionFields,
    status,
    message,
    provider: "openai",
    model: generated.model,
    inputs: [...packet.inputs],
    sessionAlignment: packet.sessionAlignment,
    usage: generated.usage,
    grounding,
    report: generated.report,
  });
}
