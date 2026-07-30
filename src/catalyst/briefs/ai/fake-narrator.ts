import type { AiNarratorOutput } from "@/contracts";
import type {
  BriefNarrator,
  NarratorInputPacket,
  NarratorResult,
} from "./narrator";

export type FakeNarratorMode =
  | "ok"
  | "hallucinated_number"
  | "bad_citation"
  | "no_citation"
  | "prohibited"
  | "beat_miss"
  | "provider_error"
  | "timeout"
  | "invalid_json_shape";

export function createFakeBriefNarrator(
  mode: FakeNarratorMode = "ok",
  model = "fake-model",
): BriefNarrator {
  return {
    providerId: "fake",
    async narrate(packet: NarratorInputPacket): Promise<NarratorResult> {
      if (mode === "provider_error") {
        return {
          ok: false,
          provider: "fake",
          model,
          error: "fake provider failure",
        };
      }
      if (mode === "timeout") {
        return {
          ok: false,
          provider: "fake",
          model,
          error: "OpenAI timed out after 1ms",
        };
      }
      if (mode === "invalid_json_shape") {
        return {
          ok: false,
          provider: "fake",
          model,
          error: "Model output schema invalid: Required",
        };
      }

      const factIds = packet.facts.slice(0, 2).map((f) => f.id);
      const base: AiNarratorOutput = {
        headline: `${packet.releaseFamily} update${packet.referencePeriod ? ` (${packet.referencePeriod})` : ""}`,
        bullets: [
          {
            id: "b1",
            text: packet.facts[0]?.text ?? "Fact one",
            factIds: factIds.length ? [factIds[0]!] : ["missing"],
          },
          {
            id: "b2",
            text: packet.facts[1]?.text ?? packet.facts[0]?.text ?? "Fact two",
            factIds:
              factIds.length > 1
                ? [factIds[1]!]
                : factIds.length
                  ? [factIds[0]!]
                  : ["missing"],
          },
        ],
        limitations:
          packet.status === "partial"
            ? ["Summary is incomplete because the source brief is partial."]
            : [],
      };

      if (mode === "hallucinated_number") {
        base.bullets[0] = {
          ...base.bullets[0]!,
          text: "Payrolls surged by 999999 thousand in a surprise print.",
        };
      }
      if (mode === "bad_citation") {
        base.bullets[0] = {
          ...base.bullets[0]!,
          factIds: ["fact_does_not_exist"],
        };
      }
      if (mode === "no_citation") {
        // Intentionally invalid for local validator (bypasses Zod min length).
        base.bullets[0] = {
          id: "b1",
          text: packet.facts[0]?.text ?? "x",
          factIds: [],
        } as AiNarratorOutput["bullets"][number];
      }
      if (mode === "prohibited") {
        base.headline = "Hawkish hold keeps policy restrictive";
        base.bullets[0] = {
          ...base.bullets[0]!,
          text: "The committee sounded hawkish while markets stayed bullish.",
        };
      }
      if (mode === "beat_miss") {
        base.bullets[0] = {
          ...base.bullets[0]!,
          text: "The print beat consensus expectations handily.",
        };
      }

      return {
        ok: true,
        output: base,
        provider: "fake",
        model,
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      };
    },
  };
}
