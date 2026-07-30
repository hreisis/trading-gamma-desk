import type { Evidence, Interpretation } from "@/contracts";
import { extractNumerals } from "./format";

export class InterpretationGuardrailError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "InterpretationGuardrailError";
    this.code = code;
  }
}

/**
 * Polarity is a signature-axis sign (tightening / inflation up / growth up),
 * not an equity recommendation. These phrases are banned in every generator.
 */
const EQUITY_CLAIM =
  /\b(bullish|bearish|buy|sell|long\s+equit|short\s+equit|stocks?\s+(should|will|rally|rise|fall|selloff)|equit(?:y|ies)\s+(rally|bull|bear|bid|offer)|good\s+for\s+(stocks?|equit)|bad\s+for\s+(stocks?|equit))\b/i;

/** Band labels are illegal while confidence is uncalibrated. */
const BAND_LABEL =
  /\b(high|medium|low)\s+confidence\b|\bconfidence\s+(is\s+)?(high|medium|low)\b|\b(high|medium|low)\s+conviction\b/i;

const FLOW_CLAIM =
  /\b(inflows?|outflows?|资金流入|资金流出|reported\s+flow)\b/i;

function allowedNumerals(
  evidence: readonly Evidence[],
  evidenceIds: readonly string[],
  confidenceScore: number,
): Set<string> {
  const cited = new Set(evidenceIds);
  const allowed = new Set<string>();
  allowed.add(String(confidenceScore));
  // "100" appears in the uncalibrated score line "68/100".
  allowed.add("100");
  for (const item of evidence) {
    if (!cited.has(item.id)) continue;
    for (const token of extractNumerals(item.statement)) {
      allowed.add(token);
    }
    allowed.add(String(item.value));
    if (item.unit === "bps") {
      allowed.add(String(Math.round(item.value)));
      allowed.add(String(Math.abs(Math.round(item.value))));
    }
    if (item.unit === "pct") {
      const rounded = (Math.round(item.value * 100) / 100).toFixed(2);
      allowed.add(rounded);
      allowed.add(String(Math.abs(Number(rounded))));
    }
    if (item.zScore !== null) {
      allowed.add(item.zScore.toFixed(2));
      allowed.add(String(item.zScore));
      allowed.add(Math.abs(item.zScore).toFixed(2));
    }
  }
  return allowed;
}

function numeralAllowed(token: string, allowed: Set<string>): boolean {
  if (allowed.has(token)) return true;
  const asNumber = Number(token);
  if (!Number.isFinite(asNumber)) return false;
  for (const candidate of allowed) {
    const n = Number(candidate);
    if (!Number.isFinite(n)) continue;
    if (Math.abs(n - asNumber) < 1e-9) return true;
    // Tolerate statement rounding: 1.234 vs 1.23
    if (Math.abs(n - asNumber) < 0.005 + 1e-9) return true;
  }
  return false;
}

/**
 * Enforce contract rules on generated prose. The interpretation layer may only
 * phrase around evidence already on the snapshot — never invent numbers, never
 * translate polarity into an equity call, never show band labels while
 * uncalibrated.
 */
export function assertInterpretationSafe(
  interpretation: Interpretation,
  evidence: readonly Evidence[],
  options: {
    readonly confidenceScore: number;
    readonly calibrated: boolean;
  },
): void {
  const ids = new Set(evidence.map((e) => e.id));
  if (interpretation.evidenceIds.length === 0) {
    throw new InterpretationGuardrailError(
      "empty_evidence_ids",
      "interpretation.evidenceIds must be non-empty",
    );
  }
  for (const id of interpretation.evidenceIds) {
    if (!ids.has(id)) {
      throw new InterpretationGuardrailError(
        "unknown_evidence_id",
        `interpretation cites unknown evidence id ${id}`,
      );
    }
  }

  if (EQUITY_CLAIM.test(interpretation.text)) {
    throw new InterpretationGuardrailError(
      "equity_claim",
      "interpretation must not translate polarity into an equity recommendation",
    );
  }

  if (FLOW_CLAIM.test(interpretation.text)) {
    throw new InterpretationGuardrailError(
      "flow_claim",
      "interpretation must not assert reported flow without a flow source",
    );
  }

  if (!options.calibrated && BAND_LABEL.test(interpretation.text)) {
    throw new InterpretationGuardrailError(
      "band_label",
      "uncalibrated confidence must not be described with high/medium/low labels",
    );
  }

  const allowed = allowedNumerals(
    evidence,
    interpretation.evidenceIds,
    options.confidenceScore,
  );
  for (const token of extractNumerals(interpretation.text)) {
    if (!numeralAllowed(token, allowed)) {
      throw new InterpretationGuardrailError(
        "invented_number",
        `interpretation cites numeral ${token} that is not in referenced evidence`,
      );
    }
  }
}
