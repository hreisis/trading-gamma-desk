import type { StudyEvidenceBundle, StudyMemo } from "@/contracts";
import {
  loadStudyMemoLlmConfig,
  type StudyMemoLlmRuntimeConfig,
} from "./config";
import { createOpenAiStudyMemoNarrator } from "./openai-narrator";
import type { StudyMemoNarrator } from "./narrator";
import { buildStudyMemoInputPacket } from "./prompt";
import {
  RULE_BASED_MEMO_MODEL,
  RULE_BASED_MEMO_PROVIDER,
  buildRuleBasedMemoOutput,
} from "./rule-based-memo";
import {
  abstainStudyMemo,
  validateStudyMemoOutput,
} from "./validate";

export type StudyMemoSource =
  | "abstained"
  | "openai"
  | "rule_based_fallback";

export interface StudyMemoWorkflowResult {
  readonly memo: StudyMemo;
  readonly source: StudyMemoSource;
  readonly fallbackReason?: string;
}

export interface RunStudyMemoWorkflowOptions {
  readonly bundle: StudyEvidenceBundle;
  readonly narrator?: StudyMemoNarrator;
  readonly config?: Partial<StudyMemoLlmRuntimeConfig>;
  readonly generatedAt?: string;
  readonly synthetic?: boolean;
  /** Skip LLM narrator even when API key is present (tests). */
  readonly forceFallback?: boolean;
}

function shouldAbstain(bundle: StudyEvidenceBundle): boolean {
  return (
    bundle.evidenceStatus === "insufficient_evidence" ||
    bundle.cohortQuality.status === "empty"
  );
}

function buildRuleBasedMemo(
  bundle: StudyEvidenceBundle,
  generatedAt: string,
  synthetic?: boolean,
): StudyMemo {
  return validateStudyMemoOutput({
    bundle,
    output: buildRuleBasedMemoOutput(bundle),
    provider: RULE_BASED_MEMO_PROVIDER,
    model: RULE_BASED_MEMO_MODEL,
    generatedAt,
    synthetic,
  });
}

function resolveNarrator(
  options: RunStudyMemoWorkflowOptions,
  runtime: StudyMemoLlmRuntimeConfig,
): StudyMemoNarrator | null {
  if (options.forceFallback) return null;
  if (options.narrator) return options.narrator;
  if (runtime.apiKey) {
    return createOpenAiStudyMemoNarrator({ config: runtime });
  }
  return null;
}

/**
 * End-to-end memo workflow: abstain when insufficient; LLM narrator when configured;
 * otherwise deterministic rule-based fallback. Rejected LLM output falls back.
 */
export async function runStudyMemoWorkflow(
  options: RunStudyMemoWorkflowOptions,
): Promise<StudyMemoWorkflowResult> {
  const bundle = options.bundle;
  const generatedAt = options.generatedAt ?? bundle.computedAt;
  const runtime = loadStudyMemoLlmConfig(process.env, options.config ?? {});

  if (shouldAbstain(bundle)) {
    return {
      memo: abstainStudyMemo({
        bundle,
        provider: RULE_BASED_MEMO_PROVIDER,
        model: RULE_BASED_MEMO_MODEL,
        generatedAt,
        synthetic: options.synthetic,
      }),
      source: "abstained",
    };
  }

  const narrator = resolveNarrator(options, runtime);
  if (narrator) {
    const narrated = await narrator.narrate(buildStudyMemoInputPacket(bundle));
    if (narrated.ok) {
      const memo = validateStudyMemoOutput({
        bundle,
        output: narrated.output,
        provider: narrated.provider,
        model: narrated.model,
        generatedAt,
        synthetic: options.synthetic,
      });
      if (memo.status === "complete" || memo.status === "partial") {
        return {
          memo,
          source:
            narrator.providerId === "openai" ? "openai" : "rule_based_fallback",
        };
      }
      return {
        memo: buildRuleBasedMemo(bundle, generatedAt, options.synthetic),
        source: "rule_based_fallback",
        fallbackReason: memo.validation.errors.join("; "),
      };
    }
    return {
      memo: buildRuleBasedMemo(bundle, generatedAt, options.synthetic),
      source: "rule_based_fallback",
      fallbackReason: narrated.error,
    };
  }

  return {
    memo: buildRuleBasedMemo(bundle, generatedAt, options.synthetic),
    source: "rule_based_fallback",
    fallbackReason: "OPENAI_API_KEY missing — rule-based fallback",
  };
}
