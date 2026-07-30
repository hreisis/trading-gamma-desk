import type {
  Evidence,
  Interpretation,
  Polarity,
  PrimaryRegime,
  RiskDirection,
} from "@/contracts";
import type { MacroSnapshot } from "@/ingest";
import { assertInterpretationSafe } from "./guardrails";

function polarityClause(
  regime: PrimaryRegime,
  polarity: Polarity | null,
): string {
  if (polarity === null) return "";

  // Polarity is the signature-axis sign. It is never an equity recommendation.
  switch (regime) {
    case "fed_rates":
      return polarity === "negative"
        ? "pricing easier policy rather than a growth impulse"
        : "pricing tighter policy rather than easier financial conditions";
    case "inflation":
      return polarity === "positive"
        ? "an inflation-impulse cross-asset pattern, not a call on equities"
        : "a disinflation-impulse cross-asset pattern, not a call on equities";
    case "growth":
      return polarity === "positive"
        ? "stronger growth pricing across cyclicals"
        : "weaker growth pricing across cyclicals";
    case "liquidity":
      return polarity === "positive"
        ? "tighter liquidity conditions in the cross-asset set"
        : "easier liquidity conditions in the cross-asset set";
    case "risk_sentiment":
      return polarity === "positive"
        ? "broad risk-on in the cross-asset set"
        : "broad risk-off in the cross-asset set";
    default:
      return "";
  }
}

function riskClause(risk: RiskDirection | null): string {
  if (risk === "risk_on") return "Risk assets lean with easier financial conditions.";
  if (risk === "risk_off") return "Risk assets lean defensive alongside the driver.";
  if (risk === "mixed") return "Risk direction is mixed across the book.";
  return "";
}

function joinSentences(parts: string[]): string {
  return parts
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => {
      const capped = p.charAt(0).toUpperCase() + p.slice(1);
      return capped.endsWith(".") ? capped : `${capped}.`;
    })
    .join(" ");
}

/**
 * Deterministic one-line (or short) narrative. Consumes only the snapshot's
 * classification + evidence already built from that snapshot. Does not score.
 */
export function renderTemplateInterpretation(
  snapshot: MacroSnapshot,
  evidence: readonly Evidence[],
): Interpretation {
  const { primaryRegime, polarity, riskDirection, label, confidence } =
    snapshot.classification;

  const confirming = evidence.filter((e) =>
    snapshot.classification.contributions.some(
      (c) => c.symbol === e.symbol && c.role === "confirming",
    ),
  );
  const contradicting = evidence.filter((e) =>
    snapshot.classification.contributions.some(
      (c) => c.symbol === e.symbol && c.role === "contradicting",
    ),
  );

  const leadConfirm = confirming.slice(0, 2).map((e) => e.statement);
  const leadContra = contradicting.slice(0, 1).map((e) => e.statement);

  let text: string;
  const cited = new Set<string>();

  if (primaryRegime === "insufficient_data") {
    text =
      "Insufficient core macro coverage to support a driver claim for this session.";
    for (const e of evidence.slice(0, 2)) cited.add(e.id);
  } else if (primaryRegime === "mixed_unresolved") {
    text =
      "Cross-asset templates are too close to separate; the session is mixed and unresolved.";
    for (const e of evidence.slice(0, 3)) cited.add(e.id);
  } else if (primaryRegime === "single_asset_shock") {
    text =
      "A single asset dominates the move with thin independent confirmation; treat as a single-asset shock rather than a regime.";
    for (const e of evidence.slice(0, 2)) cited.add(e.id);
  } else {
    const axis = polarityClause(primaryRegime, polarity);
    const opener =
      leadConfirm.length > 0
        ? leadConfirm.join("; ")
        : `${label} is the closest cross-asset match`;
    for (const e of confirming.slice(0, 2)) cited.add(e.id);

    const parts = [
      `${opener}, consistent with ${axis || label.toLowerCase()}`,
      riskClause(riskDirection),
    ];
    if (leadContra.length > 0) {
      parts.push(`${leadContra[0]}`);
      for (const e of contradicting.slice(0, 1)) cited.add(e.id);
    }

    // Numeric score only — never a high/medium/low band while uncalibrated.
    parts.push(
      `Signal confidence score: ${confidence.score}/100` +
        (confidence.calibrated ? "" : " (uncalibrated)"),
    );

    text = joinSentences(parts);
  }

  if (cited.size === 0 && evidence.length > 0) {
    cited.add(evidence[0]!.id);
  }

  const interpretation: Interpretation = {
    text,
    evidenceIds: [...cited],
    generator: "template",
  };

  assertInterpretationSafe(interpretation, evidence, {
    confidenceScore: confidence.score,
    calibrated: confidence.calibrated,
  });

  return interpretation;
}
