import type { AiStudyFacts } from "./collect-inputs";
import type { AiStudyInputProvenance } from "@/contracts/ai-study-briefing";

export interface AiStudyEvidenceEntry {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly source: AiStudyFacts[keyof AiStudyFacts] extends infer _T
    ? string
    : string;
}

function push(
  entries: AiStudyEvidenceEntry[],
  id: string,
  label: string,
  value: unknown,
  source: string,
): void {
  if (value === null || value === undefined) return;
  const text =
    typeof value === "string"
      ? value
      : typeof value === "number" || typeof value === "boolean"
        ? String(value)
        : JSON.stringify(value);
  if (!text.trim()) return;
  entries.push({ id, label, value: text, source });
}

export function buildAiStudyEvidenceCorpus(
  facts: AiStudyFacts,
  inputs: readonly AiStudyInputProvenance[] = [],
): readonly AiStudyEvidenceEntry[] {
  const entries: AiStudyEvidenceEntry[] = [];

  for (const inp of inputs) {
    push(
      entries,
      `input.${inp.id}.status`,
      `${inp.id} input status`,
      inp.status,
      inp.id,
    );
    push(
      entries,
      `input.${inp.id}.freshness`,
      `${inp.id} freshness`,
      inp.freshness ?? "unavailable",
      inp.id,
    );
    if (inp.note) {
      push(entries, `input.${inp.id}.note`, `${inp.id} note`, inp.note, inp.id);
    }
    if (inp.sessionDate) {
      push(
        entries,
        `input.${inp.id}.sessionDate`,
        `${inp.id} session date`,
        inp.sessionDate,
        inp.id,
      );
    }
  }

  if (facts.macro) {
    const m = facts.macro;
    push(entries, "macro.sessionDate", "Macro session date", m.sessionDate, "macro");
    push(entries, "macro.label", "Macro label", m.label, "macro");
    push(entries, "macro.primaryRegime", "Primary regime", m.primaryRegime, "macro");
    push(entries, "macro.riskDirection", "Risk direction", m.riskDirection, "macro");
    push(
      entries,
      "macro.confidenceScore",
      "Confidence score",
      m.confidenceScore,
      "macro",
    );
    push(
      entries,
      "macro.confidenceDisplay",
      "Confidence display",
      `${m.confidenceScore}/100`,
      "macro",
    );
    push(
      entries,
      "macro.interpretation",
      "Macro interpretation",
      m.interpretation,
      "macro",
    );
    const assets = m.assets as
      | readonly {
          symbol?: string;
          value?: number;
          unit?: string;
          zScore?: number | null;
          role?: string;
        }[]
      | undefined;
    for (const asset of assets ?? []) {
      const sym = asset.symbol ?? "unknown";
      push(
        entries,
        `macro.asset.${sym}.value`,
        `${sym} value`,
        asset.value,
        "macro",
      );
      push(
        entries,
        `macro.asset.${sym}.zScore`,
        `${sym} z-score`,
        asset.zScore,
        "macro",
      );
      push(
        entries,
        `macro.asset.${sym}.unit`,
        `${sym} unit`,
        asset.unit,
        "macro",
      );
    }
  }

  if (facts.gammaStructure) {
    const g = facts.gammaStructure;
    push(entries, "gamma.sessionDate", "Gamma session date", g.sessionDate, "gamma");
    push(entries, "gamma.spot", "SPY spot", g.spot, "gamma");
    push(entries, "gamma.gammaRegime", "Gamma regime", g.gammaRegime, "gamma");
    push(
      entries,
      "gamma.boundedCallWall",
      "Bounded call wall",
      g.boundedCallWall,
      "gamma",
    );
    push(
      entries,
      "gamma.boundedPutWall",
      "Bounded put wall",
      g.boundedPutWall,
      "gamma",
    );
    const v2 = g.structureV2 as Record<string, unknown> | null | undefined;
    if (v2) {
      push(entries, "gamma.structure.regime", "Structure regime", v2.regime, "gamma");
      push(entries, "gamma.structure.spot", "Structure spot", v2.spot, "gamma");
      push(entries, "gamma.structure.flip", "Gamma flip", v2.flip, "gamma");
    }
  }

  facts.marketQuotes.forEach((quote, index) => {
    const q = quote as Record<string, unknown>;
    const sym = String(q.symbol ?? index);
    push(
      entries,
      `quote.${sym}.latestPrice`,
      `${sym} latest price`,
      q.latestPrice,
      "market_quotes",
    );
    push(
      entries,
      `quote.${sym}.dailyChangePct`,
      `${sym} daily change %`,
      q.dailyChangePct,
      "market_quotes",
    );
    push(
      entries,
      `quote.${sym}.timestamp`,
      `${sym} quote timestamp`,
      q.timestamp,
      "market_quotes",
    );
  });

  facts.catalysts.forEach((cat, index) => {
    const c = cat as Record<string, unknown>;
    const id = String(c.id ?? index);
    push(
      entries,
      `catalyst.${id}.headline`,
      "Catalyst headline",
      c.headline,
      "catalysts",
    );
    push(
      entries,
      `catalyst.${id}.occurredAt`,
      "Catalyst occurredAt",
      c.occurredAt,
      "catalysts",
    );
  });

  if (facts.historicalStudy) {
    const h = facts.historicalStudy;
    push(
      entries,
      "historical.evidenceStatus",
      "Historical evidence status",
      h.evidenceStatus,
      "historical_study",
    );
    push(
      entries,
      "historical.primaryHorizon",
      "Historical primary horizon",
      h.primaryHorizon,
      "historical_study",
    );
    const matched = h.matchedStudyIds as unknown;
    if (Array.isArray(matched)) {
      push(
        entries,
        "historical.matchedStudyIds",
        "Matched study IDs",
        matched.join(", "),
        "historical_study",
      );
    }
  }

  return entries;
}

export function evidenceCorpusText(
  entries: readonly AiStudyEvidenceEntry[],
): string {
  return entries.map((e) => `${e.id}: ${e.value}`).join("\n");
}

export function validEvidenceIdSet(
  entries: readonly AiStudyEvidenceEntry[],
): ReadonlySet<string> {
  return new Set(entries.map((e) => e.id));
}
