import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  resolveCurrentMarketSessionDate,
  resolveLastCompletedMarketSessionDate,
  resolveNextMarketSessionDate,
} from "@/ai-study/session";
import type { EventGateSnapshot } from "@/contracts/event-gate";
import { writeJsonAtomic } from "./atomic-write";
import type { DailyBar } from "./breadth/bars/types";
import {
  formatGexCompact,
  type CtaProxySummary,
} from "./format-gamma";
import {
  artifactSourceLabel,
  readJson,
  writeJson,
  type RuntimeJsonStore,
} from "./runtime-store";
import type { RiskDecisionV1Result } from "./risk-decision-v1";
import { RISK_DECISION_V1_VERSION } from "./risk-decision-v1";
import type {
  V2CommandCenterView,
  V2GammaSummary,
  V2SpyBreadthSummary,
} from "./v2-command-center";

export const DAILY_DECISION_LEDGER_SCHEMA_VERSION = "0.1.0";

export const DAILY_DECISION_LEDGER_MODEL_VERSION = `ledger-${DAILY_DECISION_LEDGER_SCHEMA_VERSION}+risk-${RISK_DECISION_V1_VERSION}`;

export interface DailyDecisionLedgerGammaSnapshot {
  readonly spot: number | null;
  readonly callWall: number | null;
  readonly putWall: number | null;
  readonly gammaFlip: number | null;
  readonly dealerFlowRegime: string | null;
  readonly netGex: number | null;
  readonly netGexLabel: string | null;
  readonly regime: string | null;
  readonly sessionDate: string | null;
  readonly freshness: string | null;
  readonly expiration: string | null;
  readonly volSignal: string | null;
  readonly volSpreadVolPts: number | null;
}

export interface DailyDecisionLedgerFreshnessSnapshot {
  readonly breadthMarketSessionDate: string | null;
  readonly breadthStale: boolean;
  readonly macroMarketSessionDate: string | null;
  readonly macroSessionAlignment: string | null;
  readonly spyGammaSessionDate: string | null;
  readonly spyGammaFreshness: string | null;
  readonly qqqGammaSessionDate: string | null;
  readonly qqqGammaFreshness: string | null;
  readonly sectorRotationSessionDate: string | null;
  readonly sectorRotationStale: boolean;
}

export interface DailyDecisionLedgerRiskModelSnapshot {
  readonly baseRiskScore: number | null;
  readonly concentrationPenalty: number | null;
  readonly effectiveWeight: number | null;
  readonly factorContributions: RiskDecisionV1Result["factorContributions"];
}

export interface DailyDecisionLedgerPrediction {
  readonly decisionStatus: V2CommandCenterView["decisionStatus"];
  readonly stance: V2CommandCenterView["stance"];
  readonly riskScore: number | null;
  readonly riskChange: number | null;
  readonly riskChangeReason: string | null;
  readonly opportunityScore: number | null;
  readonly exposure: V2CommandCenterView["exposure"];
  readonly allocation: V2CommandCenterView["allocation"];
  readonly macroLabel: string | null;
  readonly macroRiskDirection: string | null;
  readonly macroMarketSessionDate: string | null;
  readonly riskDivergence: number | null;
  readonly spyStructuralRiskScore: number | null;
  readonly qqqStructuralRiskScore: number | null;
  readonly keyFactors: readonly string[];
  readonly spy: DailyDecisionLedgerGammaSnapshot;
  readonly qqq: DailyDecisionLedgerGammaSnapshot;
  readonly spyBreadthSignal: V2SpyBreadthSummary["breadthSignal"];
  readonly spyBreadthAdvancingPct: number | null;
  readonly ctaSignal: CtaProxySummary["signal"];
  readonly freshness: DailyDecisionLedgerFreshnessSnapshot;
  readonly riskModel: DailyDecisionLedgerRiskModelSnapshot;
}

export interface DailyDecisionLedgerSymbolOutcome {
  readonly priorClose: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly closeToCloseReturnPct: number;
  readonly openToCloseReturnPct: number;
  readonly maxFavorableMovePct: number;
  readonly maxAdverseMovePct: number;
}

export interface DailyDecisionLedgerOutcome {
  readonly recordedAt: string;
  readonly outcomeSessionDate: string;
  readonly spy: DailyDecisionLedgerSymbolOutcome;
  readonly qqq: DailyDecisionLedgerSymbolOutcome | null;
}

export interface DailyDecisionLedgerRecord {
  readonly schemaVersion: typeof DAILY_DECISION_LEDGER_SCHEMA_VERSION;
  readonly marketSessionDate: string;
  readonly frozenAt: string;
  readonly publicationDate?: string;
  readonly modelVersion: string;
  readonly prediction: DailyDecisionLedgerPrediction;
  readonly outcome?: DailyDecisionLedgerOutcome;
}

function roundPct(value: number): number {
  return Math.round(value * 100) / 100;
}

function pctChange(from: number, to: number): number {
  return roundPct(((to - from) / from) * 100);
}

function gammaLedgerSnapshot(item: V2GammaSummary): DailyDecisionLedgerGammaSnapshot {
  return {
    spot: item.spot,
    callWall: item.callWall,
    putWall: item.putWall,
    gammaFlip: item.gammaFlip,
    dealerFlowRegime: item.dealerFlowRegime,
    netGex: item.netGex,
    netGexLabel: formatGexCompact(item.netGex),
    regime: item.regime,
    sessionDate: item.sessionDate,
    freshness: item.freshness,
    expiration: item.expiration,
    volSignal: item.volMispricing.signal,
    volSpreadVolPts: item.volMispricing.spreadVolPts,
  };
}

function eventKindLabel(kind: string): string {
  switch (kind) {
    case "fomc":
      return "FOMC";
    case "cpi":
      return "CPI";
    case "jobs":
      return "Jobs";
    case "gdp":
      return "GDP";
    default:
      return kind;
  }
}

function formatEventTime(occurredAt: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(occurredAt));
  } catch {
    return occurredAt;
  }
}

function scheduledEventFactorLine(eventGate: EventGateSnapshot | null): string | null {
  if (!eventGate || eventGate.state === "clear" || eventGate.state === "unavailable") {
    return null;
  }
  const event = eventGate.activeEvents[0] ?? eventGate.nextEvent;
  if (!event) return null;
  const phase =
    event.phase === "active_shock" ? "Active Shock" : "Scheduled Risk";
  return `⚠ ${eventKindLabel(event.kind)} ${formatEventTime(event.occurredAt)} ET · ${phase}`;
}

export function buildDailyDecisionLedgerKeyFactors(input: {
  readonly view: V2CommandCenterView;
  readonly eventGate: EventGateSnapshot | null;
}): readonly string[] {
  const lines: string[] = [];
  const eventLine = scheduledEventFactorLine(input.eventGate);
  if (eventLine) lines.push(eventLine);

  const breadth = input.view.spyBreadth.breadthSignal;
  if (breadth) lines.push(`Breadth · ${breadth}`);

  if (input.view.ctaProxy.signal) {
    lines.push(`CTA · ${input.view.ctaProxy.signal}`);
  }

  const spyGamma = input.view.gamma[0];
  if (spyGamma.regime) {
    lines.push(`SPY Gamma · ${spyGamma.regime.replaceAll("_", " ")}`);
  }

  if (input.view.macroSummary?.label) {
    lines.push(input.view.macroSummary.label);
  } else if (input.view.macroLabel) {
    lines.push(input.view.macroLabel);
  }

  return lines.slice(0, 5);
}

export function buildDailyDecisionLedgerPrediction(input: {
  readonly view: V2CommandCenterView;
  readonly decision: RiskDecisionV1Result;
  readonly eventGate: EventGateSnapshot | null;
}): DailyDecisionLedgerPrediction | null {
  if (input.view.decisionStatus !== "ready" || !input.view.sessionDate) {
    return null;
  }

  const effectiveWeight =
    input.decision.coverage?.effectiveWeight ??
    input.decision.factorContributions.reduce(
      (sum, row) => sum + row.effectiveWeight,
      0,
    );

  return {
    decisionStatus: input.view.decisionStatus,
    stance: input.view.stance,
    riskScore: input.view.riskScore,
    riskChange: input.view.riskChange,
    riskChangeReason: input.view.riskChangeReason,
    opportunityScore: input.view.opportunityScore,
    exposure: input.view.exposure,
    allocation: input.view.allocation,
    macroLabel: input.view.macroSummary?.label ?? input.view.macroLabel,
    macroRiskDirection: input.view.macroSummary?.riskDirection ?? null,
    macroMarketSessionDate: input.view.macroSummary?.marketSessionDate ?? null,
    riskDivergence: input.view.riskDivergence,
    spyStructuralRiskScore: input.view.spyStructuralRiskScore,
    qqqStructuralRiskScore: input.view.qqqStructuralRiskScore,
    keyFactors: buildDailyDecisionLedgerKeyFactors({
      view: input.view,
      eventGate: input.eventGate,
    }),
    spy: gammaLedgerSnapshot(input.view.gamma[0]),
    qqq: gammaLedgerSnapshot(input.view.gamma[1]),
    spyBreadthSignal: input.view.spyBreadth.breadthSignal,
    spyBreadthAdvancingPct: input.view.spyBreadth.advancingPct,
    ctaSignal: input.view.ctaProxy.signal,
    freshness: {
      breadthMarketSessionDate: input.view.spyBreadth.marketSessionDate,
      breadthStale: input.view.spyBreadth.stale,
      macroMarketSessionDate: input.view.macroSummary?.marketSessionDate ?? null,
      macroSessionAlignment:
        input.view.macroSummary?.marketSessionDate && input.view.sessionDate
          ? input.view.macroSummary.marketSessionDate === input.view.sessionDate
            ? "aligned"
            : "misaligned"
          : null,
      spyGammaSessionDate: input.view.gamma[0].sessionDate,
      spyGammaFreshness: input.view.gamma[0].freshness,
      qqqGammaSessionDate: input.view.gamma[1].sessionDate,
      qqqGammaFreshness: input.view.gamma[1].freshness,
      sectorRotationSessionDate: input.view.sectorRotation.sessionDate,
      sectorRotationStale: input.view.sectorRotation.stale,
    },
    riskModel: {
      baseRiskScore: input.decision.baseRiskScore,
      concentrationPenalty: input.decision.concentrationPenalty,
      effectiveWeight: roundPct(effectiveWeight),
      factorContributions: input.decision.factorContributions,
    },
  };
}

export function dailyDecisionLedgerRelativePath(marketSessionDate: string): string {
  return `daily-decision-ledger/${marketSessionDate}.json`;
}

export function dailyDecisionLedgerPath(
  dataRoot: string,
  marketSessionDate: string,
): string {
  return join(dataRoot, "daily-decision-ledger", `${marketSessionDate}.json`);
}

export function dailyDecisionLedgerExportRelativePath(
  generatedAt = "latest",
): string {
  return `daily-decision-ledger/export/${generatedAt}.csv`;
}

function parseDailyDecisionLedgerRecord(
  raw: unknown,
  marketSessionDate: string,
): DailyDecisionLedgerRecord | null {
  const record = raw as DailyDecisionLedgerRecord;
  if (
    record.schemaVersion !== DAILY_DECISION_LEDGER_SCHEMA_VERSION ||
    record.marketSessionDate !== marketSessionDate ||
    !record.prediction
  ) {
    return null;
  }
  return record;
}

export function loadDailyDecisionLedgerRecord(
  dataRoot: string,
  marketSessionDate: string,
): DailyDecisionLedgerRecord | null {
  const path = dailyDecisionLedgerPath(dataRoot, marketSessionDate);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return parseDailyDecisionLedgerRecord(raw, marketSessionDate);
  } catch {
    return null;
  }
}

export async function loadDailyDecisionLedgerRecordAsync(
  artifactStore: RuntimeJsonStore,
  marketSessionDate: string,
): Promise<DailyDecisionLedgerRecord | null> {
  const raw = await readJson(
    artifactStore,
    dailyDecisionLedgerRelativePath(marketSessionDate),
  );
  if (raw === null) return null;
  return parseDailyDecisionLedgerRecord(raw, marketSessionDate);
}

export function listDailyDecisionLedgerRecords(
  dataRoot: string,
): readonly DailyDecisionLedgerRecord[] {
  const dir = join(dataRoot, "daily-decision-ledger");
  if (!existsSync(dir)) return [];
  const records: DailyDecisionLedgerRecord[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const marketSessionDate = name.slice(0, -5);
    const record = loadDailyDecisionLedgerRecord(dataRoot, marketSessionDate);
    if (record) records.push(record);
  }
  return records.sort((left, right) =>
    left.marketSessionDate.localeCompare(right.marketSessionDate),
  );
}

export async function listDailyDecisionLedgerRecordsAsync(
  artifactStore: RuntimeJsonStore,
): Promise<readonly DailyDecisionLedgerRecord[]> {
  const paths = await artifactStore.list("daily-decision-ledger");
  const records: DailyDecisionLedgerRecord[] = [];
  for (const relativePath of paths) {
    if (!relativePath.startsWith("daily-decision-ledger/")) continue;
    if (!relativePath.endsWith(".json")) continue;
    if (relativePath.includes("/export/")) continue;
    const marketSessionDate = relativePath.slice(
      "daily-decision-ledger/".length,
      -5,
    );
    const record = await loadDailyDecisionLedgerRecordAsync(
      artifactStore,
      marketSessionDate,
    );
    if (record) records.push(record);
  }
  return records.sort((left, right) =>
    left.marketSessionDate.localeCompare(right.marketSessionDate),
  );
}

function findSessionBar(
  barsBySymbol: ReadonlyMap<string, readonly DailyBar[]> | undefined,
  symbol: string,
  sessionDate: string,
): DailyBar | null {
  const bars = barsBySymbol?.get(symbol);
  if (!bars) return null;
  return bars.find((bar) => bar.sessionDate === sessionDate) ?? null;
}

export function buildDailyDecisionLedgerSymbolOutcome(input: {
  readonly priorSessionBar: DailyBar;
  readonly outcomeSessionBar: DailyBar;
}): DailyDecisionLedgerSymbolOutcome {
  const open = input.outcomeSessionBar.open;
  return {
    priorClose: input.priorSessionBar.close,
    open,
    high: input.outcomeSessionBar.high,
    low: input.outcomeSessionBar.low,
    close: input.outcomeSessionBar.close,
    closeToCloseReturnPct: pctChange(
      input.priorSessionBar.close,
      input.outcomeSessionBar.close,
    ),
    openToCloseReturnPct: pctChange(open, input.outcomeSessionBar.close),
    maxFavorableMovePct: pctChange(open, input.outcomeSessionBar.high),
    maxAdverseMovePct: pctChange(open, input.outcomeSessionBar.low),
  };
}

export function buildDailyDecisionLedgerOutcome(input: {
  readonly predictionSessionDate: string;
  readonly outcomeSessionDate: string;
  readonly equityBarsBySymbol: ReadonlyMap<string, readonly DailyBar[]>;
  readonly recordedAt: string;
}): DailyDecisionLedgerOutcome | null {
  const spyPrior = findSessionBar(
    input.equityBarsBySymbol,
    "SPY",
    input.predictionSessionDate,
  );
  const spyOutcome = findSessionBar(
    input.equityBarsBySymbol,
    "SPY",
    input.outcomeSessionDate,
  );
  if (!spyPrior || !spyOutcome) return null;

  const qqqPrior = findSessionBar(
    input.equityBarsBySymbol,
    "QQQ",
    input.predictionSessionDate,
  );
  const qqqOutcome = findSessionBar(
    input.equityBarsBySymbol,
    "QQQ",
    input.outcomeSessionDate,
  );

  return {
    recordedAt: input.recordedAt,
    outcomeSessionDate: input.outcomeSessionDate,
    spy: buildDailyDecisionLedgerSymbolOutcome({
      priorSessionBar: spyPrior,
      outcomeSessionBar: spyOutcome,
    }),
    qqq:
      qqqPrior && qqqOutcome
        ? buildDailyDecisionLedgerSymbolOutcome({
            priorSessionBar: qqqPrior,
            outcomeSessionBar: qqqOutcome,
          })
        : null,
  };
}

export function buildDailyDecisionLedgerRecord(input: {
  readonly view: V2CommandCenterView;
  readonly decision: RiskDecisionV1Result;
  readonly eventGate: EventGateSnapshot | null;
  readonly frozenAt: string;
  readonly publicationDate: string;
}): DailyDecisionLedgerRecord | null {
  const prediction = buildDailyDecisionLedgerPrediction({
    view: input.view,
    decision: input.decision,
    eventGate: input.eventGate,
  });
  if (!prediction || !input.view.sessionDate) return null;

  return {
    schemaVersion: DAILY_DECISION_LEDGER_SCHEMA_VERSION,
    marketSessionDate: input.view.sessionDate,
    frozenAt: input.frozenAt,
    publicationDate: input.publicationDate,
    modelVersion: DAILY_DECISION_LEDGER_MODEL_VERSION,
    prediction,
  };
}

export function persistDailyDecisionLedgerRecord(
  dataRoot: string,
  record: DailyDecisionLedgerRecord,
): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(record.marketSessionDate)) return false;
  const path = dailyDecisionLedgerPath(dataRoot, record.marketSessionDate);
  if (existsSync(path)) return false;
  writeJsonAtomic(path, record);
  return true;
}

export async function persistDailyDecisionLedgerRecordAsync(
  artifactStore: RuntimeJsonStore,
  record: DailyDecisionLedgerRecord,
): Promise<boolean> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(record.marketSessionDate)) return false;
  return await writeJson(
    artifactStore,
    dailyDecisionLedgerRelativePath(record.marketSessionDate),
    record,
  );
}

export async function maybeFreezeDailyDecisionLedgerPrediction(input: {
  readonly view: V2CommandCenterView;
  readonly decision: RiskDecisionV1Result;
  readonly eventGate: EventGateSnapshot | null;
  readonly publicationDate: string;
  readonly frozenAt: string;
  readonly dataRoot: string | null | undefined;
  readonly artifactStore?: RuntimeJsonStore;
}): Promise<boolean> {
  if (input.view.decisionStatus !== "ready" || !input.view.sessionDate) {
    return false;
  }

  const record = buildDailyDecisionLedgerRecord({
    view: input.view,
    decision: input.decision,
    eventGate: input.eventGate,
    frozenAt: input.frozenAt,
    publicationDate: input.publicationDate,
  });
  if (!record) return false;

  if (input.artifactStore) {
    const persisted = await persistDailyDecisionLedgerRecordAsync(
      input.artifactStore,
      record,
    );
    if (persisted) return true;
    if (!input.dataRoot) return false;
  }

  if (!input.dataRoot) return false;
  return persistDailyDecisionLedgerRecord(input.dataRoot, record);
}

export async function maybeAppendDailyDecisionLedgerOutcome(input: {
  readonly marketSessionDate: string;
  readonly now: Date;
  readonly equityBarsBySymbol: ReadonlyMap<string, readonly DailyBar[]>;
  readonly dataRoot: string | null | undefined;
  readonly artifactStore?: RuntimeJsonStore;
}): Promise<boolean> {
  const outcomeSessionDate = resolveNextMarketSessionDate(input.marketSessionDate);
  if (!outcomeSessionDate) return false;

  const lastCompleted = resolveLastCompletedMarketSessionDate(input.now);
  if (outcomeSessionDate > lastCompleted) return false;

  const record = input.artifactStore
    ? await loadDailyDecisionLedgerRecordAsync(
        input.artifactStore,
        input.marketSessionDate,
      )
    : input.dataRoot
      ? loadDailyDecisionLedgerRecord(input.dataRoot, input.marketSessionDate)
      : null;
  if (!record || record.outcome) return false;

  const outcome = buildDailyDecisionLedgerOutcome({
    predictionSessionDate: input.marketSessionDate,
    outcomeSessionDate,
    equityBarsBySymbol: input.equityBarsBySymbol,
    recordedAt: input.now.toISOString(),
  });
  if (!outcome) return false;

  const updated: DailyDecisionLedgerRecord = {
    ...record,
    outcome,
  };

  if (input.artifactStore) {
    const wrote = await writeJson(
      input.artifactStore,
      dailyDecisionLedgerRelativePath(input.marketSessionDate),
      updated,
      { allowOverwrite: true },
    );
    if (wrote) return true;
    if (!input.dataRoot) return false;
  }

  if (!input.dataRoot) return false;
  writeJsonAtomic(
    dailyDecisionLedgerPath(input.dataRoot, input.marketSessionDate),
    updated,
  );
  return true;
}

export async function maybeAppendPendingDailyDecisionLedgerOutcomes(input: {
  readonly now: Date;
  readonly equityBarsBySymbol: ReadonlyMap<string, readonly DailyBar[]>;
  readonly dataRoot: string | null | undefined;
  readonly artifactStore?: RuntimeJsonStore;
}): Promise<number> {
  const records = input.artifactStore
    ? await listDailyDecisionLedgerRecordsAsync(input.artifactStore)
    : input.dataRoot
      ? listDailyDecisionLedgerRecords(input.dataRoot)
      : [];
  let appended = 0;
  for (const record of records) {
    if (record.outcome) continue;
    const didAppend = await maybeAppendDailyDecisionLedgerOutcome({
      marketSessionDate: record.marketSessionDate,
      now: input.now,
      equityBarsBySymbol: input.equityBarsBySymbol,
      dataRoot: input.dataRoot,
      artifactStore: input.artifactStore,
    });
    if (didAppend) appended += 1;
  }
  return appended;
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  return csvEscape(String(value));
}

export function buildDailyDecisionLedgerCsv(
  records: readonly DailyDecisionLedgerRecord[],
): string {
  const headers = [
    "marketSessionDate",
    "frozenAt",
    "publicationDate",
    "modelVersion",
    "stance",
    "riskScore",
    "riskChange",
    "opportunityScore",
    "exposureMin",
    "exposureMax",
    "allocationHighBeta",
    "allocationDefense",
    "allocationMetals",
    "allocationHedge",
    "macroLabel",
    "riskDivergence",
    "keyFactors",
    "spySpot",
    "spyRegime",
    "spyFreshness",
    "qqqSpot",
    "qqqRegime",
    "qqqFreshness",
    "outcomeSessionDate",
    "outcomeRecordedAt",
    "spyCloseToCloseReturnPct",
    "spyOpenToCloseReturnPct",
    "spyMfePct",
    "spyMaePct",
    "qqqCloseToCloseReturnPct",
    "qqqOpenToCloseReturnPct",
    "qqqMfePct",
    "qqqMaePct",
  ];

  const rows = records.map((record) => {
    const p = record.prediction;
    const o = record.outcome;
    return [
      record.marketSessionDate,
      record.frozenAt,
      record.publicationDate ?? "",
      record.modelVersion,
      p.stance ?? "",
      p.riskScore ?? "",
      p.riskChange ?? "",
      p.opportunityScore ?? "",
      p.exposure?.min ?? "",
      p.exposure?.max ?? "",
      p.allocation?.highBeta ?? "",
      p.allocation?.defense ?? "",
      p.allocation?.metals ?? "",
      p.allocation?.hedge ?? "",
      p.macroLabel ?? "",
      p.riskDivergence ?? "",
      p.keyFactors.join(" | "),
      p.spy.spot ?? "",
      p.spy.regime ?? "",
      p.spy.freshness ?? "",
      p.qqq.spot ?? "",
      p.qqq.regime ?? "",
      p.qqq.freshness ?? "",
      o?.outcomeSessionDate ?? "",
      o?.recordedAt ?? "",
      o?.spy.closeToCloseReturnPct ?? "",
      o?.spy.openToCloseReturnPct ?? "",
      o?.spy.maxFavorableMovePct ?? "",
      o?.spy.maxAdverseMovePct ?? "",
      o?.qqq?.closeToCloseReturnPct ?? "",
      o?.qqq?.openToCloseReturnPct ?? "",
      o?.qqq?.maxFavorableMovePct ?? "",
      o?.qqq?.maxAdverseMovePct ?? "",
    ].map(csvCell);
  });

  return [headers.join(","), ...rows.map((row) => row.join(","))].join("\n") + "\n";
}

export async function exportDailyDecisionLedgerCsv(input: {
  readonly dataRoot: string | null | undefined;
  readonly artifactStore?: RuntimeJsonStore;
  readonly generatedAt?: string;
}): Promise<{ readonly csv: string; readonly recordCount: number }> {
  const records = input.artifactStore
    ? await listDailyDecisionLedgerRecordsAsync(input.artifactStore)
    : input.dataRoot
      ? listDailyDecisionLedgerRecords(input.dataRoot)
      : [];
  const csv = buildDailyDecisionLedgerCsv(records);
  const generatedAt = input.generatedAt ?? "latest";
  const relativePath = dailyDecisionLedgerExportRelativePath(generatedAt);

  if (input.artifactStore) {
    await input.artifactStore.writeText(relativePath, csv, {
      allowOverwrite: true,
    });
    if (generatedAt !== "latest") {
      await input.artifactStore.writeText(
        dailyDecisionLedgerExportRelativePath("latest"),
        csv,
        { allowOverwrite: true },
      );
    }
  } else if (input.dataRoot) {
    writeJsonAtomic(join(input.dataRoot, relativePath), csv);
    if (generatedAt !== "latest") {
      writeJsonAtomic(
        join(input.dataRoot, dailyDecisionLedgerExportRelativePath("latest")),
        csv,
      );
    }
  }

  return { csv, recordCount: records.length };
}

export function dailyDecisionLedgerSourceLabel(
  store: RuntimeJsonStore,
  marketSessionDate: string,
): string {
  return artifactSourceLabel(
    store,
    dailyDecisionLedgerRelativePath(marketSessionDate),
  );
}

export function resolveDailyDecisionLedgerPublicationDate(now = new Date()): string {
  return resolveCurrentMarketSessionDate(now);
}
