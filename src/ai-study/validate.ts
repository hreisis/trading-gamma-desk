import type {
  AiStudyClaim,
  AiStudyInputProvenance,
  AiStudyNarratorRawOutput,
  AiStudyReport,
  AiStudySessionAlignment,
} from "@/contracts/ai-study-briefing";
import type { AiStudyEvidenceEntry } from "./evidence-corpus";
import { evidenceCorpusText, validEvidenceIdSet } from "./evidence-corpus";

const PROHIBITED =
  /\b(buy|sell|long|short|overweight|underweight|take profit|stop.?loss)\b/i;
const PREDICTION =
  /\b(will rally|will fall|will rise|will drop|predict|forecast|expect returns|trade signal|go long|go short)\b/i;
const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/g;

function maskIsoDateNumerics(text: string): string {
  return text.replace(ISO_DATE, (date) => date.replace(/\d/g, "D"));
}

function extractNumericTokens(text: string): string[] {
  const out: string[] = [];
  const masked = maskIsoDateNumerics(text);
  const re =
    /\$?-?\d{1,3}(?:,\d{3})*(?:\.\d+)?%?|\d+(?:\.\d+)?(?:\s*[-–to]+\s*\d+(?:\.\d+)?)?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) !== null) {
    const token = m[0]!.trim();
    if (token) out.push(token);
  }
  return out;
}

function normalizeNumToken(token: string): string {
  return token
    .toLowerCase()
    .replace(/,/g, "")
    .replace(/\$/g, "")
    .replace(/%/g, "")
    .replace(/\s+/g, "")
    .replace(/–/g, "-");
}

function isSupportedConfidenceToken(
  token: string,
  citedEvidence: readonly AiStudyEvidenceEntry[],
): boolean {
  const normalized = normalizeNumToken(token);
  const scoreMatch = /^(\d+)\/100$/.exec(normalized);
  if (scoreMatch) {
    const score = scoreMatch[1]!;
    return citedEvidence.some(
      (entry) =>
        (entry.id === "macro.confidenceScore" ||
          entry.id === "macro.confidenceDisplay") &&
        entry.value === score,
    );
  }
  if (normalized === "100") {
    return citedEvidence.some((entry) => entry.id === "macro.confidenceScore");
  }
  return false;
}

function numbersSupportedForClaim(
  text: string,
  citedEvidence: readonly AiStudyEvidenceEntry[],
): { ok: boolean; bad?: string } {
  if (!citedEvidence.length) return { ok: true };
  const corpus = evidenceCorpusText(citedEvidence);
  for (const token of extractNumericTokens(text)) {
    const n = normalizeNumToken(token);
    if (!n) continue;
    if (/^\d{4}$/.test(n)) continue;
    if (isSupportedConfidenceToken(token, citedEvidence)) continue;
    if (corpus.includes(token.replace(/,/g, ""))) continue;
    const corpusNorm = normalizeNumToken(corpus);
    if (corpusNorm.includes(n)) continue;
    const asNumber = Number(n);
    if (Number.isFinite(asNumber)) {
      const corpusNumbers = [...corpusNorm.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) =>
        Number(m[0]),
      );
      if (
        corpusNumbers.some(
          (value) => Number.isFinite(value) && Math.abs(value - asNumber) <= 0.15,
        )
      ) {
        continue;
      }
    }
    return { ok: false, bad: token };
  }
  return { ok: true };
}

function isExplicitConditionalScenario(label: string, text: string): boolean {
  if (!label.startsWith("scenarios.")) return false;
  const trimmed = text.trim();
  return (
    /^conditional\b/i.test(trimmed) ||
    /^status-quo\b/i.test(trimmed) ||
    /\bconditional path\b/i.test(trimmed)
  );
}

function hasProhibitedLanguage(label: string, text: string): boolean {
  if (PROHIBITED.test(text)) return true;
  if (isExplicitConditionalScenario(label, text)) return false;
  return PREDICTION.test(text);
}

function checkClaim(
  label: string,
  claim: AiStudyClaim,
  allowedIds: ReadonlySet<string>,
  evidence: readonly AiStudyEvidenceEntry[],
  errors: string[],
  flags: {
    citationsValid: boolean;
    numbersValid: boolean;
    prohibitedLanguageDetected: boolean;
  },
): void {
  if (!claim.evidenceIds.length) {
    errors.push(`${label}: missing evidenceIds`);
    flags.citationsValid = false;
  }
  for (const id of claim.evidenceIds) {
    if (!allowedIds.has(id)) {
      errors.push(`${label}: unknown evidenceId ${id}`);
      flags.citationsValid = false;
    }
  }
  const citedEvidence = evidence.filter((e) => claim.evidenceIds.includes(e.id));
  const num = numbersSupportedForClaim(claim.text, citedEvidence);
  if (!num.ok) {
    errors.push(`${label}: unsupported number/token ${num.bad}`);
    flags.numbersValid = false;
  }
  if (hasProhibitedLanguage(label, claim.text)) {
    errors.push(`${label}: prohibited inference language`);
    flags.prohibitedLanguageDetected = true;
  }
}

export function validateAiStudyReport(input: {
  readonly report: AiStudyNarratorRawOutput;
  readonly evidence: readonly AiStudyEvidenceEntry[];
}): {
  readonly ok: boolean;
  readonly grounding: {
    citationsValid: boolean;
    numbersValid: boolean;
    prohibitedLanguageDetected: boolean;
    errors: string[];
  };
} {
  const allowedIds = validEvidenceIdSet(input.evidence);
  const errors: string[] = [];
  const flags = {
    citationsValid: true,
    numbersValid: true,
    prohibitedLanguageDetected: false,
  };

  checkClaim("marketRegime", input.report.marketRegime, allowedIds, input.evidence, errors, flags);
  input.report.mainDrivers.forEach((claim, i) =>
    checkClaim(`mainDrivers[${i}]`, claim, allowedIds, input.evidence, errors, flags),
  );
  input.report.keyLevelsStructure.forEach((claim, i) =>
    checkClaim(`keyLevelsStructure[${i}]`, claim, allowedIds, input.evidence, errors, flags),
  );
  input.report.upcomingRisks.forEach((claim, i) =>
    checkClaim(`upcomingRisks[${i}]`, claim, allowedIds, input.evidence, errors, flags),
  );
  checkClaim("scenarios.bull", input.report.scenarios.bull, allowedIds, input.evidence, errors, flags);
  checkClaim("scenarios.base", input.report.scenarios.base, allowedIds, input.evidence, errors, flags);
  checkClaim("scenarios.bear", input.report.scenarios.bear, allowedIds, input.evidence, errors, flags);

  return {
    ok:
      flags.citationsValid &&
      flags.numbersValid &&
      !flags.prohibitedLanguageDetected,
    grounding: {
      citationsValid: flags.citationsValid,
      numbersValid: flags.numbersValid,
      prohibitedLanguageDetected: flags.prohibitedLanguageDetected,
      errors,
    },
  };
}

export function buildSessionAlignment(input: {
  readonly targetSessionDate: string | null;
  readonly inputs: readonly AiStudyInputProvenance[];
}): AiStudySessionAlignment {
  const conflicts: string[] = [];
  const target = input.targetSessionDate;

  const sources = input.inputs
    .filter((i) => i.id !== "market_temperature")
    .map((i) => ({
      id: i.id,
      sessionDate: i.sessionDate ?? null,
      fetchedAt: i.fetchedAt ?? null,
      freshness: i.freshness ?? "unavailable",
      provider: i.provider ?? i.sourceLabel,
    }));

  if (target) {
    for (const source of sources) {
      if (
        source.sessionDate &&
        source.sessionDate !== target &&
        source.freshness !== "live" &&
        source.freshness !== "fixture"
      ) {
        conflicts.push(
          `${source.id} sessionDate ${source.sessionDate} != target ${target}`,
        );
      }
    }
    const macro = sources.find((s) => s.id === "macro");
    const gamma = sources.find((s) => s.id === "gamma_structure");
    if (
      macro?.sessionDate &&
      gamma?.sessionDate &&
      macro.sessionDate !== gamma.sessionDate
    ) {
      conflicts.push(
        `macro ${macro.sessionDate} != gamma ${gamma.sessionDate}`,
      );
    }
    const historical = sources.find((s) => s.id === "historical_study");
    if (
      historical?.sessionDate &&
      historical.sessionDate !== target &&
      historical.freshness === "cached"
    ) {
      conflicts.push(
        `historical_study sessionDate ${historical.sessionDate} != target ${target}`,
      );
    }
  }

  return {
    targetSessionDate: target,
    aligned: conflicts.length === 0,
    conflicts,
    sources,
  };
}

export function flattenReportClaims(report: AiStudyReport): AiStudyClaim[] {
  return [
    report.marketRegime,
    ...report.mainDrivers,
    ...report.keyLevelsStructure,
    ...report.upcomingRisks,
    report.scenarios.bull,
    report.scenarios.base,
    report.scenarios.bear,
  ];
}
