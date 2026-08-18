import type { DominantDriver } from "@/contracts";
import type { EventGateSnapshot } from "@/contracts/event-gate";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveCurrentMarketSessionDate } from "@/ai-study/session";
import { writeJsonAtomic } from "./atomic-write";
import {
  artifactSourceLabel,
  readJson,
  writeJson,
  type RuntimeJsonStore,
} from "./runtime-store";
import type {
  CtaProxySummary,
  VolMispricingSummary,
} from "./format-gamma";
import type { V2SectorRotationSummary } from "./v2-command-center";
import {
  computeLeadershipConcentrationPenalty,
  formatLeadershipConcentrationEvidence,
} from "./risk-leadership-concentration";

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
  /** Weighted factor score before leadership concentration adjustment. */
  readonly baseRiskScore: number | null;
  readonly concentrationPenalty: number | null;
  readonly concentrationReason: string | null;
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
  /** Weighted factor score before leadership concentration (present on new publishes). */
  readonly baseRiskScore?: number;
  /** Leadership concentration add-on (present on new publishes). */
  readonly concentrationPenalty?: number;
  readonly factorContributions: readonly RiskFactorContributionSnapshot[];
}

/** Canonical Risk V1 factor ids in UI order (headline market risk). */
export const RISK_V1_FACTOR_IDS = [
  "breadth",
  "macro",
  "cta",
  "vol",
  "gamma",
  "event_gate",
] as const;

export type RiskV1FactorId = (typeof RISK_V1_FACTOR_IDS)[number];

export interface RiskSessionComparison {
  readonly todaySession: string;
  readonly previousSession: string | null;
  readonly todayRiskScore: number | null;
  readonly previousRiskScore: number | null;
  readonly todayBaseRiskScore: number | null;
  readonly previousBaseRiskScore: number | null;
  readonly todayConcentrationPenalty: number | null;
  readonly previousConcentrationPenalty: number | null;
  readonly factors: readonly {
    readonly id: RiskV1FactorId;
    readonly todayScore: number | null;
    readonly previousScore: number | null;
  }[];
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
/** Immutable daily publication requires moderate-or-better coverage (not limited). */
const MIN_PUBLISHABLE_EFFECTIVE_WEIGHT = 55;

/** Minimum effective weight to show a live structural risk score. */
export const RISK_DECISION_V1_MIN_EFFECTIVE_WEIGHT = MIN_EFFECTIVE_WEIGHT;
/** Minimum effective weight to publish an immutable daily record. */
export const RISK_DECISION_V1_MIN_PUBLISHABLE_WEIGHT = MIN_PUBLISHABLE_EFFECTIVE_WEIGHT;

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
  const score = aggregateRiskScoreFromContributions(
    factors.map((row) => ({
      id: row.id,
      score: row.score,
      effectiveWeight: row.effectiveWeight,
    })),
  );
  return score ?? 0;
}

/** Same weighted average as `aggregateRiskScore`, from stored factor snapshots. */
export function aggregateRiskScoreFromContributions(
  contributions: readonly RiskFactorContributionSnapshot[],
): number | null {
  const totalWeight = contributions.reduce(
    (sum, row) => sum + row.effectiveWeight,
    0,
  );
  if (totalWeight <= 0) return null;
  const weighted = contributions.reduce(
    (sum, row) => sum + row.effectiveWeight * row.score,
    0,
  );
  return roundRisk(weighted / totalWeight);
}

export function factorScoreFromContributions(
  contributions: readonly RiskFactorContributionSnapshot[],
  id: string,
): number | null {
  const row = contributions.find((factor) => factor.id === id);
  return row?.score ?? null;
}

export function buildRiskSessionComparison(input: {
  readonly decisionSessionDate: string;
  readonly today: RiskDecisionV1Result;
  readonly priorRecord: RiskDecisionV1DailyRecord | null;
}): RiskSessionComparison | null {
  if (input.today.status !== "ready") return null;

  const priorContributions =
    input.priorRecord?.factorContributions ?? [];
  const factors = RISK_V1_FACTOR_IDS.map((id) => ({
    id,
    todayScore: factorScoreFromContributions(
      input.today.factorContributions,
      id,
    ),
    previousScore: input.priorRecord
      ? factorScoreFromContributions(priorContributions, id)
      : null,
  }));

  return {
    todaySession: input.decisionSessionDate,
    previousSession: input.priorRecord?.marketSessionDate ?? null,
    todayRiskScore: input.today.riskScore,
    previousRiskScore: input.priorRecord?.riskScore ?? null,
    todayBaseRiskScore: input.today.baseRiskScore,
    previousBaseRiskScore: input.priorRecord?.baseRiskScore ?? null,
    todayConcentrationPenalty: input.today.concentrationPenalty,
    previousConcentrationPenalty: input.priorRecord?.concentrationPenalty ?? null,
    factors,
  };
}

function buildEvidenceWithConcentration(
  adjustedRiskScore: number,
  coverage: RiskDecisionV1Coverage,
  factors: readonly RiskFactorContribution[],
  concentrationPenalty: number,
  concentrationReason: string | null,
): readonly string[] {
  const lines: string[] = [
    `Structural risk ${adjustedRiskScore}/100 · ${coverage.confidence} input coverage (${coverage.effectiveWeight}% of model weight used).`,
  ];

  const concentrationLine = formatLeadershipConcentrationEvidence(
    concentrationPenalty,
    concentrationReason,
  );
  if (concentrationLine !== null) {
    lines.push(concentrationLine);
  }

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

export function riskDecisionV1DailyRelativePath(publicationDate: string): string {
  return `risk-decision-v1/${publicationDate}.json`;
}

export function effectiveWeightFromFactorContributions(
  contributions: readonly RiskFactorContributionSnapshot[],
): number {
  return contributions.reduce((sum, row) => sum + row.effectiveWeight, 0);
}

/** True when a stored daily record meets immutable publication coverage rules. */
export function isRiskDecisionV1DailyRecordPublishable(
  record: RiskDecisionV1DailyRecord,
): boolean {
  if (typeof record.riskScore !== "number" || !Number.isFinite(record.riskScore)) {
    return false;
  }
  if (!Array.isArray(record.factorContributions) || record.factorContributions.length === 0) {
    return false;
  }
  const effectiveWeight = roundRisk(
    effectiveWeightFromFactorContributions(record.factorContributions),
  );
  return (
    effectiveWeight >= MIN_EFFECTIVE_WEIGHT &&
    confidenceFromWeight(effectiveWeight) !== "limited"
  );
}

/** True when a live derivation is ready and has enough coverage to publish. */
export function isRiskDecisionV1Publishable(result: RiskDecisionV1Result): boolean {
  if (result.status !== "ready") return false;
  if (result.riskScore === null) return false;
  if (result.factorContributions.length === 0) return false;
  if (!result.coverage) return false;
  return (
    result.coverage.effectiveWeight >= MIN_EFFECTIVE_WEIGHT &&
    result.coverage.confidence !== "limited"
  );
}

function buildRiskDecisionV1DailyRecordFromResult(input: {
  readonly publicationDate: string;
  readonly decisionSessionDate: string;
  readonly today: RiskDecisionV1Result;
  readonly now?: Date;
}): RiskDecisionV1DailyRecord | null {
  if (!isRiskDecisionV1Publishable(input.today)) return null;
  const riskScore = input.today.riskScore;
  if (riskScore === null) return null;
  return {
    schemaVersion: RISK_DECISION_V1_VERSION,
    publicationDate: input.publicationDate,
    marketSessionDate: input.decisionSessionDate,
    generatedAt: input.now?.toISOString() ?? new Date().toISOString(),
    riskScore,
    ...(input.today.baseRiskScore !== null
      ? { baseRiskScore: input.today.baseRiskScore }
      : {}),
    ...(input.today.concentrationPenalty !== null
      ? { concentrationPenalty: input.today.concentrationPenalty }
      : {}),
    factorContributions: input.today.factorContributions,
  };
}

function parseRiskDecisionV1DailyRecord(
  raw: unknown,
  publicationDate: string,
): RiskDecisionV1DailyRecord | null {
  const record = raw as RiskDecisionV1DailyRecord;
  const recordPublicationDate = record.publicationDate ?? record.marketSessionDate;
  if (
    recordPublicationDate !== publicationDate ||
    typeof record.riskScore !== "number" ||
    !Array.isArray(record.factorContributions)
  ) {
    return null;
  }
  return {
    ...record,
    publicationDate: recordPublicationDate,
  };
}

export function loadRiskDecisionV1Daily(
  dataRoot: string,
  publicationDate: string,
): RiskDecisionV1DailyRecord | null {
  const path = riskDecisionV1DailyPath(dataRoot, publicationDate);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as RiskDecisionV1DailyRecord;
    return parseRiskDecisionV1DailyRecord(raw, publicationDate);
  } catch {
    return null;
  }
}

export async function loadRiskDecisionV1DailyAsync(
  artifactStore: RuntimeJsonStore,
  publicationDate: string,
): Promise<RiskDecisionV1DailyRecord | null> {
  const relativePath = riskDecisionV1DailyRelativePath(publicationDate);
  const raw = await readJson(artifactStore, relativePath);
  if (raw === null) return null;
  return parseRiskDecisionV1DailyRecord(raw, publicationDate);
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

export async function listRiskDecisionV1DailyRecordsAsync(
  artifactStore: RuntimeJsonStore,
): Promise<readonly RiskDecisionV1DailyRecord[]> {
  const paths = await artifactStore.list("risk-decision-v1");
  const records: RiskDecisionV1DailyRecord[] = [];
  for (const relativePath of paths) {
    if (!relativePath.endsWith(".json") || relativePath.endsWith("/latest.json")) {
      continue;
    }
    const publicationDate = relativePath.slice("risk-decision-v1/".length, -5);
    const record = await loadRiskDecisionV1DailyAsync(artifactStore, publicationDate);
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
    (record) =>
      riskDecisionPublicationDate(record) < publicationDate &&
      isRiskDecisionV1DailyRecordPublishable(record),
  );
  return prior.at(-1) ?? null;
}

/** Latest publishable record for a completed market session strictly before `decisionSessionDate`. */
export function loadPriorPublishedRiskDecisionForMarketSession(
  dataRoot: string,
  decisionSessionDate: string,
): RiskDecisionV1DailyRecord | null {
  const prior = listRiskDecisionV1DailyRecords(dataRoot).filter(
    (record) =>
      record.marketSessionDate < decisionSessionDate &&
      isRiskDecisionV1DailyRecordPublishable(record),
  );
  return prior
    .sort((left, right) =>
      left.marketSessionDate.localeCompare(right.marketSessionDate),
    )
    .at(-1) ?? null;
}

export function loadPublishedRiskDecisionForMarketSession(
  dataRoot: string,
  marketSessionDate: string,
): RiskDecisionV1DailyRecord | null {
  const matches = listRiskDecisionV1DailyRecords(dataRoot).filter(
    (record) =>
      record.marketSessionDate === marketSessionDate &&
      isRiskDecisionV1DailyRecordPublishable(record),
  );
  return matches
    .sort((left, right) =>
      riskDecisionPublicationDate(left).localeCompare(
        riskDecisionPublicationDate(right),
      ),
    )
    .at(-1) ?? null;
}

export async function loadPriorPublishedRiskDecisionAsync(
  artifactStore: RuntimeJsonStore,
  publicationDate: string,
): Promise<RiskDecisionV1DailyRecord | null> {
  const prior = (
    await listRiskDecisionV1DailyRecordsAsync(artifactStore)
  ).filter(
    (record) =>
      riskDecisionPublicationDate(record) < publicationDate &&
      isRiskDecisionV1DailyRecordPublishable(record),
  );
  return prior.at(-1) ?? null;
}

export async function loadPriorPublishedRiskDecisionForMarketSessionAsync(
  artifactStore: RuntimeJsonStore,
  decisionSessionDate: string,
): Promise<RiskDecisionV1DailyRecord | null> {
  const prior = (
    await listRiskDecisionV1DailyRecordsAsync(artifactStore)
  ).filter(
    (record) =>
      record.marketSessionDate < decisionSessionDate &&
      isRiskDecisionV1DailyRecordPublishable(record),
  );
  return prior
    .sort((left, right) =>
      left.marketSessionDate.localeCompare(right.marketSessionDate),
    )
    .at(-1) ?? null;
}

export async function loadPublishedRiskDecisionForMarketSessionAsync(
  artifactStore: RuntimeJsonStore,
  marketSessionDate: string,
): Promise<RiskDecisionV1DailyRecord | null> {
  const matches = (
    await listRiskDecisionV1DailyRecordsAsync(artifactStore)
  ).filter(
    (record) =>
      record.marketSessionDate === marketSessionDate &&
      isRiskDecisionV1DailyRecordPublishable(record),
  );
  return matches
    .sort((left, right) =>
      riskDecisionPublicationDate(left).localeCompare(
        riskDecisionPublicationDate(right),
      ),
    )
    .at(-1) ?? null;
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

/**
 * Publish an immutable daily Risk record when coverage rules pass.
 * Replaces a non-publishable partial record for the same publication date.
 * Never overwrites a valid published record.
 */
export function publishRiskDecisionV1Daily(
  dataRoot: string,
  record: RiskDecisionV1DailyRecord,
  options?: { readonly force?: boolean },
): boolean {
  const publicationDate = riskDecisionPublicationDate(record);
  if (!isValidRiskPublicationDate(publicationDate)) return false;
  if (!isRiskDecisionV1DailyRecordPublishable(record)) return false;

  const existing = loadRiskDecisionV1Daily(dataRoot, publicationDate);
  if (existing && isRiskDecisionV1DailyRecordPublishable(existing)) {
    if (options?.force !== true) return false;
  }

  const normalized: RiskDecisionV1DailyRecord = {
    ...record,
    publicationDate,
  };
  writeJsonAtomic(riskDecisionV1DailyPath(dataRoot, publicationDate), normalized);
  writeJsonAtomic(riskDecisionV1LatestPath(dataRoot), normalized);
  return true;
}

export async function persistRiskDecisionV1DailyAsync(
  artifactStore: RuntimeJsonStore,
  record: RiskDecisionV1DailyRecord,
): Promise<boolean> {
  const publicationDate = riskDecisionPublicationDate(record);
  if (!isValidRiskPublicationDate(publicationDate)) return false;

  const relativePath = riskDecisionV1DailyRelativePath(publicationDate);
  if (await artifactStore.exists(relativePath)) return false;

  const normalized: RiskDecisionV1DailyRecord = {
    ...record,
    publicationDate,
  };
  const wroteDaily = await writeJson(artifactStore, relativePath, normalized);
  if (!wroteDaily) return false;
  await writeJson(artifactStore, "risk-decision-v1/latest.json", normalized, {
    allowOverwrite: true,
  });
  return true;
}

/**
 * Publish an immutable daily Risk record to the artifact store when coverage rules pass.
 * Replaces a non-publishable partial record for the same publication date.
 * Never overwrites a valid published record.
 */
export async function publishRiskDecisionV1DailyAsync(
  artifactStore: RuntimeJsonStore,
  record: RiskDecisionV1DailyRecord,
  options?: { readonly force?: boolean },
): Promise<boolean> {
  const publicationDate = riskDecisionPublicationDate(record);
  if (!isValidRiskPublicationDate(publicationDate)) return false;
  if (!isRiskDecisionV1DailyRecordPublishable(record)) return false;

  const existing = await loadRiskDecisionV1DailyAsync(artifactStore, publicationDate);
  if (existing && isRiskDecisionV1DailyRecordPublishable(existing)) {
    if (options?.force !== true) return false;
  }

  const normalized: RiskDecisionV1DailyRecord = {
    ...record,
    publicationDate,
  };
  const relativePath = riskDecisionV1DailyRelativePath(publicationDate);
  const wroteDaily = await writeJson(artifactStore, relativePath, normalized, {
    allowOverwrite: true,
  });
  if (!wroteDaily) return false;
  await writeJson(artifactStore, "risk-decision-v1/latest.json", normalized, {
    allowOverwrite: true,
  });
  return true;
}

export function resolveRiskDecisionDayOverDay(input: {
  readonly dataRoot: string | null | undefined;
  readonly publicationDate: string;
  readonly decisionSessionDate: string;
  readonly today: RiskDecisionV1Result;
  readonly now?: Date;
  readonly force?: boolean;
}): RiskDecisionDayOverDay {
  const previous =
    input.dataRoot !== null && input.dataRoot !== undefined
      ? loadPriorPublishedRiskDecisionForMarketSession(
          input.dataRoot,
          input.decisionSessionDate,
        )
      : null;

  const record = buildRiskDecisionV1DailyRecordFromResult({
    publicationDate: input.publicationDate,
    decisionSessionDate: input.decisionSessionDate,
    today: input.today,
    now: input.now,
  });
  if (record && input.dataRoot) {
    publishRiskDecisionV1Daily(input.dataRoot, record, {
      force: input.force === true,
    });
  }

  if (
    input.today.status !== "ready" ||
    input.today.riskScore === null ||
    input.today.factorContributions.length === 0 ||
    !previous
  ) {
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

export async function resolveRiskDecisionDayOverDayAsync(input: {
  readonly artifactStore: RuntimeJsonStore;
  readonly dataRoot: string | null | undefined;
  readonly publicationDate: string;
  readonly decisionSessionDate: string;
  readonly today: RiskDecisionV1Result;
  readonly now?: Date;
  readonly force?: boolean;
}): Promise<RiskDecisionDayOverDay> {
  const previous = await loadPriorPublishedRiskDecisionForMarketSessionAsync(
    input.artifactStore,
    input.decisionSessionDate,
  );

  const record = buildRiskDecisionV1DailyRecordFromResult({
    publicationDate: input.publicationDate,
    decisionSessionDate: input.decisionSessionDate,
    today: input.today,
    now: input.now,
  });
  if (record) {
    await publishRiskDecisionV1DailyAsync(input.artifactStore, record, {
      force: input.force === true,
    });
    if (input.dataRoot) {
      publishRiskDecisionV1Daily(input.dataRoot, record, {
        force: input.force === true,
      });
    }
  }

  if (
    input.today.status !== "ready" ||
    input.today.riskScore === null ||
    input.today.factorContributions.length === 0 ||
    !previous
  ) {
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
  readonly advancingPct?: number | null;
  readonly percentAboveMA20?: number | null;
  readonly percentAboveMA50?: number | null;
  readonly new20DayClosingHigh?: number | null;
  readonly new20DayClosingLow?: number | null;
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
  readonly sectorRotation?: V2SectorRotationSummary | null;
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
      baseRiskScore: null,
      concentrationPenalty: null,
      concentrationReason: null,
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

  const baseRiskScore = aggregateRiskScore(factors);
  const concentration = computeLeadershipConcentrationPenalty({
    breadth: {
      breadthSignalStatus: input.spyBreadth.breadthSignalStatus,
      advancingPct: input.spyBreadth.advancingPct ?? null,
      percentAboveMA20: input.spyBreadth.percentAboveMA20 ?? null,
      percentAboveMA50: input.spyBreadth.percentAboveMA50 ?? null,
      new20DayClosingHigh: input.spyBreadth.new20DayClosingHigh ?? null,
      new20DayClosingLow: input.spyBreadth.new20DayClosingLow ?? null,
    },
    sectorRotation: input.sectorRotation,
  });
  const concentrationPenalty = concentration.penalty;
  const concentrationReason = concentration.reason;
  const riskScore = roundRisk(
    clamp(baseRiskScore + concentrationPenalty, 0, 100),
  );
  const factorContributions = snapshotContributions(factors);
  const coverage: RiskDecisionV1Coverage = {
    effectiveWeight,
    factorsUsed: factors.map((row) => row.id),
    confidence: confidenceFromWeight(effectiveWeight),
  };

  return {
    status: "ready",
    baseRiskScore,
    concentrationPenalty,
    concentrationReason,
    riskScore,
    stance: stanceFromRisk(riskScore),
    exposure: exposureBand(riskScore),
    allocation: allocationFromRisk(riskScore),
    opportunityScore: roundRisk(100 - riskScore),
    evidence: buildEvidenceWithConcentration(
      riskScore,
      coverage,
      factors,
      concentrationPenalty,
      concentrationReason,
    ),
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
