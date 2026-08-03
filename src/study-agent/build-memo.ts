import type { StudyEvidenceBundle, StudyMemo } from "@/contracts";
import {
  loadStudyMemoLlmConfig,
  type StudyMemoLlmRuntimeConfig,
} from "./config";
import { createOpenAiStudyMemoNarrator } from "./openai-narrator";
import type { StudyMemoNarrator } from "./narrator";
import { buildStudyMemoInputPacket } from "./prompt";
import {
  abstainStudyMemo,
  unavailableStudyMemo,
  validateStudyMemoOutput,
} from "./validate";

export interface BuildStudyMemoOptions {
  readonly bundle: StudyEvidenceBundle;
  readonly narrator?: StudyMemoNarrator;
  readonly config?: Partial<StudyMemoLlmRuntimeConfig>;
  readonly generatedAt?: string;
  readonly synthetic?: boolean;
}

function shouldAbstain(bundle: StudyEvidenceBundle): boolean {
  return (
    bundle.evidenceStatus === "insufficient_evidence" ||
    bundle.cohortQuality.status === "empty"
  );
}

/**
 * Build a constrained study memo from StudyEvidenceBundle only.
 * Abstains deterministically when evidence is insufficient — no LLM call.
 */
export async function buildStudyMemo(
  options: BuildStudyMemoOptions,
): Promise<StudyMemo> {
  const bundle = options.bundle;
  const generatedAt = options.generatedAt ?? bundle.computedAt;
  const runtime = loadStudyMemoLlmConfig(process.env, options.config ?? {});
  const narrator =
    options.narrator ?? createOpenAiStudyMemoNarrator({ config: runtime });

  if (shouldAbstain(bundle)) {
    return abstainStudyMemo({
      bundle,
      provider: narrator.providerId,
      model: runtime.model,
      generatedAt,
      synthetic: options.synthetic,
    });
  }

  if (!runtime.apiKey && !options.narrator) {
    return unavailableStudyMemo({
      bundle,
      provider: narrator.providerId,
      model: runtime.model,
      generatedAt,
      error: "OPENAI_API_KEY missing — study memo unavailable",
      synthetic: options.synthetic,
    });
  }

  const packet = buildStudyMemoInputPacket(bundle);
  const narrated = await narrator.narrate(packet);
  if (!narrated.ok) {
    return unavailableStudyMemo({
      bundle,
      provider: narrated.provider,
      model: narrated.model,
      generatedAt,
      error: narrated.error,
      synthetic: options.synthetic,
    });
  }

  return validateStudyMemoOutput({
    bundle,
    output: narrated.output,
    provider: narrated.provider,
    model: narrated.model,
    generatedAt,
    synthetic: options.synthetic,
  });
}
