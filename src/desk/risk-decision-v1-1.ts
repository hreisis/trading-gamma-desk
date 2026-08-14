import type { DominantDriver } from "@/contracts";
import type { EventGateSnapshot } from "@/contracts/event-gate";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeJsonAtomic } from "./atomic-write";
import type {
  V2GammaSummary,
  V2SectorRotationSummary,
  V2SpyBreadthSummary,
} from "./v2-command-center";
import {
  deriveRiskDecisionV1,
  type RiskDecisionSpyBreadthInput,
  type RiskDecisionSpyGammaInput,
  type RiskDecisionV1Result,
} from "./risk-decision-v1";
import type { CtaProxySummary } from "./format-gamma";

export const RISK_DECISION_V1_1_VERSION = "0.1.0";

export type RiskDivergenceTrend = "widening" | "narrowing" | "stable";

export interface RiskComponentDivergence {
  readonly gammaRegime: {
    readonly spy: string | null;
    readonly qqq: string | null;
    readonly label: string | null;
  };
  readonly ivHvSpread: {
    readonly spySpreadVolPts: number | null;
    readonly qqqSpreadVolPts: number | null;
    readonly spreadDivergencePts: number | null;
  };
  readonly breadth: {
    readonly spy: string | null;
    readonly qqq: string | null;
    readonly label: string | null;
  };
  readonly relativePerformance: {
    readonly qqqVsSpy1dPct: number | null;
    readonly qqqVsSpy5dPct: number | null;
  };
}

export interface RiskStructuralRiskView {
  readonly status: RiskDecisionV1Result["status"];
  readonly riskScore: number | null;
  readonly stance: RiskDecisionV1Result["stance"];
  readonly coverage: RiskDecisionV1Result["coverage"];
  readonly withheldReason: string | null;
}

export interface RiskDecisionV1_1Result {
  readonly marketRisk: RiskDecisionV1Result;
  readonly spyStructuralRisk: RiskStructuralRiskView;
  readonly qqqStructuralRisk: RiskStructuralRiskView;
  readonly riskDivergence: number | null;
  readonly riskDivergenceChange: number | null;
  readonly riskDivergenceTrend: RiskDivergenceTrend | null;
  readonly componentDivergence: RiskComponentDivergence;
}

export interface RiskDecisionV1_1DailyRecord {
  readonly schemaVersion: typeof RISK_DECISION_V1_1_VERSION;
  readonly publicationDate?: string;
  readonly marketSessionDate: string;
  readonly generatedAt: string;
  readonly spyStructuralRiskScore: number;
  readonly qqqStructuralRiskScore: number;
  readonly riskDivergence: number;
}

export interface DeriveRiskDecisionV1_1Input {
  readonly driver: DominantDriver | null;
  readonly spyBreadth: V2SpyBreadthSummary;
  readonly qqqBreadth: V2SpyBreadthSummary;
  readonly spyGamma: V2GammaSummary;
  readonly qqqGamma: V2GammaSummary;
  readonly marketCtaProxy: CtaProxySummary;
  readonly spyCtaProxy: CtaProxySummary;
  readonly qqqCtaProxy: CtaProxySummary;
  readonly eventGate: EventGateSnapshot | null;
  readonly sectorRotation?: V2SectorRotationSummary | null;
  readonly targetSession: string;
  readonly equityBarsBySymbol?:
    | ReadonlyMap<string, readonly { readonly sessionDate: string; readonly close: number }[]>
    | undefined;
  readonly priorDivergence?: number | null | undefined;
}

const DIVERGENCE_TREND_DEADBAND = 2;

export function unavailableQqqBreadthSummary(): V2SpyBreadthSummary {
  return {
    status: "unavailable",
    stale: false,
    marketSessionDate: null,
    asOf: null,
    advance: null,
    decline: null,
    unchanged: null,
    percentAboveMA20: null,
    percentAboveMA50: null,
    new20DayClosingHigh: null,
    new20DayClosingLow: null,
    missingReason: "QQQ constituent breadth not connected — Nasdaq-100 holdings unavailable.",
    sourceArtifact: null,
    advancingPct: null,
    breadthSignal: null,
    breadthSignalStatus: "unavailable",
    breadthContextLine: null,
  };
}

export function breadthToRiskInput(
  breadth: V2SpyBreadthSummary,
): RiskDecisionSpyBreadthInput {
  return {
    breadthSignalStatus: breadth.breadthSignalStatus,
    breadthSignal: breadth.breadthSignal,
    breadthContextLine: breadth.breadthContextLine,
    stale: breadth.stale,
    advancingPct: breadth.advancingPct,
    percentAboveMA20: breadth.percentAboveMA20,
    percentAboveMA50: breadth.percentAboveMA50,
    new20DayClosingHigh: breadth.new20DayClosingHigh,
    new20DayClosingLow: breadth.new20DayClosingLow,
  };
}

export function gammaToRiskInput(summary: V2GammaSummary): RiskDecisionSpyGammaInput {
  const freshness =
    summary.freshness === "fresh" ||
    summary.freshness === "stale" ||
    summary.freshness === "incomplete"
      ? summary.freshness
      : null;
  return {
    status:
      summary.status === "ready"
        ? "ready"
        : summary.status === "incomplete"
          ? "incomplete"
          : "unavailable",
    freshness,
    regime: summary.regime,
    dealerFlowRegime: summary.dealerFlowRegime,
    volMispricing: summary.volMispricing,
  };
}

function structuralViewFromResult(result: RiskDecisionV1Result): RiskStructuralRiskView {
  return {
    status: result.status,
    riskScore: result.riskScore,
    stance: result.stance,
    coverage: result.coverage,
    withheldReason: result.withheldReason,
  };
}

function closesEndingAtTargetSession(
  bars: readonly { readonly sessionDate: string; readonly close: number }[],
  targetSession: string,
  count: number,
): number[] {
  const filtered = bars.filter((bar) => bar.sessionDate <= targetSession);
  if (filtered.length < count) return [];
  if (filtered.at(-1)?.sessionDate !== targetSession) return [];
  return filtered.slice(-count).map((bar) => bar.close);
}

function sessionCloseReturnPct(
  bars: readonly { readonly sessionDate: string; readonly close: number }[],
  targetSession: string,
  lookbackSessions: number,
): number | null {
  const closes = closesEndingAtTargetSession(
    bars,
    targetSession,
    lookbackSessions + 1,
  );
  if (closes.length < lookbackSessions + 1) return null;
  const start = closes[0];
  const end = closes[closes.length - 1];
  if (start === undefined || end === undefined) return null;
  if (!Number.isFinite(start) || start <= 0 || !Number.isFinite(end)) return null;
  return ((end / start) - 1) * 100;
}

function breadthSignalLabel(
  signal: V2SpyBreadthSummary["breadthSignal"],
  status: V2SpyBreadthSummary["breadthSignalStatus"],
): string | null {
  if (status !== "available" || signal === null) return null;
  switch (signal) {
    case "strong":
      return "strong";
    case "mixed":
      return "mixed";
    case "weak":
      return "weak";
  }
}

function gammaRegimeDivergenceLabel(
  spyRegime: string | null,
  qqqRegime: string | null,
): string | null {
  if (spyRegime !== null && qqqRegime !== null) {
    if (spyRegime === qqqRegime) return `Both ${spyRegime}`;
    return `${spyRegime} vs ${qqqRegime}`;
  }
  if (spyRegime !== null) return `SPY ${spyRegime} · QQQ unavailable`;
  if (qqqRegime !== null) return `SPY unavailable · QQQ ${qqqRegime}`;
  return null;
}

function breadthDivergenceLabel(
  spy: string | null,
  qqq: string | null,
): string | null {
  if (spy !== null && qqq !== null) {
    if (spy === qqq) return `Both ${spy}`;
    return `${spy} vs ${qqq}`;
  }
  if (spy !== null) return `SPY ${spy} · QQQ unavailable`;
  if (qqq !== null) return `QQQ ${qqq} · SPY unavailable`;
  return null;
}

export function classifyRiskDivergenceTrend(
  change: number | null,
): RiskDivergenceTrend | null {
  if (change === null || !Number.isFinite(change)) return null;
  if (Math.abs(change) < DIVERGENCE_TREND_DEADBAND) return "stable";
  return change > 0 ? "widening" : "narrowing";
}

export function computeRiskDivergence(
  spyScore: number | null,
  qqqScore: number | null,
): number | null {
  if (
    spyScore === null ||
    qqqScore === null ||
    !Number.isFinite(spyScore) ||
    !Number.isFinite(qqqScore)
  ) {
    return null;
  }
  return Math.round(qqqScore - spyScore);
}

export function buildRiskComponentDivergence(input: {
  readonly spyBreadth: V2SpyBreadthSummary;
  readonly qqqBreadth: V2SpyBreadthSummary;
  readonly spyGamma: V2GammaSummary;
  readonly qqqGamma: V2GammaSummary;
  readonly equityBarsBySymbol?:
    | ReadonlyMap<string, readonly { readonly sessionDate: string; readonly close: number }[]>
    | undefined;
  readonly targetSession: string;
}): RiskComponentDivergence {
  const spyBreadthLabel = breadthSignalLabel(
    input.spyBreadth.breadthSignal,
    input.spyBreadth.breadthSignalStatus,
  );
  const qqqBreadthLabel = breadthSignalLabel(
    input.qqqBreadth.breadthSignal,
    input.qqqBreadth.breadthSignalStatus,
  );

  const spySpread = input.spyGamma.volMispricing.spreadVolPts;
  const qqqSpread = input.qqqGamma.volMispricing.spreadVolPts;
  const spreadDivergencePts =
    spySpread !== null && qqqSpread !== null
      ? Math.round((qqqSpread - spySpread) * 10) / 10
      : null;

  const spyBars = input.equityBarsBySymbol?.get("SPY") ?? [];
  const qqqBars = input.equityBarsBySymbol?.get("QQQ") ?? [];
  const spy1d = sessionCloseReturnPct(spyBars, input.targetSession, 1);
  const qqq1d = sessionCloseReturnPct(qqqBars, input.targetSession, 1);
  const spy5d = sessionCloseReturnPct(spyBars, input.targetSession, 5);
  const qqq5d = sessionCloseReturnPct(qqqBars, input.targetSession, 5);

  return {
    gammaRegime: {
      spy: input.spyGamma.regime,
      qqq: input.qqqGamma.regime,
      label: gammaRegimeDivergenceLabel(
        input.spyGamma.regime,
        input.qqqGamma.regime,
      ),
    },
    ivHvSpread: {
      spySpreadVolPts: spySpread,
      qqqSpreadVolPts: qqqSpread,
      spreadDivergencePts,
    },
    breadth: {
      spy: spyBreadthLabel,
      qqq: qqqBreadthLabel,
      label: breadthDivergenceLabel(spyBreadthLabel, qqqBreadthLabel),
    },
    relativePerformance: {
      qqqVsSpy1dPct:
        spy1d !== null && qqq1d !== null
          ? Math.round((qqq1d - spy1d) * 100) / 100
          : null,
      qqqVsSpy5dPct:
        spy5d !== null && qqq5d !== null
          ? Math.round((qqq5d - spy5d) * 100) / 100
          : null,
    },
  };
}

export function deriveStructuralRiskV1(input: {
  readonly driver: DominantDriver | null;
  readonly breadth: V2SpyBreadthSummary;
  readonly gamma: V2GammaSummary;
  readonly ctaProxy: CtaProxySummary;
  readonly eventGate: EventGateSnapshot | null;
  readonly sectorRotation?: V2SectorRotationSummary | null;
  readonly targetSession: string;
}): RiskDecisionV1Result {
  return deriveRiskDecisionV1({
    driver: input.driver,
    spyBreadth: breadthToRiskInput(input.breadth),
    spyGamma: gammaToRiskInput(input.gamma),
    ctaProxy: input.ctaProxy,
    eventGate: input.eventGate,
    sectorRotation: input.sectorRotation,
    targetSession: input.targetSession,
  });
}

export function deriveRiskDecisionV1_1(
  input: DeriveRiskDecisionV1_1Input,
): RiskDecisionV1_1Result {
  const marketRisk = deriveRiskDecisionV1({
    driver: input.driver,
    spyBreadth: breadthToRiskInput(input.spyBreadth),
    spyGamma: gammaToRiskInput(input.spyGamma),
    ctaProxy: input.marketCtaProxy,
    eventGate: input.eventGate,
    sectorRotation: input.sectorRotation,
    targetSession: input.targetSession,
  });

  const spyStructural = deriveStructuralRiskV1({
    driver: input.driver,
    breadth: input.spyBreadth,
    gamma: input.spyGamma,
    ctaProxy: input.spyCtaProxy,
    eventGate: input.eventGate,
    sectorRotation: input.sectorRotation,
    targetSession: input.targetSession,
  });

  const qqqStructural = deriveStructuralRiskV1({
    driver: input.driver,
    breadth: input.qqqBreadth,
    gamma: input.qqqGamma,
    ctaProxy: input.qqqCtaProxy,
    eventGate: input.eventGate,
    sectorRotation: null,
    targetSession: input.targetSession,
  });

  const riskDivergence = computeRiskDivergence(
    spyStructural.riskScore,
    qqqStructural.riskScore,
  );
  const riskDivergenceChange =
    riskDivergence !== null &&
    input.priorDivergence !== null &&
    input.priorDivergence !== undefined
      ? riskDivergence - input.priorDivergence
      : null;

  const componentDivergence = buildRiskComponentDivergence({
    spyBreadth: input.spyBreadth,
    qqqBreadth: input.qqqBreadth,
    spyGamma: input.spyGamma,
    qqqGamma: input.qqqGamma,
    equityBarsBySymbol: input.equityBarsBySymbol,
    targetSession: input.targetSession,
  });

  return {
    marketRisk,
    spyStructuralRisk: structuralViewFromResult(spyStructural),
    qqqStructuralRisk: structuralViewFromResult(qqqStructural),
    riskDivergence,
    riskDivergenceChange,
    riskDivergenceTrend: classifyRiskDivergenceTrend(riskDivergenceChange),
    componentDivergence,
  };
}

function isValidRiskV1_1PublicationDate(publicationDate: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(publicationDate);
}

export function riskDecisionV1_1DailyPath(
  dataRoot: string,
  publicationDate: string,
): string {
  return join(dataRoot, "risk-decision-v1-1", `${publicationDate}.json`);
}

export function riskDecisionV1_1LatestPath(dataRoot: string): string {
  return join(dataRoot, "risk-decision-v1-1", "latest.json");
}

function parseRiskDecisionV1_1DailyRecord(
  raw: unknown,
  publicationDate: string,
): RiskDecisionV1_1DailyRecord | null {
  const record = raw as RiskDecisionV1_1DailyRecord;
  const recordPublicationDate = record.publicationDate ?? record.marketSessionDate;
  if (
    recordPublicationDate !== publicationDate ||
    typeof record.spyStructuralRiskScore !== "number" ||
    typeof record.qqqStructuralRiskScore !== "number" ||
    typeof record.riskDivergence !== "number"
  ) {
    return null;
  }
  return {
    ...record,
    publicationDate: recordPublicationDate,
  };
}

export function loadRiskDecisionV1_1Daily(
  dataRoot: string,
  publicationDate: string,
): RiskDecisionV1_1DailyRecord | null {
  const path = riskDecisionV1_1DailyPath(dataRoot, publicationDate);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as RiskDecisionV1_1DailyRecord;
    return parseRiskDecisionV1_1DailyRecord(raw, publicationDate);
  } catch {
    return null;
  }
}

export function loadPriorPublishedRiskDivergence(
  dataRoot: string,
  publicationDate: string,
): number | null {
  const dir = join(dataRoot, "risk-decision-v1-1");
  if (!existsSync(dir)) return null;

  const records: RiskDecisionV1_1DailyRecord[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json") || name === "latest.json") continue;
    const date = name.slice(0, -5);
    const record = loadRiskDecisionV1_1Daily(dataRoot, date);
    if (record) records.push(record);
  }

  const prior = records
    .filter(
      (record) =>
        (record.publicationDate ?? record.marketSessionDate) < publicationDate,
    )
    .sort((left, right) =>
      (left.publicationDate ?? left.marketSessionDate).localeCompare(
        right.publicationDate ?? right.marketSessionDate,
      ),
    )
    .at(-1);

  return prior?.riskDivergence ?? null;
}

export function isRiskDecisionV1_1DailyRecordPublishable(
  result: RiskDecisionV1_1Result,
): boolean {
  return (
    result.spyStructuralRisk.status === "ready" &&
    result.qqqStructuralRisk.status === "ready" &&
    result.spyStructuralRisk.riskScore !== null &&
    result.qqqStructuralRisk.riskScore !== null &&
    result.riskDivergence !== null
  );
}

export function persistRiskDecisionV1_1Daily(
  dataRoot: string,
  record: RiskDecisionV1_1DailyRecord,
): boolean {
  const publicationDate = record.publicationDate ?? record.marketSessionDate;
  if (!isValidRiskV1_1PublicationDate(publicationDate)) return false;

  const path = riskDecisionV1_1DailyPath(dataRoot, publicationDate);
  if (existsSync(path)) return false;

  const normalized: RiskDecisionV1_1DailyRecord = {
    ...record,
    publicationDate,
  };
  writeJsonAtomic(path, normalized);
  writeJsonAtomic(riskDecisionV1_1LatestPath(dataRoot), normalized);
  return true;
}

export function publishRiskDecisionV1_1Daily(
  dataRoot: string,
  record: RiskDecisionV1_1DailyRecord,
  options?: { readonly force?: boolean },
): boolean {
  const publicationDate = record.publicationDate ?? record.marketSessionDate;
  if (!isValidRiskV1_1PublicationDate(publicationDate)) return false;

  const existing = loadRiskDecisionV1_1Daily(dataRoot, publicationDate);
  if (existing && options?.force !== true) return false;

  const normalized: RiskDecisionV1_1DailyRecord = {
    ...record,
    publicationDate,
  };
  writeJsonAtomic(riskDecisionV1_1DailyPath(dataRoot, publicationDate), normalized);
  writeJsonAtomic(riskDecisionV1_1LatestPath(dataRoot), normalized);
  return true;
}

export function resolveRiskDivergenceDayOverDay(input: {
  readonly dataRoot: string | null | undefined;
  readonly publicationDate: string;
  readonly decisionSessionDate: string;
  readonly result: RiskDecisionV1_1Result;
  readonly now?: Date;
  readonly force?: boolean;
}): { readonly priorDivergence: number | null; readonly change: number | null } {
  const priorDivergence =
    input.dataRoot !== null && input.dataRoot !== undefined
      ? loadPriorPublishedRiskDivergence(input.dataRoot, input.publicationDate)
      : null;

  if (
    isRiskDecisionV1_1DailyRecordPublishable(input.result) &&
    input.dataRoot &&
    input.result.riskDivergence !== null &&
    input.result.spyStructuralRisk.riskScore !== null &&
    input.result.qqqStructuralRisk.riskScore !== null
  ) {
    const record: RiskDecisionV1_1DailyRecord = {
      schemaVersion: RISK_DECISION_V1_1_VERSION,
      publicationDate: input.publicationDate,
      marketSessionDate: input.decisionSessionDate,
      generatedAt: input.now?.toISOString() ?? new Date().toISOString(),
      spyStructuralRiskScore: input.result.spyStructuralRisk.riskScore!,
      qqqStructuralRiskScore: input.result.qqqStructuralRisk.riskScore!,
      riskDivergence: input.result.riskDivergence,
    };
    publishRiskDecisionV1_1Daily(input.dataRoot, record, {
      force: input.force === true,
    });
  }

  const change =
    input.result.riskDivergence !== null && priorDivergence !== null
      ? input.result.riskDivergence - priorDivergence
      : null;

  return { priorDivergence, change };
}
