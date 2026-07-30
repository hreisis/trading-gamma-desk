import type { AiMarketReactionNarratorOutput } from "@/contracts";
import type { ReactionNarratorInputPacket } from "./evidence";
import type {
  MarketReactionNarrator,
  ReactionNarratorResult,
} from "./narrator";

export type FakeReactionNarratorMode =
  | "ok"
  | "hallucinated_number"
  | "bad_citation"
  | "no_citation"
  | "prohibited_causal"
  | "prohibited_tone"
  | "entity_yield"
  | "entity_dxy"
  | "provider_error"
  | "timeout"
  | "invalid_json_shape"
  | "mismatch_breadth";

export function createFakeMarketReactionNarrator(
  mode: FakeReactionNarratorMode = "ok",
  model = "fake-model",
): MarketReactionNarrator {
  return {
    providerId: "fake",
    async narrate(
      packet: ReactionNarratorInputPacket,
    ): Promise<ReactionNarratorResult> {
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

      const evidenceIds = packet.evidence.slice(0, 4).map((e) => e.evidenceId);
      const e0 = evidenceIds[0] ?? "missing";
      const e1 = evidenceIds[1] ?? e0;
      const changeEv = packet.evidence.find((e) => e.kind === "changePct");
      const breadthEv = packet.evidence.find(
        (e) => e.kind === "equityBreadth" && e.window === "30m",
      );

      const base: AiMarketReactionNarratorOutput = {
        headline: "Observed ETF proxy moves around the release",
        bullets: [
          {
            id: "b1",
            text:
              breadthEv?.value === "broadly_higher"
                ? "At +30m, the three equity ETF proxies were broadly higher."
                : breadthEv?.value === "broadly_lower"
                  ? "At +30m, the three equity ETF proxies were broadly lower."
                  : `At +30m, equity ETF proxy breadth was ${String(breadthEv?.value ?? "mixed")}.`,
            evidenceIds: breadthEv
              ? [breadthEv.evidenceId]
              : [e0],
          },
          {
            id: "b2",
            text: changeEv
              ? `Over the observed window, ${changeEv.symbol} ETF proxy changed ${changeEv.value}%.`
              : "Over the observed window, ETF proxy moves were recorded.",
            evidenceIds: changeEv ? [changeEv.evidenceId] : [e1],
          },
        ],
        limitations:
          packet.reactionStatus === "partial" ||
          packet.contextStatus === "partial"
            ? ["Some windows or symbols are unavailable in the source input."]
            : [],
      };

      if (mode === "hallucinated_number") {
        base.bullets[0] = {
          ...base.bullets[0]!,
          text: "At +30m, SPY ETF proxy surged by 99.99%.",
          evidenceIds: changeEv ? [changeEv.evidenceId] : [e0],
        };
      }
      if (mode === "bad_citation") {
        base.bullets[0] = {
          ...base.bullets[0]!,
          evidenceIds: ["evidence_does_not_exist"],
        };
      }
      if (mode === "no_citation") {
        base.bullets[0] = {
          id: "b1",
          text: base.bullets[0]!.text,
          evidenceIds: [],
        } as AiMarketReactionNarratorOutput["bullets"][number];
      }
      if (mode === "prohibited_causal") {
        base.bullets[0] = {
          ...base.bullets[0]!,
          text: "Stocks rallied because the release caused risk-on flows.",
        };
      }
      if (mode === "prohibited_tone") {
        base.headline = "Bullish and hawkish reaction";
        base.bullets[0] = {
          ...base.bullets[0]!,
          text: "Investors interpreted the print as hawkish while markets stayed bullish.",
        };
      }
      if (mode === "entity_yield") {
        base.bullets[1] = {
          ...base.bullets[1]!,
          text: "Treasury yields rose as TLT fell at +30m.",
          evidenceIds: [
            packet.evidence.find((e) => e.symbol === "TLT")?.evidenceId ?? e1,
          ],
        };
      }
      if (mode === "entity_dxy") {
        base.bullets[1] = {
          ...base.bullets[1]!,
          text: "The DXY dollar index was higher at +30m.",
          evidenceIds: [
            packet.evidence.find((e) => e.symbol === "UUP")?.evidenceId ?? e1,
          ],
        };
      }
      if (mode === "mismatch_breadth") {
        base.bullets[0] = {
          id: "b1",
          text: "At +30m, the three equity ETF proxies were broadly lower.",
          evidenceIds: breadthEv ? [breadthEv.evidenceId] : [e0],
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
