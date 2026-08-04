import type { AiStudyLlmUsage } from "@/contracts/ai-study-briefing";

/** Rough USD estimate — override via env for billing reconciliation. */
export function estimateAiStudyCostUsd(input: {
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly env?: NodeJS.ProcessEnv;
}): number {
  const env = input.env ?? process.env;
  const inputRate = Number(env.AI_STUDY_INPUT_COST_PER_1M ?? "2.5");
  const outputRate = Number(env.AI_STUDY_OUTPUT_COST_PER_1M ?? "10");
  const inCost = (input.inputTokens / 1_000_000) * inputRate;
  const outCost = (input.outputTokens / 1_000_000) * outputRate;
  return Math.round((inCost + outCost) * 1_000_000) / 1_000_000;
}

export function buildAiStudyUsage(input: {
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly retryCount: number;
  readonly env?: NodeJS.ProcessEnv;
}): AiStudyLlmUsage {
  const totalTokens = input.inputTokens + input.outputTokens;
  return {
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    totalTokens,
    retryCount: input.retryCount,
    estimatedCostUsd: estimateAiStudyCostUsd({
      model: input.model,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      env: input.env,
    }),
  };
}
