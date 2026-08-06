import type { AiStudyLlmUsage } from "@/contracts/ai-study-briefing";

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

export function parseUsage(payload: unknown): AiStudyLlmUsage | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const u = (payload as Record<string, unknown>).usage;
  if (!u || typeof u !== "object") return undefined;
  const usage = u as Record<string, unknown>;
  const inputTokens =
    typeof usage.input_tokens === "number" ? usage.input_tokens : 0;
  const outputTokens =
    typeof usage.output_tokens === "number" ? usage.output_tokens : 0;
  const totalTokens =
    typeof usage.total_tokens === "number"
      ? usage.total_tokens
      : inputTokens + outputTokens;
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    retryCount: 0,
    estimatedCostUsd: 0,
  };
}
