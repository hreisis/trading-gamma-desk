import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DailyBar } from "./breadth/bars/types";
import { writeJsonAtomic } from "./atomic-write";
import {
  formatGexCompact,
  remainingRegularSessionFraction,
  type RestOfDayRange,
} from "./format-gamma";
import type {
  V2CommandCenterView,
  V2GammaSummary,
  V2SectorRotationRow,
} from "./v2-command-center";
import { formatSectorEtfLabel } from "./v2-command-center";
import { resolveLastCompletedMarketSessionDate } from "@/ai-study/session";
import { classifyEventSession } from "@/catalyst/market-context/session";

export const COMMAND_CENTER_V1_SCHEMA_VERSION = "0.1.0";

export interface CommandCenterV1GammaSnapshot {
  readonly spot: number | null;
  readonly callWall: number | null;
  readonly putWall: number | null;
  readonly gammaFlip: number | null;
  readonly dealerFlow: string | null;
  readonly netGex: number | null;
  readonly netGexLabel: string | null;
  readonly restOfDayRange: RestOfDayRange;
}

export interface CommandCenterV1BreadthSnapshot {
  readonly signal: "strong" | "mixed" | "weak" | null;
  readonly signalStatus: "available" | "unavailable";
  readonly advancingPct: number | null;
  readonly contextLine: string | null;
}

export interface CommandCenterV1CtaSnapshot {
  readonly signal: string | null;
  readonly contextLine: string | null;
}

export interface CommandCenterV1VolMispricingSnapshot {
  readonly signal: string | null;
  readonly spreadVolPts: number | null;
}

export interface CommandCenterV1SectorRotationSnapshot {
  readonly sessionDate: string | null;
  readonly stale: boolean;
  readonly leadingImproving: readonly {
    readonly symbol: string;
    readonly label: string;
    readonly rs5d: number;
  }[];
  readonly weakening: readonly {
    readonly symbol: string;
    readonly label: string;
    readonly rs5d: number;
  }[];
}

export interface CommandCenterV1DailySnapshot {
  readonly schemaVersion: string;
  readonly sessionDate: string;
  readonly generatedAt: string;
  readonly stance: V2CommandCenterView["stance"];
  readonly riskScore: number | null;
  readonly exposure: V2CommandCenterView["exposure"];
  readonly spy: CommandCenterV1GammaSnapshot;
  readonly qqq: CommandCenterV1GammaSnapshot;
  readonly breadth: CommandCenterV1BreadthSnapshot;
  readonly ctaProxy: CommandCenterV1CtaSnapshot;
  readonly volMispricing: CommandCenterV1VolMispricingSnapshot;
  readonly sectorRotation: CommandCenterV1SectorRotationSnapshot;
}

export type V2DailyReviewStatus = "ready" | "pending" | "unavailable";

export interface V2DailyReview {
  readonly status: V2DailyReviewStatus;
  readonly sessionDate: string | null;
  readonly morningStance: string | null;
  readonly actualOutcome: string;
  readonly whatWorked: readonly string[];
  readonly whatFailed: readonly string[];
  readonly tomorrowWatch: readonly string[];
  readonly missingReason: string | null;
}

function gammaSnapshotFromSummary(item: V2GammaSummary): CommandCenterV1GammaSnapshot {
  return {
    spot: item.spot,
    callWall: item.callWall,
    putWall: item.putWall,
    gammaFlip: item.gammaFlip,
    dealerFlow: item.dealerFlowRegime,
    netGex: item.netGex,
    netGexLabel: formatGexCompact(item.netGex),
    restOfDayRange: item.restOfDayRange,
  };
}

function sectorRows(
  rows: readonly V2SectorRotationRow[],
): CommandCenterV1SectorRotationSnapshot["leadingImproving"] {
  return rows.map((row) => ({
    symbol: row.symbol,
    label: formatSectorEtfLabel(row.symbol),
    rs5d: row.rs5d,
  }));
}

export function buildCommandCenterV1SnapshotFromView(
  view: V2CommandCenterView,
  generatedAt: string,
): CommandCenterV1DailySnapshot | null {
  if (!view.sessionDate || view.decisionStatus !== "ready") return null;
  return {
    schemaVersion: COMMAND_CENTER_V1_SCHEMA_VERSION,
    sessionDate: view.sessionDate,
    generatedAt,
    stance: view.stance,
    riskScore: view.riskScore,
    exposure: view.exposure,
    spy: gammaSnapshotFromSummary(view.gamma[0]),
    qqq: gammaSnapshotFromSummary(view.gamma[1]),
    breadth: {
      signal: view.spyBreadth.breadthSignal,
      signalStatus: view.spyBreadth.breadthSignalStatus,
      advancingPct: view.spyBreadth.advancingPct,
      contextLine: view.spyBreadth.breadthContextLine,
    },
    ctaProxy: {
      signal: view.ctaProxy.signal,
      contextLine: view.ctaProxy.contextLine,
    },
    volMispricing: {
      signal: view.gamma[0].volMispricing.signal,
      spreadVolPts: view.gamma[0].volMispricing.spreadVolPts,
    },
    sectorRotation: {
      sessionDate: view.sectorRotation.sessionDate,
      stale: view.sectorRotation.stale,
      leadingImproving: sectorRows(view.sectorRotation.topLeadingImproving),
      weakening: sectorRows(view.sectorRotation.bottomWeakening),
    },
  };
}

export function commandCenterV1DailyPath(
  dataRoot: string,
  sessionDate: string,
): string {
  return join(dataRoot, "command-center-v1", `${sessionDate}.json`);
}

export function commandCenterV1LatestPath(dataRoot: string): string {
  return join(dataRoot, "command-center-v1", "latest.json");
}

export function loadCommandCenterV1Daily(
  dataRoot: string,
  sessionDate: string,
): CommandCenterV1DailySnapshot | null {
  const path = commandCenterV1DailyPath(dataRoot, sessionDate);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as CommandCenterV1DailySnapshot;
    if (raw.sessionDate !== sessionDate || raw.schemaVersion !== COMMAND_CENTER_V1_SCHEMA_VERSION) {
      return null;
    }
    return raw;
  } catch {
    return null;
  }
}

/** True only during the regular US equity session (9:30–close ET), not premarket or after close. */
export function isCommandCenterV1SnapshotEligibleNow(now: Date): boolean {
  return classifyEventSession(now).eventInRegularSession;
}

export function persistCommandCenterV1Daily(
  dataRoot: string,
  snapshot: CommandCenterV1DailySnapshot,
  options: { readonly force?: boolean } = {},
): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshot.sessionDate)) return false;
  const path = commandCenterV1DailyPath(dataRoot, snapshot.sessionDate);
  if (existsSync(path) && options.force !== true) return false;
  writeJsonAtomic(path, snapshot);
  writeJsonAtomic(commandCenterV1LatestPath(dataRoot), snapshot);
  return true;
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

function formatPct(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
}

function levelTouched(
  high: number,
  low: number,
  level: number | null,
): boolean | null {
  if (level === null || !Number.isFinite(level)) return null;
  return high >= level && low <= level;
}

function rodInside(
  close: number,
  range: RestOfDayRange,
): boolean | null {
  if (
    range.status !== "available" ||
    range.lower === null ||
    range.upper === null
  ) {
    return null;
  }
  return close >= range.lower && close <= range.upper;
}

function sessionDirection(close: number, open: number): "up" | "down" | "flat" {
  const pct = ((close - open) / open) * 100;
  if (pct > 0.15) return "up";
  if (pct < -0.15) return "down";
  return "flat";
}

function stanceLabel(stance: V2CommandCenterView["stance"]): string {
  switch (stance) {
    case "buy":
      return "Buy";
    case "hold":
      return "Hold";
    case "reduce":
      return "Reduce";
    default:
      return "Awaiting";
  }
}

function buildMorningStance(snapshot: CommandCenterV1DailySnapshot): string {
  const parts = [stanceLabel(snapshot.stance)];
  if (snapshot.riskScore !== null) parts.push(`risk ${snapshot.riskScore}`);
  if (snapshot.exposure) {
    parts.push(`exposure ${snapshot.exposure.min}–${snapshot.exposure.max}%`);
  }
  return parts.join(" · ");
}

function evaluateSymbolSession(
  label: string,
  snapshot: CommandCenterV1GammaSnapshot,
  bar: DailyBar | null,
): {
  readonly summary: string;
  readonly worked: string[];
  readonly failed: string[];
  readonly watch: string[];
} {
  const worked: string[] = [];
  const failed: string[] = [];
  const watch: string[] = [];

  if (!bar) {
    return {
      summary: `${label}: session bar unavailable`,
      worked,
      failed,
      watch,
    };
  }

  const spot = snapshot.spot;
  const vsSpotPct =
    spot !== null && spot > 0 ? ((bar.close - spot) / spot) * 100 : null;
  const vsSpotText =
    vsSpotPct !== null ? ` (${formatPct(vsSpotPct)} vs morning spot ${spot})` : "";
  const summary = `${label} closed ${bar.close}${vsSpotText}`;

  const callTouched = levelTouched(bar.high, bar.low, snapshot.callWall);
  const putTouched = levelTouched(bar.high, bar.low, snapshot.putWall);
  const flipTouched = levelTouched(bar.high, bar.low, snapshot.gammaFlip);
  const insideRod = rodInside(bar.close, snapshot.restOfDayRange);

  if (callTouched === true) {
    failed.push(`${label} call wall ${snapshot.callWall} was touched intraday`);
    watch.push(`Monitor ${label} reaction at call wall ${snapshot.callWall}`);
  }
  if (putTouched === true) {
    failed.push(`${label} put wall ${snapshot.putWall} was touched intraday`);
    watch.push(`Monitor ${label} support at put wall ${snapshot.putWall}`);
  }
  if (flipTouched === true) {
    watch.push(`${label} gamma flip ${snapshot.gammaFlip} was in play`);
  }
  if (insideRod === true) {
    worked.push(`${label} close stayed inside the published ROD 90% band`);
  } else if (insideRod === false) {
    failed.push(`${label} close finished outside the published ROD 90% band`);
    watch.push(`${label} close outside ROD — reassess range at the open`);
  }

  return { summary, worked, failed, watch };
}

export function buildV2DailyReview(input: {
  readonly now: Date;
  readonly demo: boolean;
  readonly dataRoot: string | null | undefined;
  readonly equityBarsBySymbol?: ReadonlyMap<string, readonly DailyBar[]>;
}): V2DailyReview {
  if (input.demo) {
    return {
      status: "unavailable",
      sessionDate: null,
      morningStance: null,
      actualOutcome: "Daily review is not computed on the public demo path.",
      whatWorked: [],
      whatFailed: [],
      tomorrowWatch: [],
      missingReason: "Methodology preview only",
    };
  }

  const remaining = remainingRegularSessionFraction(input.now);
  const reviewSessionDate = resolveLastCompletedMarketSessionDate(input.now);

  if (remaining !== null && remaining > 0) {
    return {
      status: "pending",
      sessionDate: reviewSessionDate,
      morningStance: null,
      actualOutcome: "Review will run after the regular session close.",
      whatWorked: [],
      whatFailed: [],
      tomorrowWatch: [],
      missingReason: null,
    };
  }

  const dataRoot = input.dataRoot;
  if (!dataRoot) {
    return {
      status: "unavailable",
      sessionDate: reviewSessionDate,
      morningStance: null,
      actualOutcome: "Daily review unavailable.",
      whatWorked: [],
      whatFailed: [],
      tomorrowWatch: [],
      missingReason: "Data root not configured.",
    };
  }

  const snapshot = loadCommandCenterV1Daily(dataRoot, reviewSessionDate);
  if (!snapshot) {
    return {
      status: "unavailable",
      sessionDate: reviewSessionDate,
      morningStance: null,
      actualOutcome: "No published command center snapshot for this session.",
      whatWorked: [],
      whatFailed: [],
      tomorrowWatch: [],
      missingReason: `No intraday command center snapshot was published during the regular session on ${reviewSessionDate}.`,
    };
  }

  const spyBar = findSessionBar(input.equityBarsBySymbol, "SPY", reviewSessionDate);
  const qqqBar = findSessionBar(input.equityBarsBySymbol, "QQQ", reviewSessionDate);

  if (!spyBar) {
    return {
      status: "unavailable",
      sessionDate: reviewSessionDate,
      morningStance: buildMorningStance(snapshot),
      actualOutcome: "Session outcome unavailable — SPY daily bar missing.",
      whatWorked: [],
      whatFailed: [],
      tomorrowWatch: [],
      missingReason: `Alpaca daily bar unavailable for SPY on ${reviewSessionDate}.`,
    };
  }

  const spyEval = evaluateSymbolSession("SPY", snapshot.spy, spyBar);
  const qqqEval = evaluateSymbolSession("QQQ", snapshot.qqq, qqqBar);
  const worked = [...spyEval.worked, ...qqqEval.worked];
  const failed = [...spyEval.failed, ...qqqEval.failed];
  const watch = [...spyEval.watch, ...qqqEval.watch];

  const spyDir = sessionDirection(spyBar.close, spyBar.open);
  if (snapshot.stance === "buy" && spyDir === "up") {
    worked.push("Buy stance aligned with a positive SPY session");
  } else if (snapshot.stance === "buy" && spyDir === "down") {
    failed.push("Buy stance conflicted with a negative SPY session");
  } else if (snapshot.stance === "reduce" && spyDir === "down") {
    worked.push("Reduce stance aligned with a weaker SPY session");
  } else if (snapshot.stance === "reduce" && spyDir === "up") {
    failed.push("Reduce stance conflicted with a positive SPY session");
  }

  if (
    snapshot.breadth.signalStatus === "available" &&
    snapshot.breadth.signal
  ) {
    if (snapshot.breadth.signal === "strong" && spyDir === "up") {
      worked.push("SPY breadth strength aligned with the session outcome");
    } else if (snapshot.breadth.signal === "weak" && spyDir === "down") {
      worked.push("Weak breadth aligned with the weaker session outcome");
    } else if (
      (snapshot.breadth.signal === "strong" && spyDir === "down") ||
      (snapshot.breadth.signal === "weak" && spyDir === "up")
    ) {
      failed.push("Breadth signal conflicted with SPY session direction");
    }
  }

  if (snapshot.ctaProxy.signal) {
    if (snapshot.ctaProxy.signal === "buying" && spyDir === "up") {
      worked.push("CTA proxy buying aligned with the SPY session");
    } else if (snapshot.ctaProxy.signal === "selling" && spyDir === "down") {
      worked.push("CTA proxy selling aligned with the SPY session");
    } else if (
      (snapshot.ctaProxy.signal === "buying" && spyDir === "down") ||
      (snapshot.ctaProxy.signal === "selling" && spyDir === "up")
    ) {
      failed.push("CTA proxy conflicted with SPY session direction");
    }
  }

  if (snapshot.sectorRotation.leadingImproving.length > 0 && spyDir === "up") {
    worked.push(
      `Leadership held in ${snapshot.sectorRotation.leadingImproving
        .slice(0, 2)
        .map((row) => row.label)
        .join(", ")}`,
    );
  }
  if (snapshot.sectorRotation.weakening.length > 0 && spyDir === "down") {
    worked.push(
      `Weakness showed in ${snapshot.sectorRotation.weakening
        .slice(0, 2)
        .map((row) => row.label)
        .join(", ")}`,
    );
  }

  if (snapshot.volMispricing.signal === "vol_expensive" && spyDir === "down") {
    worked.push("Vol expensive signal aligned with a softer session");
  }

  const actualOutcome = [spyEval.summary, qqqEval.summary].join(" · ");

  const tomorrowWatch =
    watch.length > 0
      ? watch.slice(0, 3)
      : [
          "Re-check SPY/QQQ structure levels and dealer flow at the open.",
        ];

  return {
    status: "ready",
    sessionDate: reviewSessionDate,
    morningStance: buildMorningStance(snapshot),
    actualOutcome,
    whatWorked: worked.slice(0, 4),
    whatFailed: failed.slice(0, 4),
    tomorrowWatch,
    missingReason: null,
  };
}

export function maybePersistCommandCenterV1Daily(input: {
  readonly dataRoot: string | null | undefined;
  readonly view: V2CommandCenterView;
  readonly generatedAt: string;
  readonly now?: Date;
  readonly force?: boolean;
}): boolean {
  const now = input.now ?? new Date(input.generatedAt);
  if (!input.force && !isCommandCenterV1SnapshotEligibleNow(now)) {
    return false;
  }

  const snapshot = buildCommandCenterV1SnapshotFromView(input.view, input.generatedAt);
  if (!snapshot || !input.dataRoot) return false;
  return persistCommandCenterV1Daily(input.dataRoot, snapshot, {
    force: input.force === true,
  });
}
