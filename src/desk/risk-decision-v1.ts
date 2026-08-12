import type { DominantDriver } from "@/contracts";
import type { EventGateSnapshot } from "@/contracts/event-gate";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveCurrentMarketSessionDate } from "@/ai-study/session";
import { writeJsonAtomic } from "./atomic-write";
import type {
  CtaProxySummary,
  VolMispricingSummary,
} from "./format-gamma";

export const RISK_DECISION_V1_VERSION = "0.1.0";

export type RiskDecisionStance = "buy" | "hold" | "reduce";
export type RiskDecisionConfidence = "high" | "moderate" | "limited";

export interface RiskDecisionV1Allocation {
  readonly highBeta: number;
  readonly defense: number;
  readonly metals: number;
  readonly hedge: number;
}

export interface RiskDecisionV1Coverage {
  readonly effectiveWeight: number;
  readonly factorsUsed: readonly string[];
  readonly confidence: RiskDecisionConfidence;
}

export interface RiskFactorContributionSnapshot {
  readonly id: string;
  readonly score: number;
  readonly effectiveWeight: number;
}

export interface RiskDecisionV1Result {
  readonly status: "ready" | "withheld";
  readonly riskScore: number | null;
  readonly stance: RiskDecisionStance | null;
  readonly exposure: { readonly min: number; readonly max: number } | null;
  readonly allocation: RiskDecisionV1Allocation | null;
  readonly opportunityScore: number | null;
  readonly evidence: readonly string[];
  readonly coverage: RiskDecisionV1Coverage | null;
  readonly withheldReason: string | null;
  /** Human-readable factors not contributing to the score when status is withheld. */
  readonly withheldFactors: readonly string[];
  readonly factorContributions: readonly RiskFactorContributionSnapshot[];
}

export interface RiskDecisionV1DailyRecord {
  readonly schemaVersion: typeof RISK_DECISION_V1_VERSION;
  /** ET calendar date when this Command Center risk record was published. */
  readonly publicationDate?: string;
  /** Market session the decision inputs were aligned to. */
  readonly marketSessionDate: string;
  readonly generatedAt: string;
  readonly riskScore: number;
  readonly factorContributions: readonly RiskFactorContributionSnapshot[];
}

export interface RiskDecisionDayOverDay {
  readonly riskChange: number | null;
  readonly riskChangeReason: string | null;
}

interface RiskFactorContribution {
  readonly id: string;
  readonly label: string;
  readonly baseWeight: number;
  readonly effectiveWeight: number;
  readonly score: number;
  readonly detail: string;
}

const MIN_EFFECTIVE_WEIGHT = 45;

const STALE_WEIGHT_MULTIPLIER = 0.5;
const PARTIAL_WEIGHT_MULTIPLIER = 0.75;

const BREADTH_WEIGHT = 25;
const MACRO_WEIGHT = 25;
const CTA_WEIGHT = 15;
const VOL_WEIGHT = 15;
const GAMMA_WEIGHT = 15;
const EVENT_GATE_WEIGHT = 10;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundRisk(value: number): number {
  return Math.round(clamp(value, 0, 100));
}

function confidenceFromWeight(weight: number): RiskDecisionConfidence {
  if (weight >= 75) return "high";
  if (weight >= 55) return "moderate";
  return "limited";
}

function macroFactorScore(driver: DominantDriver): number | null {
  if (driver.riskDirection === null) return null;
  switch (driver.riskDirection) {
    case "risk_on":
      return 25;
    case "mixed":
      return 55;
    case "risk_off":
      return 80;
  }
}

function macroFactorLabel(driver: DominantDriver): string {
  switch (driver.riskDirection) {
    case "risk_on":
      return "Macro driver risk-on";
    case "mixed":
      return "Macro driver mixed";
    case "risk_off":
      return "Macro driver risk-off";
    default:
      return "Macro driver";
  }
}

function macroUnavailable(driver: DominantDriver | null): boolean {
  if (!driver) return true;
  const fallback = driver.primaryRegime;
  return (
    driver.riskDirection === null ||
    fallback === "insufficient_data" ||
    fallback === "mixed_unresolved" ||
    fallback === "single_asset_shock"
  );
}

function macroStale(driver: DominantDriver, targetSession: string): boolean {
  return (
    driver.marketSessionDate !== targetSession ||
    driver.sessionAlignment !== "aligned"
  );
}

function breadthFactorScore(
  signal: RiskDecisionSpyBreadthInput["breadthSignal"],
): number | null {
  if (signal === null) return null;
  switch (signal) {
    case "strong":
      return 25;
    case "mixed":
      return 50;
    case "weak":
      return 80;
  }
}

function ctaFactorScore(signal: CtaProxySummary["signal"]): number | null {
  if (signal === null) return null;
  switch (signal) {
    case "buying":
      return 25;
    case "neutral":
      return 50;
    case "selling":
      return 75;
  }
}

function volFactorScore(signal: VolMispricingSummary["signal"]): number | null {
  if (signal === null) return null;
  switch (signal) {
    case "vol_underpriced":
      return 30;
    case "balanced":
      return 50;
    case "vol_expensive":
      return 75;
  }
}

function gammaFactorScore(
  regime: RiskDecisionSpyGammaInput["regime"],
): number | null {
  if (regime === null) return null;
  switch (regime) {
    case "positive":
      return 25;
    case "near_zero":
      return 50;
    case "negative":
      return 75;
    case "unavailable":
      return null;
    default:
      return null;
  }
}

function eventGateFactorScore(state: EventGateSnapshot["state"]): number | null {
  switch (state) {
    case "clear":
      return 15;
    case "scheduled_risk":
      return 60;
    case "active_shock":
      return 90;
    case "unavailable":
      return null;
  }
}

function gammaWeightMultiplier(gamma: RiskDecisionSpyGammaInput): number {
  if (gamma.freshness === "stale") return STALE_WEIGHT_MULTIPLIER;
  if (gamma.status === "incomplete" || gamma.freshness === "incomplete") {
    return PARTIAL_WEIGHT_MULTIPLIER;
  }
  return 1;
}

function exposureBand(riskScore: number): { min: number; max: number } {
  const center = roundRisk(145 - riskScore * 1.25);
  const min = clamp(center - 8, 0, 150);
  const max = clamp(center + 8, 0, 150);
  return { min, max };
}

function allocationFromRisk(riskScore: number): RiskDecisionV1Allocation {
  const highBeta = roundRisk(50 - riskScore * 0.35);
  const defense = roundRisk(25 + riskScore * 0.1);
  const metals = roundRisk(15 + riskScore * 0.1);
  const hedge = 100 - highBeta - defense - metals;
  return { highBeta, defense, metals, hedge };
}

function stanceFromRisk(riskScore: number): RiskDecisionStance {
  if (riskScore <= 40) return "buy";
  if (riskScore <= 65) return "hold";
  return "reduce";
}

function aggregateRiskScore(factors: readonly RiskFactorContribution[]): number {
  const totalWeight = factors.reduce((sum, row) => sum + row.effectiveWeight, 0);
  if (totalWeight <= 0) return 0;
  const weighted = factors.reduce(
    (sum, row) => sum + row.effectiveWeight * row.score,
    0,
  );
  return roundRisk(weighted / totalWeight);
}

function buildEvidence(
  riskScore: number,
  coverage: RiskDecisionV1Coverage,
  factors: readonly RiskFactorContribution[],
): readonly string[] {
  const lines: string[] = [
    `Structural risk ${riskScore}/100 · ${coverage.confidence} input coverage (${coverage.effectiveWeight}% of model weight used).`,
  ];

  const sorted = [...factors].sort((left, right) => right.score - left.score);
  for (const factor of sorted.slice(0, 4)) {
    lines.push(`${factor.label}: ${factor.detail} (risk contribution ${factor.score}).`);
  }

  return lines;
}

function snapshotContributions(
  factors: readonly RiskFactorContribution[],
): readonly RiskFactorContributionSnapshot[] {
  return factors.map((row) => ({
    id: row.id,
    score: row.score,
    effectiveWeight: row.effectiveWeight,
  }));
}

const FACTOR_CHANGE_LABELS: Record<
  string,
  { readonly short: string; readonly eased: string; readonly rose: string }
> = {
  breadth: {
    short: "breadth",
    eased: "breadth improved",
    rose: "breadth weakened",
  },
  macro: {
    short: "macro",
    eased: "macro eased",
    rose: "macro added risk",
  },
  cta: {
    short: "CTA",
    eased: "CTA strengthened",
    rose: "CTA weakened",
  },
  vol: {
    short: "vol mispricing",
    eased: "vol mispricing eased",
    rose: "vol mispricing worsened",
  },
  gamma: {
    short: "dealer flow",
    eased: "dealer flow eased",
    rose: "dealer flow amplified",
  },
  event_gate: {
    short: "event gate",
    eased: "event gate eased",
    rose: "event gate tightened",
  },
};

function factorWeightedContribution(
  row: RiskFactorContributionSnapshot,
): number {
  return row.score * row.effectiveWeight;
}

function factorContributionDeltas(
  today: readonly RiskFactorContributionSnapshot[],
  previous: readonly RiskFactorContributionSnapshot[],
): { readonly id: string; readonly delta: number; readonly weight: number }[] {
  const previousById = new Map(previous.map((row) => [row.id, row]));
  const todayById = new Map(today.map((row) => [row.id, row]));
  const ids = new Set([
    ...today.map((row) => row.id),
    ...previous.map((row) => row.id),
  ]);
  const deltas: { id: string; delta: number; weight: number }[] = [];

  for (const id of ids) {
    const todayRow = todayById.get(id);
    const prior = previousById.get(id);
    const todayWeighted = todayRow ? factorWeightedContribution(todayRow) : 0;
    const priorWeighted = prior ? factorWeightedContribution(prior) : 0;
    const delta = todayWeighted - priorWeighted;
    if (delta === 0) continue;
    deltas.push({
      id,
      delta,
      weight: Math.abs(delta),
    });
  }

  return deltas.sort((left, right) => right.weight - left.weight);
}

export function buildRiskChangeReason(
  riskChange: number,
  today: readonly RiskFactorContributionSnapshot[],
  previous: readonly RiskFactorContributionSnapshot[],
): string | null {
  const deltas = factorContributionDeltas(today, previous);
  if (deltas.length === 0) return null;

  const parts = deltas.slice(0, 2).map((row) => {
    const labels = FACTOR_CHANGE_LABELS[row.id];
    if (!labels) return row.id;
    return row.delta < 0 ? labels.eased : labels.rose;
  });

  const head =
    riskChange < 0
      ? "Risk eased"
      : riskChange > 0
        ? "Risk rose"
        : "Risk unchanged";

  return `${head}: ${parts.join(" · ")}`;
}

export function resolveRiskPublicationDate(now = new Date()): string {
  return resolveCurrentMarketSessionDate(now);
}

export function riskDecisionPublicationDate(
  record: RiskDecisionV1DailyRecord,
): string {
  return record.publicationDate ?? record.marketSessionDate;
}

function isValidRiskPublicationDate(publicationDate: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(publicationDate);
}

export function riskDecisionV1DailyPath(
  dataRoot: string,
  publicationDate: string,
): string {
  return join(dataRoot, "risk-decision-v1", `${publicationDate}.json`);
}

export function riskDecisionV1LatestPath(dataRoot: string): string {
  return join(dataRoot, "risk-decision-v1", "latest.json");
}

export function loadRiskDecisionV1Daily(
  dataRoot: string,
  publicationDate: string,
): RiskDecisionV1DailyRecord | null {
  const path = riskDecisionV1DailyPath(dataRoot, publicationDate);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as RiskDecisionV1DailyRecord;
    const recordPublicationDate = raw.publicationDate ?? raw.marketSessionDate;
    if (
      recordPublicationDate !== publicationDate ||
      typeof raw.riskScore !== "number" ||
      !Array.isArray(raw.factorContributions)
    ) {
      return null;
    }
    return {
      ...raw,
      publicationDate: recordPublicationDate,
    };
  } catch {
    return null;
  }
}

export function listRiskDecisionV1DailyRecords(
  dataRoot: string,
): readonly RiskDecisionV1DailyRecord[] {
  const dir = join(dataRoot, "risk-decision-v1");
  if (!existsSync(dir)) return [];

  const records: RiskDecisionV1DailyRecord[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json") || name === "latest.json") continue;
    const publicationDate = name.slice(0, -5);
    const record = loadRiskDecisionV1Daily(dataRoot, publicationDate);
    if (record) records.push(record);
  }

  return records.sort((left, right) =>
    riskDecisionPublicationDate(left).localeCompare(
      riskDecisionPublicationDate(right),
    ),
  );
}

export function loadPriorPublishedRiskDecision(
  dataRoot: string,
  publicationDate: string,
): RiskDecisionV1DailyRecord | null {
  const prior = listRiskDecisionV1DailyRecords(dataRoot).filter(
    (record) => riskDecisionPublicationDate(record) < publicationDate,
  );
  return prior.at(-1) ?? null;
}

export function persistRiskDecisionV1Daily(
  dataRoot: string,
  record: RiskDecisionV1DailyRecord,
): boolean {
  const publicationDate = riskDecisionPublicationDate(record);
  if (!isValidRiskPublicationDate(publicationDate)) return false;

  const path = riskDecisionV1DailyPath(dataRoot, publicationDate);
  if (existsSync(path)) return false;

  const normalized: RiskDecisionV1DailyRecord = {
    ...record,
    publicationDate,
  };
  writeJsonAtomic(path, normalized);
  writeJsonAtomic(riskDecisionV1LatestPath(dataRoot), normalized);
  return true;
}

export function resolveRiskDecisionDayOverDay(input: {
  readonly dataRoot: string | null | undefined;
  readonly publicationDate: string;
  readonly decisionSessionDate: string;
  readonly today: RiskDecisionV1Result;
  readonly now?: Date;
}): RiskDecisionDayOverDay {
  if (
    input.today.status !== "ready" ||
    input.today.riskScore === null ||
    input.today.factorContributions.length === 0
  ) {
    return { riskChange: null, riskChangeReason: null };
  }

  const dataRoot = input.dataRoot;
  if (!dataRoot) {
    return { riskChange: null, riskChangeReason: null };
  }

  const previous = loadPriorPublishedRiskDecision(dataRoot, input.publicationDate);

  const generatedAt = input.now?.toISOString() ?? new Date().toISOString();
  persistRiskDecisionV1Daily(dataRoot, {
    schemaVersion: RISK_DECISION_V1_VERSION,
    publicationDate: input.publicationDate,
    marketSessionDate: input.decisionSessionDate,
    generatedAt,
    riskScore: input.today.riskScore,
    factorContributions: input.today.factorContributions,
  });

  if (!previous) {
    return { riskChange: null, riskChangeReason: null };
  }

  const riskChange = input.today.riskScore - previous.riskScore;
  const riskChangeReason = buildRiskChangeReason(
    riskChange,
    input.today.factorContributions,
    previous.factorContributions,
  );

  return { riskChange, riskChangeReason };
}

export interface RiskDecisionSpyBreadthInput {
  readonly breadthSignalStatus: "available" | "unavailable";
  readonly breadthSignal: "strong" | "mixed" | "weak" | null;
  readonly breadthContextLine: string | null;
  readonly stale: boolean;
}

export interface RiskDecisionSpyGammaInput {
  readonly status: "ready" | "unavailable" | "incomplete";
  readonly freshness: "fresh" | "stale" | "incomplete" | null;
  readonly regime: string | null;
  readonly dealerFlowRegime: string | null;
  readonly volMispricing: VolMispricingSummary;
}

export interface DeriveRiskDecisionV1Input {
  readonly driver: DominantDriver | null;
  readonly spyBreadth: RiskDecisionSpyBreadthInput;
  readonly spyGamma: RiskDecisionSpyGammaInput;
  readonly ctaProxy: CtaProxySummary;
  readonly eventGate: EventGateSnapshot | null;
  readonly targetSession: string;
}

function macroSkipReason(driver: DominantDriver | null): string {
  if (!driver) return "macro driver not loaded";
  if (driver.riskDirection === null) {
    return `${driver.primaryRegime} — no risk direction`;
  }
  if (
    driver.primaryRegime === "insufficient_data" ||
    driver.primaryRegime === "mixed_unresolved" ||
    driver.primaryRegime === "single_asset_shock"
  ) {
    return `${driver.primaryRegime} — not used for structural risk`;
  }
  return "macro driver unavailable";
}

function auditWithheldFactors(
  input: DeriveRiskDecisionV1Input,
  usedFactorIds: readonly string[],
  effectiveWeight: number,
): readonly string[] {
  const used = new Set(usedFactorIds);
  const lines: string[] = [];

  if (effectiveWeight < MIN_EFFECTIVE_WEIGHT) {
    lines.push(
      `Coverage ${effectiveWeight}% of 100 model weight (minimum 45% required).`,
    );
  }

  if (!used.has("breadth")) {
    if (input.spyBreadth.breadthSignalStatus !== "available") {
      lines.push(
        `SPY breadth unavailable${input.spyBreadth.stale ? " (stale)" : ""}.`,
      );
    }
  }

  if (!used.has("macro")) {
    lines.push(`Macro driver: ${macroSkipReason(input.driver)}.`);
  }

  if (!used.has("cta")) {
    lines.push(
      input.ctaProxy.status === "available"
        ? "CTA proxy signal unavailable."
        : "CTA proxy unavailable (needs aligned SPY/QQQ quotes and bars).",
    );
  }

  if (!used.has("vol")) {
    const vol = input.spyGamma.volMispricing;
    lines.push(
      vol.status === "available"
        ? "Vol mispricing signal unavailable."
        : "Vol mispricing unavailable (needs SPY representative IV and HV20 bars).",
    );
  }

  if (!used.has("gamma")) {
    if (
      input.spyGamma.status === "unavailable" ||
      input.spyGamma.regime === null
    ) {
      lines.push("SPY dealer flow unavailable (no bounded gamma snapshot).");
    } else {
      lines.push("SPY dealer flow unavailable.");
    }
  }

  if (!used.has("event_gate")) {
    if (!input.eventGate) {
      lines.push("Event gate not loaded.");
    } else if (input.eventGate.status === "unavailable") {
      lines.push(
        `Event gate unavailable${input.eventGate.missingReason ? `: ${input.eventGate.missingReason}` : ""}.`,
      );
    } else {
      lines.push("Event gate not contributing.");
    }
  }

  return lines;
}

export function deriveRiskDecisionV1(
  input: DeriveRiskDecisionV1Input,
): RiskDecisionV1Result {
  const factors: RiskFactorContribution[] = [];

  if (input.spyBreadth.breadthSignalStatus === "available") {
    const score = breadthFactorScore(input.spyBreadth.breadthSignal);
    if (score !== null) {
      const multiplier = input.spyBreadth.stale ? STALE_WEIGHT_MULTIPLIER : 1;
      const effectiveWeight = BREADTH_WEIGHT * multiplier;
      factors.push({
        id: "breadth",
        label: "SPY breadth",
        baseWeight: BREADTH_WEIGHT,
        effectiveWeight,
        score,
        detail: `${input.spyBreadth.breadthContextLine ?? "SPY holdings breadth"}${input.spyBreadth.stale ? " · dated" : ""}`,
      });
    }
  }

  if (!macroUnavailable(input.driver)) {
    const driver = input.driver!;
    const score = macroFactorScore(driver);
    if (score !== null) {
      const multiplier = macroStale(driver, input.targetSession)
        ? STALE_WEIGHT_MULTIPLIER
        : 1;
      factors.push({
        id: "macro",
        label: "Macro driver",
        baseWeight: MACRO_WEIGHT,
        effectiveWeight: MACRO_WEIGHT * multiplier,
        score,
        detail: `${macroFactorLabel(driver)} · ${driver.label}${multiplier < 1 ? " · dated" : ""}`,
      });
    }
  }

  if (input.ctaProxy.status === "available" && input.ctaProxy.signal !== null) {
    const score = ctaFactorScore(input.ctaProxy.signal);
    if (score !== null) {
      factors.push({
        id: "cta",
        label: "CTA proxy",
        baseWeight: CTA_WEIGHT,
        effectiveWeight: CTA_WEIGHT,
        score,
        detail: input.ctaProxy.contextLine ?? `CTA proxy ${input.ctaProxy.signal}`,
      });
    }
  }

  const vol = input.spyGamma.volMispricing;
  if (vol.status === "available" && vol.signal !== null) {
    const score = volFactorScore(vol.signal);
    if (score !== null) {
      const multiplier =
        input.spyGamma.freshness === "stale" ? STALE_WEIGHT_MULTIPLIER : 1;
      factors.push({
        id: "vol",
        label: "Vol mispricing",
        baseWeight: VOL_WEIGHT,
        effectiveWeight: VOL_WEIGHT * multiplier,
        score,
        detail: `${volMispricingSignalLabel(vol.signal)} · spread ${vol.spreadVolPts ?? "—"} vol${multiplier < 1 ? " · dated IV" : ""}`,
      });
    }
  }

  if (
    input.spyGamma.regime !== null &&
    (input.spyGamma.status === "ready" || input.spyGamma.status === "incomplete")
  ) {
    const score = gammaFactorScore(input.spyGamma.regime);
    if (score !== null) {
      const multiplier = gammaWeightMultiplier(input.spyGamma);
      factors.push({
        id: "gamma",
        label: "Dealer flow",
        baseWeight: GAMMA_WEIGHT,
        effectiveWeight: GAMMA_WEIGHT * multiplier,
        score,
        detail: `${input.spyGamma.dealerFlowRegime ?? input.spyGamma.regime}${multiplier < 1 ? " · dated options" : ""}`,
      });
    }
  }

  if (input.eventGate && input.eventGate.status !== "unavailable") {
    const score = eventGateFactorScore(input.eventGate.state);
    if (score !== null) {
      const multiplier = input.eventGate.stale ? STALE_WEIGHT_MULTIPLIER : 1;
      const eventLabel =
        input.eventGate.activeEvents[0]?.headline ??
        (input.eventGate.state === "clear"
          ? "No active shock window"
          : input.eventGate.state);
      factors.push({
        id: "event_gate",
        label: "Event gate",
        baseWeight: EVENT_GATE_WEIGHT,
        effectiveWeight: EVENT_GATE_WEIGHT * multiplier,
        score,
        detail: `${eventLabel}${multiplier < 1 ? " · dated calendar" : ""}`,
      });
    }
  }

  const effectiveWeight = roundRisk(
    factors.reduce((sum, row) => sum + row.effectiveWeight, 0),
  );

  if (effectiveWeight < MIN_EFFECTIVE_WEIGHT) {
    const usedIds = factors.map((row) => row.id);
    return {
      status: "withheld",
      riskScore: null,
      stance: null,
      exposure: null,
      allocation: null,
      opportunityScore: null,
      evidence: [],
      coverage: null,
      withheldReason:
        "Structural risk withheld — fewer than 45% of model weight has defensible live inputs.",
      withheldFactors: auditWithheldFactors(input, usedIds, effectiveWeight),
      factorContributions: [],
    };
  }

  const riskScore = aggregateRiskScore(factors);
  const factorContributions = snapshotContributions(factors);
  const coverage: RiskDecisionV1Coverage = {
    effectiveWeight,
    factorsUsed: factors.map((row) => row.id),
    confidence: confidenceFromWeight(effectiveWeight),
  };

  return {
    status: "ready",
    riskScore,
    stance: stanceFromRisk(riskScore),
    exposure: exposureBand(riskScore),
    allocation: allocationFromRisk(riskScore),
    opportunityScore: roundRisk(100 - riskScore),
    evidence: buildEvidence(riskScore, coverage, factors),
    coverage,
    withheldReason: null,
    withheldFactors: [],
    factorContributions,
  };
}

function volMispricingSignalLabel(
  signal: VolMispricingSummary["signal"],
): string {
  switch (signal) {
    case "vol_expensive":
      return "Vol expensive";
    case "balanced":
      return "Balanced vol";
    case "vol_underpriced":
      return "Vol underpriced";
    default:
      return "Vol mispricing";
  }
}
