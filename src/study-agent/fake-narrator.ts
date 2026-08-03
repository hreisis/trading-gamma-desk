import type { StudyMemoNarratorOutput } from "@/contracts";
import type {
  StudyMemoInputPacket,
  StudyMemoNarrator,
  StudyMemoNarratorResult,
} from "./narrator";

export type FakeStudyMemoNarratorMode =
  | "ok"
  | "bad_citation"
  | "hallucinated_number"
  | "prohibited"
  | "prediction"
  | "provider_error"
  | "invalid_json_shape";

export function createFakeStudyMemoNarrator(
  mode: FakeStudyMemoNarratorMode = "ok",
  model = "fake-model",
): StudyMemoNarrator {
  return {
    providerId: "fake",
    async narrate(packet: StudyMemoInputPacket): Promise<StudyMemoNarratorResult> {
      if (mode === "provider_error") {
        return {
          ok: false,
          provider: "fake",
          model,
          error: "fake provider failure",
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

      const meanReturn =
        packet.horizonEvidence.d5.aggregate.meanReturn ?? 0.02;
      const output: StudyMemoNarratorOutput = {
        headline: "Similar-regime study memo",
        evidence: [
          {
            id: "ev1",
            text: `Evidence status is ${packet.evidenceStatus}.`,
            bundleFieldPaths: [
              "bundle.evidenceStatus",
              "bundle.primaryHorizon",
            ],
          },
          {
            id: "ev2",
            text: `Matched ${packet.cohortQuality.matchedStudyCount} studies with ${packet.cohortQuality.primaryHorizonMatureCount} mature primary outcomes.`,
            bundleFieldPaths: [
              "bundle.cohortQuality.matchedStudyCount",
              "bundle.cohortQuality.primaryHorizonMatureCount",
            ],
          },
        ],
        inference: [
          {
            id: "inf1",
            text: `Historical cohort mean return on the primary horizon is ${meanReturn}.`,
            bundleFieldPaths: [
              "bundle.horizonEvidence.d5.aggregate.meanReturn",
            ],
          },
        ],
        limitations: packet.limitations.slice(0, 1).map((text, i) => ({
          id: `lim${i + 1}`,
          text,
          bundleFieldPaths: ["bundle.limitations"],
        })),
        unknowns:
          packet.warnings.length > 0
            ? [
                {
                  id: "unk1",
                  text: packet.warnings[0]!,
                  bundleFieldPaths: ["bundle.cohortQuality.warnings"],
                },
              ]
            : [],
      };

      if (mode === "bad_citation") {
        output.evidence[0] = {
          ...output.evidence[0]!,
          bundleFieldPaths: ["bundle.nonexistent.field"],
        };
      }
      if (mode === "hallucinated_number") {
        output.inference[0] = {
          ...output.inference[0]!,
          text: "Historical cohort mean return on 5D is 99.99.",
        };
      }
      if (mode === "prohibited") {
        output.inference[0] = {
          ...output.inference[0]!,
          text: "This setup is bullish and investors should buy SPY.",
        };
      }
      if (mode === "prediction") {
        output.inference[0] = {
          ...output.inference[0]!,
          text: "SPY will rally over the next five sessions.",
          bundleFieldPaths: ["bundle.horizonEvidence.d5.aggregate.meanReturn"],
        };
      }

      return {
        ok: true,
        output,
        provider: "fake",
        model,
        usage: { inputTokens: 50, outputTokens: 80, totalTokens: 130 },
      };
    },
  };
}
