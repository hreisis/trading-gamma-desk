import type { StudyMemoNarratorRawOutput } from "@/contracts";
import type {
  StudyMemoInputPacket,
  StudyMemoNarrator,
  StudyMemoNarratorResult,
} from "./narrator";
import { buildCitationCatalogFromPacketEntries } from "./citation-catalog-utils";
import { resolveStudyMemoNarratorOutput } from "./resolve-narrator-output";

export type FakeStudyMemoNarratorMode =
  | "ok"
  | "bad_citation"
  | "hallucinated_number"
  | "prohibited"
  | "prediction"
  | "provider_error"
  | "invalid_json_shape"
  | "missing_first_evidence_citations";

function catalogHasId(packet: StudyMemoInputPacket, id: string): boolean {
  return packet.citationCatalog.some((entry) => entry.id === id);
}

function pickCitationId(
  packet: StudyMemoInputPacket,
  candidates: readonly string[],
): string {
  for (const id of candidates) {
    if (catalogHasId(packet, id)) return id;
  }
  return packet.citationCatalog[0]?.id ?? "evidence_status";
}

function catalogPreview(
  packet: StudyMemoInputPacket,
  id: string,
): string | undefined {
  return packet.citationCatalog.find((entry) => entry.id === id)?.preview;
}

function buildOkRawOutput(packet: StudyMemoInputPacket): StudyMemoNarratorRawOutput {
  const returnCitation = pickCitationId(packet, [
    "d5_mean_return",
    "d5_median_return",
  ]);
  const meanText = catalogPreview(packet, returnCitation) ?? "unavailable";
  return {
    evidence: [
      {
        id: "ev1",
        text: `Evidence status is ${packet.evidenceStatus} with primary horizon ${packet.primaryHorizon}.`,
        citationIds: ["evidence_status", "primary_horizon"],
      },
      {
        id: "ev2",
        text: `Matched ${packet.cohortQuality.matchedStudyCount} studies with ${packet.cohortQuality.primaryHorizonMatureCount} mature primary outcomes.`,
        citationIds: [
          "cohort_matched_study_count",
          "cohort_primary_horizon_mature_count",
        ],
      },
    ],
    inference: [
      {
        id: "inf1",
        text: `Historical cohort mean return on the primary horizon is ${meanText}.`,
        citationIds: [returnCitation],
      },
    ],
    limitations: packet.limitations.slice(0, 1).map((text, i) => ({
      id: `lim${i + 1}`,
      text,
      citationIds: ["limitations"],
    })),
    unknowns:
      packet.warnings.length > 0 && catalogHasId(packet, "cohort_warnings")
        ? [
            {
              id: "unk1",
              text: packet.warnings[0]!,
              citationIds: ["cohort_warnings"],
            },
          ]
        : [],
  };
}

function resolveFakeOutput(
  packet: StudyMemoInputPacket,
  raw: StudyMemoNarratorRawOutput,
): StudyMemoNarratorResult {
  const catalog = buildCitationCatalogFromPacketEntries(packet.citationCatalog);
  const resolved = resolveStudyMemoNarratorOutput({ packet, catalog, raw });
  if (!resolved.ok) {
    return {
      ok: false,
      provider: "fake",
      model: "fake-model",
      error: resolved.errors.join("; "),
      attempts: 1,
      failureCategory: "citation_resolution",
    };
  }
  return {
    ok: true,
    output: resolved.output,
    provider: "fake",
    model: "fake-model",
    usage: { inputTokens: 50, outputTokens: 80, totalTokens: 130 },
    attempts: 1,
  };
}

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
          attempts: 1,
          failureCategory: "provider_error",
        };
      }
      if (mode === "invalid_json_shape") {
        return {
          ok: false,
          provider: "fake",
          model,
          error: "Model output schema invalid: Required",
          attempts: 1,
          failureCategory: "provider_parse",
        };
      }

      let raw = buildOkRawOutput(packet);
      const returnCitation = pickCitationId(packet, [
        "d5_mean_return",
        "d5_median_return",
      ]);

      if (mode === "bad_citation") {
        raw = {
          ...raw,
          evidence: [
            {
              ...raw.evidence[0]!,
              citationIds: ["nonexistent_citation_id"],
            },
            ...raw.evidence.slice(1),
          ],
        };
      }
      if (mode === "missing_first_evidence_citations") {
        raw = {
          ...raw,
          evidence: [
            {
              id: "ev1",
              text: "Missing required citation ids.",
              citationIds: ["cohort_matched_study_count"],
            },
          ],
        };
      }
      if (mode === "hallucinated_number") {
        raw = {
          ...raw,
          inference: [
            {
              id: "inf1",
              text: "Historical cohort mean return on 5D is 99.99.",
              citationIds: [returnCitation],
            },
          ],
        };
      }
      if (mode === "prohibited") {
        raw = {
          ...raw,
          inference: [
            {
              id: "inf1",
              text: "This setup is bullish and investors should buy SPY.",
              citationIds: [returnCitation],
            },
          ],
        };
      }
      if (mode === "prediction") {
        raw = {
          ...raw,
          inference: [
            {
              id: "inf1",
              text: "SPY will rally over the next five sessions.",
              citationIds: [returnCitation],
            },
          ],
        };
      }

      const result = resolveFakeOutput(packet, raw);
      return result.ok ? { ...result, model } : { ...result, model };
    },
  };
}

/** Fake narrator that fails the first N calls with provider_parse, then succeeds. */
export function createRetryFakeStudyMemoNarrator(
  failCount: number,
  model = "fake-model",
): StudyMemoNarrator {
  let calls = 0;
  const inner = createFakeStudyMemoNarrator("ok", model);
  return {
    providerId: "fake",
    async narrate(packet) {
      calls++;
      if (calls <= failCount) {
        return {
          ok: false,
          provider: "fake",
          model,
          error: "Model output is not JSON",
          attempts: 1,
          failureCategory: "provider_parse",
        };
      }
      const result = await inner.narrate(packet);
      return { ...result, attempts: failCount + 1 };
    },
  };
}
