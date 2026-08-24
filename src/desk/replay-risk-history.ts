/**
 * Same-session historical replay for Risk Decision V1.
 * Loads dated artifacts only — never substitutes current live inputs.
 * Scoring is delegated unchanged to deriveRiskDecisionV1.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadCatalystFeed } from "@/catalyst/load";
import type { DominantDriver } from "@/contracts";
import { isCurrentBreadthInternalsSnapshot } from "@/contracts/breadth-internals";
import type { EventGateSnapshot } from "@/contracts/event-gate";
import { SPY_BREADTH_CONFIG } from "@/desk/breadth/config";
import { createFilesystemBreadthSnapshotStore } from "@/desk/breadth/store";
import type { DailyBar } from "@/desk/breadth/bars/types";
import { buildEventGate } from "@/desk/event-gate/build-event-gate";
import { loadSessionDriver } from "@/desk/load-session-driver";
import {
  buildManualGammaSummary,
  listManualGammaSnapshots,
  loadManualGammaSnapshot,
  type ManualGammaSnapshot,
} from "@/desk/manual-gamma";
import {
  RISK_DECISION_V1_MODEL_WEIGHT,
  RISK_V1_FACTOR_IDS,
  deriveRiskDecisionV1,
  type RiskDecisionSpyBreadthInput,
  type RiskDecisionSpyGammaInput,
  type RiskV1FactorId,
} from "@/desk/risk-decision-v1";
import { breadthToRiskInput, gammaToRiskInput } from "@/desk/risk-decision-v1-1";
import { createFilesystemRuntimeJsonStore } from "@/desk/runtime-store";
import { deriveOpportunityScoreV2 } from "@/desk/opportunity-score-v2";
import type {
  OpportunityGammaInput,
  OpportunityV2Result,
} from "@/desk/opportunity-score-v2";
import { summarizeSpyBreadthFromDurable } from "@/desk/v2-command-center";
import {
  deriveRiskTrendV2,
  type RiskTrendSnapshot,
  type RiskTrendV2Label,
} from "@/desk/risk-trend-v2";
import { derivePositioningV2, type PositioningV2Label } from "@/desk/positioning-v2";
import {
  RISK_HISTORY_BACKFILL_END,
  RISK_HISTORY_BACKFILL_START,
  tradingSessionsInRange,
} from "@/desk/backfill-risk-history-inputs";
import { defaultSessionCalendar } from "@/macro/calendar";

export const RISK_HISTORY_PRIORITY_DATES = [
  "2026-08-14",
  "2026-08-17",
  "2026-08-19",
  "2026-08-20",
  "2026-08-21",
  "2026-08-22",
] as const;

export const OPPORTUNITY_V2_REPLAY_DATES = [
  "2026-07-27",
  "2026-07-28",
  "2026-07-29",
  "2026-07-30",
  "2026-07-31",
  "2026-08-14",
  "2026-08-17",
  "2026-08-19",
  "2026-08-20",
  "2026-08-21",
  "2026-08-24",
] as const;

const UNAVAILABLE_GAMMA: RiskDecisionSpyGammaInput = {
  status: "unavailable",
  freshness: null,
  regime: null,
  dealerFlowRegime: null,
  volMispricing: {
    status: "unavailable",
    ivPct: null,
    hv20Pct: null,
    spreadVolPts: null,
    signal: null,
    ivDataLabel: null,
  },
};

export interface RiskHistoryReplayRow {
  readonly date: string;
  readonly status: "ready" | "withheld";
  readonly riskScore: number | null;
  readonly stance: string | null;
  readonly factorScores: Readonly<Record<RiskV1FactorId, number | null>>;
  readonly missingFactors: readonly RiskV1FactorId[];
  readonly effectiveCoverage: number | null;
  readonly spyNext1dReturn: number | null;
  readonly qqqNext1dReturn: number | null;
  readonly spyNext3SessionMdd: number | null;
  readonly qqqNext3SessionMdd: number | null;
  readonly opportunityScore: number | null;
  readonly opportunityCoverage: number | null;
  readonly opportunityFactors: OpportunityV2Result["factors"];
  readonly opportunityMissing: readonly string[];
  readonly trendSnapshot: RiskTrendSnapshot;
  readonly riskTrend: RiskTrendV2Label | null;
  readonly riskTrendPriorDate: string | null;
  readonly riskTrendReasons: readonly string[];
  readonly positioning: PositioningV2Label | null;
  readonly notes: readonly string[];
}

export interface ReplayRiskHistoryOptions {
  readonly dataRoot: string;
  readonly dates?: readonly string[];
}

function sessionCloseGeneratedAt(sessionDate: string): string {
  // August sessions are EDT (UTC−4); 16:00 ET regular-session close.
  return `${sessionDate}T16:00:00-04:00`;
}

function loadUniverseBars(dataRoot: string, symbol: "SPY" | "QQQ"): DailyBar[] {
  const path = join(dataRoot, "bars/spy-universe", `${symbol}.json`);
  if (!existsSync(path)) return [];
  const raw = JSON.parse(readFileSync(path, "utf8")) as {
    readonly bars?: readonly DailyBar[];
  };
  const bars = raw.bars ?? [];
  return [...bars].sort((left, right) =>
    left.sessionDate.localeCompare(right.sessionDate),
  );
}

function shiftIsoDate(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

export function priorCompletedSession(
  sessionDate: string,
  spyBars: readonly DailyBar[],
): string | null {
  const fromBars = spyBars.filter((bar) => bar.sessionDate < sessionDate);
  if (fromBars.length > 0) return fromBars[fromBars.length - 1]!.sessionDate;
  let cursor = shiftIsoDate(sessionDate, -1);
  for (let step = 0; step < 10; step += 1) {
    if (defaultSessionCalendar.isSession(cursor)) return cursor;
    cursor = shiftIsoDate(cursor, -1);
  }
  return null;
}

function barsThroughSession(
  bars: readonly DailyBar[],
  sessionDate: string,
): DailyBar[] {
  return bars.filter((bar) => bar.sessionDate <= sessionDate);
}

function nextSessionBars(
  bars: readonly DailyBar[],
  sessionDate: string,
  count: number,
): DailyBar[] {
  return bars.filter((bar) => bar.sessionDate > sessionDate).slice(0, count);
}

function next1dReturn(
  bars: readonly DailyBar[],
  sessionDate: string,
): number | null {
  const t = bars.find((bar) => bar.sessionDate === sessionDate);
  const next = nextSessionBars(bars, sessionDate, 1)[0];
  if (!t || !next || t.close <= 0) return null;
  return next.close / t.close - 1;
}

/** Peak-to-trough max drawdown over t plus the next three trading sessions. */
function next3SessionMaxDrawdown(
  bars: readonly DailyBar[],
  sessionDate: string,
): number | null {
  const t = bars.find((bar) => bar.sessionDate === sessionDate);
  const next = nextSessionBars(bars, sessionDate, 3);
  if (!t || next.length < 3 || t.close <= 0) return null;
  const closes = [t.close, ...next.map((bar) => bar.close)];
  let peak = closes[0]!;
  let mdd = 0;
  for (const close of closes) {
    if (close > peak) peak = close;
    const drawdown = close / peak - 1;
    if (drawdown < mdd) mdd = drawdown;
  }
  return mdd;
}

function scoreFromContributions(
  contributions: readonly { readonly id: string; readonly score: number }[],
  id: RiskV1FactorId,
): number | null {
  return contributions.find((row) => row.id === id)?.score ?? null;
}

/**
 * Display-only peek of the same factor scores/weights deriveRiskDecisionV1
 * collects before the <45 coverage withhold. Scoring math is unchanged;
 * withheld results clear factorContributions, so the table still needs these.
 */
function peekFactorTable(input: {
  readonly driver: DominantDriver | null;
  readonly spyBreadth: RiskDecisionSpyBreadthInput;
  readonly spyGamma: RiskDecisionSpyGammaInput;
  readonly eventGate: EventGateSnapshot | null;
  readonly targetSession: string;
}): {
  readonly scores: Record<RiskV1FactorId, number | null>;
  readonly effectiveWeight: number;
} {
  const scores: Record<RiskV1FactorId, number | null> = {
    breadth: null,
    macro: null,
    vol: null,
    gamma: null,
    event_gate: null,
  };
  let effectiveWeight = 0;
  const staleMul = 0.5;
  const partialMul = 0.75;

  if (input.spyBreadth.breadthSignalStatus === "available") {
    const signal = input.spyBreadth.breadthSignal;
    const score =
      signal === "strong" ? 25 : signal === "mixed" ? 50 : signal === "weak" ? 80 : null;
    if (score !== null) {
      scores.breadth = score;
      effectiveWeight += 25 * (input.spyBreadth.stale ? staleMul : 1);
    }
  }

  const driver = input.driver;
  const macroUnavailable =
    !driver ||
    driver.riskDirection === null ||
    driver.primaryRegime === "insufficient_data" ||
    driver.primaryRegime === "mixed_unresolved" ||
    driver.primaryRegime === "single_asset_shock";
  if (!macroUnavailable && driver) {
    const score =
      driver.riskDirection === "risk_on"
        ? 25
        : driver.riskDirection === "mixed"
          ? 55
          : driver.riskDirection === "risk_off"
            ? 80
            : null;
    if (score !== null) {
      scores.macro = score;
      const stale =
        driver.marketSessionDate !== input.targetSession ||
        driver.sessionAlignment !== "aligned";
      effectiveWeight += 25 * (stale ? staleMul : 1);
    }
  }

  const vol = input.spyGamma.volMispricing;
  if (vol.status === "available" && vol.signal !== null) {
    const score =
      vol.signal === "vol_underpriced"
        ? 30
        : vol.signal === "balanced"
          ? 50
          : vol.signal === "vol_expensive"
            ? 75
            : null;
    if (score !== null) {
      scores.vol = score;
      effectiveWeight += 15 * (input.spyGamma.freshness === "stale" ? staleMul : 1);
    }
  }

  if (
    input.spyGamma.regime !== null &&
    (input.spyGamma.status === "ready" || input.spyGamma.status === "incomplete")
  ) {
    const regime = input.spyGamma.regime;
    const score =
      regime === "positive"
        ? 25
        : regime === "near_zero"
          ? 50
          : regime === "negative"
            ? 75
            : null;
    if (score !== null) {
      scores.gamma = score;
      const mul =
        input.spyGamma.freshness === "stale"
          ? staleMul
          : input.spyGamma.status === "incomplete" ||
              input.spyGamma.freshness === "incomplete"
            ? partialMul
            : 1;
      effectiveWeight += 15 * mul;
    }
  }

  if (input.eventGate && input.eventGate.status !== "unavailable") {
    const state = input.eventGate.state;
    const score =
      state === "clear"
        ? 15
        : state === "scheduled_risk"
          ? 60
          : state === "active_shock"
            ? 90
            : null;
    if (score !== null) {
      scores.event_gate = score;
      effectiveWeight += 10 * (input.eventGate.stale ? staleMul : 1);
    }
  }

  return {
    scores,
    effectiveWeight: Math.round(Math.min(100, Math.max(0, effectiveWeight))),
  };
}

async function loadSameSessionBreadth(
  dataRoot: string,
  sessionDate: string,
): Promise<{
  readonly input: ReturnType<typeof breadthToRiskInput>;
  readonly missing: boolean;
  readonly note: string | null;
}> {
  const store = createFilesystemBreadthSnapshotStore({
    dataRoot,
    universeId: SPY_BREADTH_CONFIG.universeId,
    fundSymbol: SPY_BREADTH_CONFIG.fundSymbol,
  });
  const stored = await store.readSnapshotBySessionDate(sessionDate);
  if (!stored) {
    return {
      input: breadthToRiskInput(
        summarizeSpyBreadthFromDurable({
          snapshot: null,
          sourceArtifact: null,
          missingReason: `No SPY breadth snapshot for ${sessionDate}.`,
        }, false),
      ),
      missing: true,
      note: "breadth missing",
    };
  }
  if (!isCurrentBreadthInternalsSnapshot(stored)) {
    return {
      input: breadthToRiskInput(
        summarizeSpyBreadthFromDurable({
          snapshot: null,
          sourceArtifact: null,
          missingReason: `SPY breadth snapshot for ${sessionDate} is not current schema.`,
        }, false),
      ),
      missing: true,
      note: "breadth schema not current",
    };
  }
  if (stored.marketSessionDate !== sessionDate) {
    return {
      input: breadthToRiskInput(
        summarizeSpyBreadthFromDurable({
          snapshot: null,
          sourceArtifact: null,
          missingReason: `SPY breadth snapshot session ${stored.marketSessionDate} != ${sessionDate}.`,
        }, false),
      ),
      missing: true,
      note: "breadth session mismatch",
    };
  }
  return {
    input: breadthToRiskInput(
      summarizeSpyBreadthFromDurable({
        snapshot: stored,
        sourceArtifact: `data/breadth/${SPY_BREADTH_CONFIG.universeId}/snapshots`,
        missingReason: null,
      }, false),
    ),
    missing: false,
    note: null,
  };
}

function loadSameSessionEventGate(
  dataRoot: string,
  sessionDate: string,
): {
  readonly eventGate: ReturnType<typeof buildEventGate> | null;
  readonly missing: boolean;
  readonly note: string | null;
} {
  const generatedAt = sessionCloseGeneratedAt(sessionDate);
  const now = new Date(generatedAt);
  const feed = loadCatalystFeed(
    {},
    { publicDemo: false, now, dataRoot },
  );
  if (feed.mode === "live_unavailable" || feed.mode === "stale_calendar") {
    return {
      eventGate: null,
      missing: true,
      note: `event_gate missing (${feed.mode})`,
    };
  }
  const eventGate = buildEventGate({
    feed,
    targetMarketSessionDate: sessionDate,
    generatedAt,
    publicDemo: false,
  });
  if (eventGate.status === "unavailable") {
    return {
      eventGate: null,
      missing: true,
      note: eventGate.missingReason ?? "event_gate unavailable",
    };
  }
  return { eventGate, missing: false, note: null };
}

export async function listRiskHistoryReplayDates(
  dataRoot: string,
): Promise<string[]> {
  const store = createFilesystemRuntimeJsonStore({ dataRoot });
  const snapshots = await listManualGammaSnapshots(store);
  const dates = new Set<string>([
    ...RISK_HISTORY_PRIORITY_DATES,
    ...tradingSessionsInRange(
      RISK_HISTORY_BACKFILL_START,
      RISK_HISTORY_BACKFILL_END,
    ),
  ]);
  for (const snapshot of snapshots) {
    dates.add(snapshot.marketSessionDate);
  }
  const gammaDir = join(dataRoot, "manual-gamma");
  if (existsSync(gammaDir)) {
    for (const name of readdirSync(gammaDir)) {
      const match = name.match(/^(\d{4}-\d{2}-\d{2})\.json$/);
      if (match) dates.add(match[1]!);
    }
  }
  return [...dates].sort((left, right) => left.localeCompare(right));
}

export async function replayRiskHistoryForDate(
  sessionDate: string,
  options: ReplayRiskHistoryOptions,
): Promise<RiskHistoryReplayRow> {
  const dataRoot = options.dataRoot;
  const notes: string[] = [];
  const spyBars = loadUniverseBars(dataRoot, "SPY");
  const qqqBars = loadUniverseBars(dataRoot, "QQQ");

  const driverResult = loadSessionDriver(sessionDate, dataRoot);
  const driver = driverResult.driver;
  if (!driver) notes.push("macro missing");

  const breadth = await loadSameSessionBreadth(dataRoot, sessionDate);
  if (breadth.note) notes.push(breadth.note);

  const store = createFilesystemRuntimeJsonStore({ dataRoot });
  const gammaSnapshot: ManualGammaSnapshot | null =
    await loadManualGammaSnapshot(store, sessionDate);
  let spyGamma = UNAVAILABLE_GAMMA;
  let spyGammaSummary: OpportunityGammaInput | null = null;
  let qqqGammaSummary: OpportunityGammaInput | null = null;
  if (!gammaSnapshot) {
    notes.push("gamma missing");
    notes.push("vol missing (no same-session manual gamma IV)");
  } else {
    const hv20Bars = barsThroughSession(spyBars, sessionDate);
    const qqqHv20Bars = barsThroughSession(qqqBars, sessionDate);
    spyGammaSummary = buildManualGammaSummary({
      snapshot: gammaSnapshot,
      symbol: "SPY",
      hv20Bars,
    });
    qqqGammaSummary = buildManualGammaSummary({
      snapshot: gammaSnapshot,
      symbol: "QQQ",
      hv20Bars: qqqHv20Bars,
    });
    spyGamma = gammaToRiskInput(spyGammaSummary);
    if (spyGamma.volMispricing.status !== "available") {
      notes.push("vol missing (IV/HV not aligned for session)");
    }
  }

  const event = loadSameSessionEventGate(dataRoot, sessionDate);
  if (event.note) notes.push(event.note);

  const result = deriveRiskDecisionV1({
    driver,
    spyBreadth: breadth.input,
    spyGamma,
    eventGate: event.eventGate,
    targetSession: sessionDate,
  });

  const peeked = peekFactorTable({
    driver,
    spyBreadth: breadth.input,
    spyGamma,
    eventGate: event.eventGate,
    targetSession: sessionDate,
  });

  const factorScores =
    result.status === "ready"
      ? {
          breadth: scoreFromContributions(result.factorContributions, "breadth"),
          macro: scoreFromContributions(result.factorContributions, "macro"),
          vol: scoreFromContributions(result.factorContributions, "vol"),
          gamma: scoreFromContributions(result.factorContributions, "gamma"),
          event_gate: scoreFromContributions(result.factorContributions, "event_gate"),
        }
      : peeked.scores;

  const missingFactors = RISK_V1_FACTOR_IDS.filter((id) => factorScores[id] === null);
  if (driver && factorScores.macro === null) {
    notes.push(
      `macro loaded but not used (${driver.primaryRegime})`,
    );
  }

  const opportunity = deriveOpportunityScoreV2({
    spyGamma: spyGammaSummary,
    qqqGamma: qqqGammaSummary,
    breadth: breadth.input,
    eventGate: event.eventGate,
  });

  const vol = spyGamma.volMispricing;
  const trendSnapshot: RiskTrendSnapshot = {
    sessionDate,
    riskScore: result.riskScore,
    breadthSignal:
      breadth.input.breadthSignalStatus === "available"
        ? breadth.input.breadthSignal
        : null,
    advancingPct: breadth.input.advancingPct ?? null,
    macroScore: factorScores.macro,
    macroDirection:
      factorScores.macro === null
        ? null
        : driver?.riskDirection === "risk_on" ||
            driver?.riskDirection === "mixed" ||
            driver?.riskDirection === "risk_off"
          ? driver.riskDirection
          : null,
    gammaRegime: spyGamma.regime,
    volSignal:
      vol.status === "available" &&
      (vol.signal === "vol_underpriced" ||
        vol.signal === "balanced" ||
        vol.signal === "vol_expensive")
        ? vol.signal
        : null,
    volSpread: vol.status === "available" ? vol.spreadVolPts : null,
  };

  return {
    date: sessionDate,
    status: result.status,
    riskScore: result.riskScore,
    stance: result.stance,
    factorScores,
    missingFactors,
    effectiveCoverage:
      result.coverage?.effectiveWeight ??
      (result.status === "withheld" ? peeked.effectiveWeight : null),
    spyNext1dReturn: next1dReturn(spyBars, sessionDate),
    qqqNext1dReturn: next1dReturn(qqqBars, sessionDate),
    spyNext3SessionMdd: next3SessionMaxDrawdown(spyBars, sessionDate),
    qqqNext3SessionMdd: next3SessionMaxDrawdown(qqqBars, sessionDate),
    opportunityScore: opportunity.opportunityScore,
    opportunityCoverage: opportunity.coverage,
    opportunityFactors: opportunity.factors,
    opportunityMissing: opportunity.missing,
    trendSnapshot,
    riskTrend: null,
    riskTrendPriorDate: null,
    riskTrendReasons: [],
    positioning: null,
    notes,
  };
}

export async function replayRiskHistory(
  options: ReplayRiskHistoryOptions,
): Promise<readonly RiskHistoryReplayRow[]> {
  const requested =
    options.dates && options.dates.length > 0
      ? [...options.dates]
      : await listRiskHistoryReplayDates(options.dataRoot);
  const spyBars = loadUniverseBars(options.dataRoot, "SPY");
  const toReplay = new Set(requested);
  for (const date of requested) {
    const prior = priorCompletedSession(date, spyBars);
    if (prior) toReplay.add(prior);
  }
  const byDate = new Map<string, RiskHistoryReplayRow>();
  for (const date of [...toReplay].sort((left, right) => left.localeCompare(right))) {
    byDate.set(date, await replayRiskHistoryForDate(date, options));
  }
  return requested.map((date) => {
    const row = byDate.get(date);
    if (!row) {
      throw new Error(`Missing replay row for ${date}`);
    }
    const priorDate = priorCompletedSession(date, spyBars);
    const prior = priorDate ? (byDate.get(priorDate) ?? null) : null;
    const trend = deriveRiskTrendV2({
      current: row.trendSnapshot,
      prior: prior?.trendSnapshot ?? null,
      priorDate,
    });
    return {
      ...row,
      riskTrend: trend.trend,
      riskTrendPriorDate: trend.priorDate,
      riskTrendReasons: trend.reasons,
      positioning: derivePositioningV2({
        riskScore: row.riskScore,
        opportunityScore: row.opportunityScore,
        trend: trend.trend,
      }),
    };
  });
}

function csvCell(value: string | number | null): string {
  if (value === null) return "";
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }
  if (value.includes(",") || value.includes('"')) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

function pctCell(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "";
  return (value * 100).toFixed(4);
}

export function riskHistoryReplayToCsv(
  rows: readonly RiskHistoryReplayRow[],
): string {
  const header = [
    "date",
    "status",
    "riskScore",
    "stance",
    "breadthScore",
    "macroScore",
    "volScore",
    "gammaScore",
    "eventGateScore",
    "effectiveCoverage",
    "missingFactors",
    "spyNext1dReturnPct",
    "qqqNext1dReturnPct",
    "spyNext3SessionMddPct",
    "qqqNext3SessionMddPct",
    "opportunityScore",
    "opportunityCoverage",
    "oppDislocation",
    "oppVolStress",
    "oppBreadthWashout",
    "oppGammaConvexity",
    "oppEventRisk",
    "opportunityMissing",
    "riskTrend",
    "riskTrendPriorDate",
    "riskTrendReasons",
    "positioning",
    "notes",
  ];
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push(
      [
        csvCell(row.date),
        csvCell(row.status),
        csvCell(row.riskScore),
        csvCell(row.stance),
        csvCell(row.factorScores.breadth),
        csvCell(row.factorScores.macro),
        csvCell(row.factorScores.vol),
        csvCell(row.factorScores.gamma),
        csvCell(row.factorScores.event_gate),
        csvCell(row.effectiveCoverage),
        csvCell(row.missingFactors.join("|")),
        csvCell(pctCell(row.spyNext1dReturn)),
        csvCell(pctCell(row.qqqNext1dReturn)),
        csvCell(pctCell(row.spyNext3SessionMdd)),
        csvCell(pctCell(row.qqqNext3SessionMdd)),
        csvCell(row.opportunityScore),
        csvCell(row.opportunityCoverage),
        csvCell(
          row.opportunityFactors.find((factor) => factor.id === "dislocation")
            ?.score ?? null,
        ),
        csvCell(
          row.opportunityFactors.find((factor) => factor.id === "vol_stress")
            ?.score ?? null,
        ),
        csvCell(
          row.opportunityFactors.find((factor) => factor.id === "breadth_washout")
            ?.score ?? null,
        ),
        csvCell(
          row.opportunityFactors.find((factor) => factor.id === "gamma_convexity")
            ?.score ?? null,
        ),
        csvCell(
          row.opportunityFactors.find((factor) => factor.id === "event_risk")
            ?.score ?? null,
        ),
        csvCell(row.opportunityMissing.join("|")),
        csvCell(row.riskTrend),
        csvCell(row.riskTrendPriorDate),
        csvCell(row.riskTrendReasons.join("; ")),
        csvCell(row.positioning),
        csvCell(row.notes.join("; ")),
      ].join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

export function formatRiskHistoryReplayTable(
  rows: readonly RiskHistoryReplayRow[],
): string {
  const cols = [
    "date",
    "score",
    "stance",
    "brd",
    "mac",
    "vol",
    "gex",
    "evt",
    "cov",
    "spy1d",
    "qqq1d",
    "spy3dd",
    "qqq3dd",
    "opp",
    "missing",
  ] as const;
  const body = rows.map((row) => [
    row.date,
    row.riskScore === null ? "—" : String(row.riskScore),
    row.stance ?? row.status,
    row.factorScores.breadth === null ? "—" : String(row.factorScores.breadth),
    row.factorScores.macro === null ? "—" : String(row.factorScores.macro),
    row.factorScores.vol === null ? "—" : String(row.factorScores.vol),
    row.factorScores.gamma === null ? "—" : String(row.factorScores.gamma),
    row.factorScores.event_gate === null
      ? "—"
      : String(row.factorScores.event_gate),
    row.effectiveCoverage === null ? "—" : String(row.effectiveCoverage),
    row.spyNext1dReturn === null
      ? "—"
      : `${(row.spyNext1dReturn * 100).toFixed(2)}%`,
    row.qqqNext1dReturn === null
      ? "—"
      : `${(row.qqqNext1dReturn * 100).toFixed(2)}%`,
    row.spyNext3SessionMdd === null
      ? "—"
      : `${(row.spyNext3SessionMdd * 100).toFixed(2)}%`,
    row.qqqNext3SessionMdd === null
      ? "—"
      : `${(row.qqqNext3SessionMdd * 100).toFixed(2)}%`,
    row.opportunityScore === null ? "—" : String(row.opportunityScore),
    row.missingFactors.join("|") || "—",
  ]);
  const widths = cols.map((col, index) =>
    Math.max(col.length, ...body.map((line) => line[index]!.length)),
  );
  const fmt = (cells: readonly string[]) =>
    cells
      .map((cell, index) => cell.padEnd(widths[index]!))
      .join("  ");
  return [fmt([...cols]), ...body.map((line) => fmt(line))].join("\n");
}

export function formatOpportunityReplayTable(
  rows: readonly RiskHistoryReplayRow[],
): string {
  const cols = [
    "date",
    "opp",
    "cov",
    "disloc",
    "vol",
    "wash",
    "convex",
    "event",
    "missing",
  ] as const;
  const scoreOf = (
    row: RiskHistoryReplayRow,
    id: OpportunityV2Result["factors"][number]["id"],
  ) => {
    const factor = row.opportunityFactors.find((item) => item.id === id);
    return factor ? String(factor.score) : "—";
  };
  const body = rows.map((row) => [
    row.date,
    row.opportunityScore === null ? "—" : String(row.opportunityScore),
    row.opportunityCoverage === null ? "—" : String(row.opportunityCoverage),
    scoreOf(row, "dislocation"),
    scoreOf(row, "vol_stress"),
    scoreOf(row, "breadth_washout"),
    scoreOf(row, "gamma_convexity"),
    scoreOf(row, "event_risk"),
    row.opportunityMissing.join("|") || "—",
  ]);
  const widths = cols.map((col, index) =>
    Math.max(col.length, ...body.map((line) => line[index]!.length)),
  );
  const fmt = (cells: readonly string[]) =>
    cells
      .map((cell, index) => cell.padEnd(widths[index]!))
      .join("  ");
  return [fmt([...cols]), ...body.map((line) => fmt(line))].join("\n");
}

export function formatOpportunityReplayDetails(
  rows: readonly RiskHistoryReplayRow[],
): string {
  return rows
    .map((row) => {
      const header = `${row.date}  Opportunity ${
        row.opportunityScore === null ? "—" : row.opportunityScore
      }  coverage ${row.opportunityCoverage ?? 0}`;
      const factors =
        row.opportunityFactors.length === 0
          ? "  (no factors)"
          : row.opportunityFactors
              .map(
                (factor) =>
                  `  ${factor.id.padEnd(17)} ${String(factor.score).padStart(3)}  w=${factor.weight}  ${factor.detail}`,
              )
              .join("\n");
      const missing =
        row.opportunityMissing.length > 0
          ? `  missing: ${row.opportunityMissing.join(", ")}`
          : "";
      return [header, factors, missing].filter(Boolean).join("\n");
    })
    .join("\n\n");
}

export function formatRiskTrendReplayTable(
  rows: readonly RiskHistoryReplayRow[],
): string {
  const cols = ["date", "risk", "opp", "trend", "reasons"] as const;
  const body = rows.map((row) => [
    row.date,
    row.riskScore === null ? "—" : String(row.riskScore),
    row.opportunityScore === null ? "—" : String(row.opportunityScore),
    row.riskTrend ?? "—",
    row.riskTrendReasons.join("; ") || "—",
  ]);
  const widths = cols.map((col, index) =>
    Math.max(
      col.length,
      ...body.map((line) => (index === 4 ? 0 : line[index]!.length)),
    ),
  );
  widths[4] = Math.max(
    cols[4].length,
    ...body.map((line) => Math.min(line[4]!.length, 96)),
  );
  const fmt = (cells: readonly string[]) =>
    cells
      .map((cell, index) => cell.padEnd(widths[index]!))
      .join("  ");
  return [fmt([...cols]), ...body.map((line) => fmt(line))].join("\n");
}

export function formatPositioningReplayTable(
  rows: readonly RiskHistoryReplayRow[],
): string {
  const cols = ["date", "risk", "opp", "trend", "positioning"] as const;
  const body = rows.map((row) => [
    row.date,
    row.riskScore === null ? "—" : String(row.riskScore),
    row.opportunityScore === null ? "—" : String(row.opportunityScore),
    row.riskTrend ?? "—",
    row.positioning ?? "—",
  ]);
  const widths = cols.map((col, index) =>
    Math.max(col.length, ...body.map((line) => line[index]!.length)),
  );
  const fmt = (cells: readonly string[]) =>
    cells
      .map((cell, index) => cell.padEnd(widths[index]!))
      .join("  ");
  return [fmt([...cols]), ...body.map((line) => fmt(line))].join("\n");
}

export { RISK_DECISION_V1_MODEL_WEIGHT };
