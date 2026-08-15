import { z } from "zod";
import type { EventGateSnapshot } from "@/contracts/event-gate";
import type { FetchLike } from "@/ingest/http";
import type {
  V2AiStudyConfidence,
  V2AiStudyInterpretation,
  V2CommandCenterView,
  V2GammaSummary,
} from "@/desk/v2-command-center";
import { breadthSignalLabel, formatSectorEtfLabel } from "@/desk/v2-command-center";
import {
  ctaProxySignalLabel,
  formatGexCompact,
  formatRestOfDayRangeLabel,
  volMispricingSignalLabel,
  type CtaProxyTrendSignal,
} from "@/desk/format-gamma";
import type { AiStudyLlmRuntimeConfig } from "./config";
import {
  describeAiStudyLlmModelSource,
  describeMissingAiStudyLlmEnv,
  OPENAI_RESPONSES_URL,
  openAiResponsesReasoningEffort,
} from "./config";
import { extractOutputText } from "./openai-utils";

export const V2_COMMAND_AI_STUDY_PROMPT_VERSION = "0.2.0";
export const V2_COMMAND_AI_STUDY_MAX_OUTPUT_TOKENS = 480;
export const V2_AI_STUDY_INPUT_TOPIC_COUNT = 8;

export interface V2AiStudyPayload {
  readonly promptVersion: string;
  readonly sessionDate: string | null;
  readonly decision?: {
    readonly stance: string | null;
    readonly riskScore: number | null;
    readonly riskChange: number | null;
    readonly exposure: { readonly min: number; readonly max: number } | null;
    readonly opportunityScore: number | null;
  };
  readonly macro?: {
    readonly label: string;
    readonly primaryRegime?: string;
    readonly riskDirection?: string | null;
    readonly marketSessionDate?: string | null;
    readonly interpretation?: string | null;
    readonly evidence?: readonly string[];
  };
  readonly eventGate?: {
    readonly state: string;
    readonly headline: string | null;
    readonly stale: boolean;
  };
  readonly spyGamma?: Record<string, unknown>;
  readonly qqqGamma?: Record<string, unknown>;
  readonly breadth?: {
    readonly signal: string;
    readonly percentAboveMa20: number | null;
    readonly percentAboveMa50: number | null;
    readonly stale: boolean;
    readonly marketSessionDate?: string | null;
  };
  readonly ctaProxy?: {
    readonly signal: string;
    readonly context: string | null;
  };
  readonly volMispricing?: {
    readonly spySignal: string;
    readonly ivMinusHvVolPts: number | null;
  };
  readonly sectorRotation?: {
    readonly sessionDate: string | null;
    readonly stale: boolean;
    readonly leadingImproving: readonly {
      readonly symbol: string;
      readonly label: string;
      readonly rs1d: number;
      readonly rs5d: number;
      readonly classification: string;
    }[];
    readonly weakening: readonly {
      readonly symbol: string;
      readonly label: string;
      readonly rs1d: number;
      readonly rs5d: number;
      readonly classification: string;
    }[];
  };
  readonly dataQuality: {
    readonly interpretationConfidence: V2AiStudyConfidence;
    readonly limitations: readonly string[];
    readonly missingTopics: readonly string[];
  };
}

export const V2AiStudyLlmOutputSchema = z.object({
  regime: z.string().min(1).max(320),
  base_case: z.string().min(1).max(320),
  if_then: z.string().min(1).max(320),
  invalidation: z.string().min(1).max(320),
  tension: z.string().min(1).max(280),
});

export const V2_COMMAND_AI_STUDY_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["regime", "base_case", "if_then", "invalidation", "tension"],
  properties: {
    regime: { type: "string" },
    base_case: { type: "string" },
    if_then: { type: "string" },
    invalidation: { type: "string" },
    tension: { type: "string" },
  },
} as const;

export const V2_COMMAND_AI_STUDY_SYSTEM_PROMPT = `You are GammaDesk Command Center AI Study — a constrained trading-research copilot over existing deterministic model outputs.

Output five fields (1–2 short sentences each):
- regime: current market regime from macro, gamma, breadth, CTA, vol, sector rotation, and risk stance — only topics present in the payload.
- base_case: the most defensible setup from aligned signals; no probabilities or invented price targets.
- if_then: 1–2 conditional paths using observable levels/signals from the payload — prefer falsifiable state transitions (not the current state).
- invalidation: 1–2 concrete observable conditions that would invalidate or materially change the base case — never list conditions already true at current spot/signals.
- tension: strongest disagreement between current signals (e.g. stabilizing dealer flow vs narrow participation).

Gamma structure semantics (compare spyGamma.spot vs gammaFlip, callWall, putWall before writing if_then or invalidation):
- Above gamma flip → more stabilizing / mean-reverting dealer-flow context; below gamma flip → amplification / trend / vol-expansion risk rises.
- Sustained break and hold above call wall → upside chase / hedge pressure may rise — do NOT imply mean reversion.
- Sustained break and hold below put wall → downside instability / support removal — do NOT treat as neutral.
- Use transitions: "If spot crosses from above flip to below…", "If spot breaks and holds above call wall…", "If breadth improves from Mixed to Strong…", "If dealer flow shifts from stabilizing to amplifying…".
- Do not use "loses flip" when spot is already below flip; do not use "below put wall" as invalidation when spot is already below put wall; do not use "reclaims flip" as invalidation when spot is already above flip.

Rules:
- Use ONLY fields in the user JSON payload. Do not invent prices, levels, probabilities, catalysts, sectors, or signals.
- dataQuality.interpretationConfidence is pre-computed — do NOT output your own confidence score.
- When dataQuality.limitations is non-empty, qualify stale or incomplete inputs in regime/base_case (never describe them as live/current).
- When dataQuality.interpretationConfidence is "limited", keep language conditional; avoid strong directional claims.
- Macro interpretation and evidence describe completed-session closes — never frame them as intraday moves unless payload explicitly marks live.
- Do not recalculate or override Risk, Gamma, exposure, allocation, wall touch, ROD, breadth, CTA, or sector rotation.
- If a topic is in dataQuality.missingTopics or absent from the payload, omit it — do not guess.
- Gamma describes structure/amplification context, not a standalone buy/sell call.
- Use exact gamma levels (spot, putWall, callWall, gammaFlip) from the payload when referencing structure.
- No trade advice, position sizing, or fabricated event detail.`;

function gammaPayload(item: V2GammaSummary): Record<string, unknown> | null {
  if (item.status === "unavailable") return null;
  const out: Record<string, unknown> = { symbol: item.symbol };
  if (item.regime) out.regime = item.regime;
  if (item.dealerFlowRegime) out.dealerFlow = item.dealerFlowRegime;
  if (item.sessionDate) out.sessionDate = item.sessionDate;
  if (item.dataLabel) out.dataLabel = item.dataLabel;
  if (item.status === "incomplete") out.incomplete = true;
  if (item.spot !== null) out.spot = item.spot;
  if (item.putWall !== null) out.putWall = item.putWall;
  if (item.callWall !== null) out.callWall = item.callWall;
  if (item.gammaFlip !== null) out.gammaFlip = item.gammaFlip;
  if (item.netGex !== null) out.netGex = formatGexCompact(item.netGex);
  if (item.restOfDayRange.status === "available") {
    out.restOfDayRange = formatRestOfDayRangeLabel(item.restOfDayRange);
  }
  if (item.freshness === "stale") {
    out.stale = true;
  }
  return out;
}

function macroPayload(view: V2CommandCenterView): V2AiStudyPayload["macro"] | undefined {
  const macro = view.macroSummary;
  if (!macro) return undefined;
  return {
    label: macro.label,
    ...(macro.primaryRegime ? { primaryRegime: macro.primaryRegime } : {}),
    ...(macro.riskDirection !== null ? { riskDirection: macro.riskDirection } : {}),
    ...(macro.marketSessionDate
      ? { marketSessionDate: macro.marketSessionDate }
      : {}),
    ...(macro.interpretation ? { interpretation: macro.interpretation } : {}),
    ...(macro.evidence.length > 0 ? { evidence: macro.evidence } : {}),
  };
}

function listMissingPayloadTopics(
  payload: Omit<V2AiStudyPayload, "dataQuality">,
): string[] {
  const missing: string[] = [];
  if (!payload.macro) missing.push("macro");
  if (!payload.spyGamma) missing.push("spyGamma");
  if (!payload.qqqGamma) missing.push("qqqGamma");
  if (!payload.breadth) missing.push("breadth");
  if (!payload.ctaProxy) missing.push("ctaProxy");
  if (!payload.volMispricing) missing.push("volMispricing");
  if (!payload.sectorRotation) missing.push("sectorRotation");
  if (!payload.eventGate) missing.push("eventGate");
  return missing;
}

/** Deterministic interpretation confidence from payload coverage and freshness only. */
export function deriveV2AiStudyDataQuality(
  view: V2CommandCenterView,
  payload: Omit<V2AiStudyPayload, "dataQuality">,
): V2AiStudyPayload["dataQuality"] {
  const limitations: string[] = [];
  const missingTopics = listMissingPayloadTopics(payload);
  const spy = view.gamma[0];
  const qqq = view.gamma[1];

  if (spy.status === "incomplete" || spy.freshness === "incomplete") {
    const label = spy.dataLabel ?? `session ${spy.sessionDate ?? "—"}`;
    limitations.push(
      `SPY gamma based on ${label} bounded options snapshot (incomplete chain)`,
    );
  } else if (spy.freshness === "stale" && spy.sessionDate) {
    limitations.push(
      `SPY gamma based on ${spy.dataLabel ?? spy.sessionDate} bounded options snapshot`,
    );
  }

  if (qqq.status === "incomplete" || qqq.freshness === "incomplete") {
    limitations.push(
      `QQQ gamma chain incomplete (${qqq.dataLabel ?? qqq.sessionDate ?? "dated snapshot"})`,
    );
  }

  if (view.spyBreadth.stale && view.spyBreadth.marketSessionDate) {
    limitations.push(`Breadth is dated (${view.spyBreadth.marketSessionDate} session)`);
  }

  if (view.sectorRotation.stale && view.sectorRotation.sessionDate) {
    limitations.push(
      `Sector rotation dated (${view.sectorRotation.sessionDate} session)`,
    );
  }

  let interpretationConfidence: V2AiStudyConfidence = "high";

  if (view.decisionStatus !== "ready") {
    interpretationConfidence = "limited";
  } else if (
    view.spyBreadth.stale ||
    spy.freshness === "incomplete" ||
    spy.freshness === "stale" ||
    qqq.freshness === "incomplete" ||
    qqq.freshness === "stale"
  ) {
    interpretationConfidence = "moderate";
  }

  if (missingTopics.length >= 3) {
    interpretationConfidence =
      interpretationConfidence === "high" ? "moderate" : interpretationConfidence;
  }

  if (
    view.spyBreadth.stale &&
    (spy.freshness === "incomplete" ||
      spy.freshness === "stale" ||
      qqq.freshness === "incomplete")
  ) {
    interpretationConfidence = "limited";
  }

  if (!payload.macro || !payload.breadth) {
    interpretationConfidence = "limited";
  }

  if (view.missingInputs.length > 5) {
    interpretationConfidence = "limited";
  }

  return {
    interpretationConfidence,
    limitations,
    missingTopics,
  };
}

const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/g;

function maskIsoDateNumerics(text: string): string {
  return text.replace(ISO_DATE, (date) => date.replace(/\d/g, "D"));
}

function extractNumericTokens(text: string): string[] {
  const out: string[] = [];
  const masked = maskIsoDateNumerics(text);
  const re =
    /\$?-?\d{1,3}(?:,\d{3})*(?:\.\d+)?%?|\d+(?:\.\d+)?(?:\s*[-–to]+\s*\d+(?:\.\d+)?)?/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(masked)) !== null) {
    const token = match[0]!.trim();
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

function collectPayloadAllowedNumbers(payload: V2AiStudyPayload): Set<number> {
  const allowed = new Set<number>();
  const add = (value: number | null | undefined) => {
    if (value === null || value === undefined || !Number.isFinite(value)) return;
    allowed.add(value);
    allowed.add(Math.round(value * 10) / 10);
    allowed.add(Math.round(value));
  };

  if (payload.decision) {
    add(payload.decision.riskScore);
    add(payload.decision.riskChange);
    add(payload.decision.opportunityScore);
    if (payload.decision.exposure) {
      add(payload.decision.exposure.min);
      add(payload.decision.exposure.max);
    }
  }

  if (payload.breadth) {
    add(payload.breadth.percentAboveMa20);
    add(payload.breadth.percentAboveMa50);
  }

  if (payload.volMispricing) {
    add(payload.volMispricing.ivMinusHvVolPts);
  }

  const addGamma = (gamma: Record<string, unknown> | undefined) => {
    if (!gamma) return;
    add(typeof gamma.spot === "number" ? gamma.spot : null);
    add(typeof gamma.putWall === "number" ? gamma.putWall : null);
    add(typeof gamma.callWall === "number" ? gamma.callWall : null);
    add(typeof gamma.gammaFlip === "number" ? gamma.gammaFlip : null);
  };
  addGamma(payload.spyGamma);
  addGamma(payload.qqqGamma);

  if (payload.sectorRotation) {
    for (const row of [
      ...payload.sectorRotation.leadingImproving,
      ...payload.sectorRotation.weakening,
    ]) {
      add(row.rs1d);
      add(row.rs5d);
    }
  }

  return allowed;
}

function isCloseToAllowed(value: number, allowed: Set<number>): boolean {
  for (const candidate of allowed) {
    if (Math.abs(candidate - value) <= 1.5) return true;
  }
  return false;
}

function collectAllowedSectorTokens(payload: V2AiStudyPayload): Set<string> {
  const tokens = new Set<string>();
  if (!payload.sectorRotation) return tokens;
  for (const row of [
    ...payload.sectorRotation.leadingImproving,
    ...payload.sectorRotation.weakening,
  ]) {
    tokens.add(row.symbol);
    tokens.add(row.label);
    tokens.add(row.label.split(" · ")[0] ?? row.label);
  }
  return tokens;
}

/** Reject LLM output that cites price levels or sectors outside the payload. */
export function validateV2AiStudyLlmGrounding(
  parsed: z.infer<typeof V2AiStudyLlmOutputSchema>,
  payload: V2AiStudyPayload,
): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  const allowedNumbers = collectPayloadAllowedNumbers(payload);
  const allowedSectors = collectAllowedSectorTokens(payload);
  const texts = [
    parsed.regime,
    parsed.base_case,
    parsed.if_then,
    parsed.invalidation,
    parsed.tension,
  ];
  const fullText = texts.join(" ");

  if (/\b(probability|likely|chance of|%\s*chance)\b/i.test(fullText)) {
    return { ok: false, reason: "probability language not supported in payload" };
  }

  if (payload.dataQuality.interpretationConfidence === "limited") {
    if (
      /\b(will rally|will fall|will break|guaranteed|definitely|bullish breakout|bearish breakdown|imminent crash|sure to)\b/i.test(
        fullText,
      )
    ) {
      return {
        ok: false,
        reason: "strong directional language not allowed when confidence is limited",
      };
    }
  }

  for (const token of extractNumericTokens(fullText)) {
    const normalized = normalizeNumToken(token);
    if (!normalized || /^\d{4}$/.test(normalized)) continue;
    const value = Number(normalized.replace(/%$/, ""));
    if (!Number.isFinite(value)) continue;
    if (value >= 80 && value <= 2000 && !isCloseToAllowed(value, allowedNumbers)) {
      return { ok: false, reason: `unsupported price or level ${token}` };
    }
  }

  const sectorMatches = fullText.match(/\bXL[A-Z]{1,2}\b/g) ?? [];
  for (const symbol of sectorMatches) {
    if (!allowedSectors.has(symbol)) {
      return { ok: false, reason: `unsupported sector symbol ${symbol}` };
    }
  }

  if (payload.eventGate?.headline) {
    const headline = payload.eventGate.headline;
    if (
      fullText.toLowerCase().includes("employment") &&
      !headline.toLowerCase().includes("employment")
    ) {
      return { ok: false, reason: "catalyst not present in eventGate payload" };
    }
  } else if (/\b(employment|cpi|fomc|payrolls)\b/i.test(fullText)) {
    return { ok: false, reason: "event catalyst cited without eventGate payload" };
  }

  return { ok: true };
}

function withInterpretationMeta(
  interpretation: Omit<V2AiStudyInterpretation, "confidence" | "dataLimitations">,
  dataQuality: V2AiStudyPayload["dataQuality"],
): V2AiStudyInterpretation {
  return {
    ...interpretation,
    confidence: dataQuality.interpretationConfidence,
    dataLimitations: dataQuality.limitations,
  };
}

export function buildV2AiStudyPayload(
  view: V2CommandCenterView,
  eventGate: EventGateSnapshot | null,
): V2AiStudyPayload {
  const macro = macroPayload(view);
  const payload = {
    promptVersion: V2_COMMAND_AI_STUDY_PROMPT_VERSION,
    sessionDate: view.sessionDate,
    decision: {
      stance: view.stance,
      riskScore: view.riskScore,
      riskChange: view.riskChange,
      exposure: view.exposure,
      opportunityScore: view.opportunityScore,
    },
    ...(macro ? { macro } : {}),
    ...(eventGate && eventGate.status !== "unavailable"
      ? {
          eventGate: {
            state: eventGate.state,
            headline: eventGate.activeEvents[0]?.headline ?? null,
            stale: eventGate.stale,
          },
        }
      : {}),
    ...(gammaPayload(view.gamma[0]) ? { spyGamma: gammaPayload(view.gamma[0]) } : {}),
    ...(gammaPayload(view.gamma[1]) ? { qqqGamma: gammaPayload(view.gamma[1]) } : {}),
    ...(view.spyBreadth.breadthSignalStatus === "available"
      ? {
          breadth: {
            signal: view.spyBreadth.breadthSignal ?? "unavailable",
            percentAboveMa20: view.spyBreadth.percentAboveMA20,
            percentAboveMa50: view.spyBreadth.percentAboveMA50,
            stale: view.spyBreadth.stale,
            ...(view.spyBreadth.marketSessionDate
              ? { marketSessionDate: view.spyBreadth.marketSessionDate }
              : {}),
          },
        }
      : {}),
    ...(view.ctaProxy.status === "available" && view.ctaProxy.signal
      ? {
          ctaProxy: {
            signal: view.ctaProxy.signal,
            context: view.ctaProxy.contextLine,
          },
        }
      : {}),
    ...(view.gamma[0].volMispricing.status === "available" &&
    view.gamma[0].volMispricing.signal
      ? {
          volMispricing: {
            spySignal: view.gamma[0].volMispricing.signal,
            ivMinusHvVolPts: view.gamma[0].volMispricing.spreadVolPts,
          },
        }
      : {}),
    ...(view.sectorRotation.status === "available"
      ? {
          sectorRotation: {
            sessionDate: view.sectorRotation.sessionDate,
            stale: view.sectorRotation.stale,
            leadingImproving: view.sectorRotation.topLeadingImproving.map((row) => ({
              symbol: row.symbol,
              label: formatSectorEtfLabel(row.symbol),
              rs1d: row.rs1d,
              rs5d: row.rs5d,
              classification: row.classification,
            })),
            weakening: view.sectorRotation.bottomWeakening.map((row) => ({
              symbol: row.symbol,
              label: formatSectorEtfLabel(row.symbol),
              rs1d: row.rs1d,
              rs5d: row.rs5d,
              classification: row.classification,
            })),
          },
        }
      : {}),
  };

  const dataQuality = deriveV2AiStudyDataQuality(
    view,
    payload as Omit<V2AiStudyPayload, "dataQuality">,
  );

  return {
    ...payload,
    dataQuality,
  } as V2AiStudyPayload;
}

/** Counts available AI Study payload topics (macro, gammas, breadth, CTA, vol, rotation, event gate). */
export function summarizeV2AiStudyInputCoverage(
  view: V2CommandCenterView,
  eventGate: EventGateSnapshot | null,
): { readonly available: number; readonly total: number } {
  const missingTopics = buildV2AiStudyPayload(view, eventGate).dataQuality.missingTopics;
  return {
    available: V2_AI_STUDY_INPUT_TOPIC_COUNT - missingTopics.length,
    total: V2_AI_STUDY_INPUT_TOPIC_COUNT,
  };
}

/** Verifies AI Study payload mirrors the command center view (same source fields). */
export function verifyV2AiStudyPayloadAlignsWithView(
  view: V2CommandCenterView,
  payload: V2AiStudyPayload,
  eventGate: EventGateSnapshot | null = null,
): { readonly ok: true } | { readonly ok: false; readonly mismatches: string[] } {
  const mismatches: string[] = [];
  const sameValue = (expected: unknown, actual: unknown): boolean => {
    if (expected === actual) return true;
    if (expected === null || actual === null) return false;
    if (typeof expected === "object" && typeof actual === "object") {
      return JSON.stringify(expected) === JSON.stringify(actual);
    }
    return false;
  };
  const push = (field: string, expected: unknown, actual: unknown) => {
    const norm = (value: unknown) => (value === undefined ? null : value);
    if (!sameValue(norm(expected), norm(actual))) {
      mismatches.push(
        `${field}: payload ${JSON.stringify(actual)} vs view ${JSON.stringify(expected)}`,
      );
    }
  };

  push("sessionDate", view.sessionDate, payload.sessionDate);
  push("stance", view.stance, payload.decision?.stance);
  push("riskScore", view.riskScore, payload.decision?.riskScore);
  push("riskChange", view.riskChange, payload.decision?.riskChange);
  push("opportunityScore", view.opportunityScore, payload.decision?.opportunityScore);
  push("exposure", view.exposure, payload.decision?.exposure);

  const spy = view.gamma[0];
  const spyPayload = payload.spyGamma;
  if (spy.status === "unavailable" && spyPayload) {
    mismatches.push("spyGamma: payload present but SPY gamma unavailable on view");
  } else if (spy.status !== "unavailable") {
    const rebuiltSpy = gammaPayload(spy);
    if (!spyPayload && rebuiltSpy) {
      mismatches.push("spyGamma: missing from payload");
    } else if (spyPayload && rebuiltSpy) {
      for (const key of Object.keys(rebuiltSpy)) {
        push(`spyGamma.${key}`, rebuiltSpy[key], spyPayload[key]);
      }
    }
  }

  const qqq = view.gamma[1];
  const qqqPayload = payload.qqqGamma;
  if (qqq.status === "unavailable" && qqqPayload) {
    mismatches.push("qqqGamma: payload present but QQQ gamma unavailable on view");
  } else if (qqq.status !== "unavailable") {
    const rebuiltQqq = gammaPayload(qqq);
    if (!qqqPayload && rebuiltQqq) {
      mismatches.push("qqqGamma: missing from payload");
    } else if (qqqPayload && rebuiltQqq) {
      for (const key of Object.keys(rebuiltQqq)) {
        push(`qqqGamma.${key}`, rebuiltQqq[key], qqqPayload[key]);
      }
    }
  }

  if (view.spyBreadth.breadthSignalStatus === "available") {
    push(
      "breadth.signal",
      view.spyBreadth.breadthSignal ?? "unavailable",
      payload.breadth?.signal,
    );
    push(
      "breadth.percentAboveMa20",
      view.spyBreadth.percentAboveMA20,
      payload.breadth?.percentAboveMa20,
    );
    push(
      "breadth.percentAboveMa50",
      view.spyBreadth.percentAboveMA50,
      payload.breadth?.percentAboveMa50,
    );
    push("breadth.stale", view.spyBreadth.stale, payload.breadth?.stale);
  } else if (payload.breadth) {
    mismatches.push("breadth: payload present but breadth unavailable on view");
  }

  if (view.ctaProxy.status === "available" && view.ctaProxy.signal) {
    push("ctaProxy.signal", view.ctaProxy.signal, payload.ctaProxy?.signal);
    push("ctaProxy.context", view.ctaProxy.contextLine, payload.ctaProxy?.context);
  } else if (payload.ctaProxy) {
    mismatches.push("ctaProxy: payload present but CTA unavailable on view");
  }

  if (
    spy.volMispricing.status === "available" &&
    spy.volMispricing.signal
  ) {
    push(
      "volMispricing.spySignal",
      spy.volMispricing.signal,
      payload.volMispricing?.spySignal,
    );
    push(
      "volMispricing.ivMinusHvVolPts",
      spy.volMispricing.spreadVolPts,
      payload.volMispricing?.ivMinusHvVolPts,
    );
  } else if (payload.volMispricing) {
    mismatches.push("volMispricing: payload present but vol mispricing unavailable");
  }

  if (view.sectorRotation.status === "available") {
    push(
      "sectorRotation.sessionDate",
      view.sectorRotation.sessionDate,
      payload.sectorRotation?.sessionDate,
    );
    push(
      "sectorRotation.stale",
      view.sectorRotation.stale,
      payload.sectorRotation?.stale,
    );
  } else if (payload.sectorRotation) {
    mismatches.push("sectorRotation: payload present but rotation unavailable on view");
  }

  const macro = view.macroSummary;
  if (macro) {
    push("macro.label", macro.label, payload.macro?.label);
    push("macro.primaryRegime", macro.primaryRegime, payload.macro?.primaryRegime);
    push("macro.riskDirection", macro.riskDirection, payload.macro?.riskDirection);
    push(
      "macro.marketSessionDate",
      macro.marketSessionDate,
      payload.macro?.marketSessionDate,
    );
    push("macro.interpretation", macro.interpretation, payload.macro?.interpretation);
    push("macro.evidence", macro.evidence, payload.macro?.evidence);
  } else if (payload.macro) {
    mismatches.push("macro: payload present but macroSummary missing on view");
  }

  if (eventGate && eventGate.status !== "unavailable") {
    push("eventGate.state", eventGate.state, payload.eventGate?.state);
    push(
      "eventGate.headline",
      eventGate.activeEvents[0]?.headline ?? null,
      payload.eventGate?.headline,
    );
    push("eventGate.stale", eventGate.stale, payload.eventGate?.stale);
  } else if (payload.eventGate) {
    mismatches.push("eventGate: payload present but event gate unavailable");
  }

  return mismatches.length === 0 ? { ok: true } : { ok: false, mismatches };
}

function formatRsPct(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
}

function gammaLevel(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Spot proximity band for near-flip / near-wall structure (matches desk wall-touch tolerance). */
export const SPY_GAMMA_NEAR_LEVEL_EPS = 0.5;

export interface SpyGammaSpotPosition {
  readonly spot: number | null;
  readonly gammaFlip: number | null;
  readonly callWall: number | null;
  readonly putWall: number | null;
  readonly aboveFlip: boolean;
  readonly belowFlip: boolean;
  readonly nearFlip: boolean;
  readonly aboveCallWall: boolean;
  readonly belowCallWall: boolean;
  readonly nearCallWall: boolean;
  readonly abovePutWall: boolean;
  readonly belowPutWall: boolean;
  readonly nearPutWall: boolean;
  readonly dealerFlowStabilizing: boolean;
  readonly dealerFlowAmplifying: boolean;
}

export function deriveSpyGammaSpotPosition(
  spy: Record<string, unknown> | undefined,
): SpyGammaSpotPosition {
  const spot = gammaLevel(spy?.spot);
  const gammaFlip = gammaLevel(spy?.gammaFlip);
  const callWall = gammaLevel(spy?.callWall);
  const putWall = gammaLevel(spy?.putWall);
  const dealerFlow =
    typeof spy?.dealerFlow === "string" ? spy.dealerFlow : "";
  const regime = typeof spy?.regime === "string" ? spy.regime : "";
  const dealerFlowStabilizing =
    dealerFlow.includes("Stabilizing") || regime === "positive";
  const dealerFlowAmplifying =
    dealerFlow.includes("Amplifying") || regime === "negative";

  const emptyPosition = {
    spot,
    gammaFlip,
    callWall,
    putWall,
    aboveFlip: false,
    belowFlip: false,
    nearFlip: false,
    aboveCallWall: false,
    belowCallWall: false,
    nearCallWall: false,
    abovePutWall: false,
    belowPutWall: false,
    nearPutWall: false,
    dealerFlowStabilizing,
    dealerFlowAmplifying,
  };

  if (spot === null) {
    return emptyPosition;
  }

  const nearFlip =
    gammaFlip !== null && Math.abs(spot - gammaFlip) <= SPY_GAMMA_NEAR_LEVEL_EPS;
  const nearCallWall =
    callWall !== null && Math.abs(spot - callWall) <= SPY_GAMMA_NEAR_LEVEL_EPS;
  const nearPutWall =
    putWall !== null && Math.abs(spot - putWall) <= SPY_GAMMA_NEAR_LEVEL_EPS;

  return {
    spot,
    gammaFlip,
    callWall,
    putWall,
    nearFlip,
    aboveFlip: gammaFlip !== null && spot >= gammaFlip,
    belowFlip: gammaFlip !== null && spot < gammaFlip,
    nearCallWall,
    aboveCallWall: callWall !== null && spot > callWall,
    belowCallWall: callWall !== null && spot < callWall,
    nearPutWall,
    abovePutWall: putWall !== null && spot > putWall,
    belowPutWall: putWall !== null && spot < putWall,
    dealerFlowStabilizing,
    dealerFlowAmplifying,
  };
}

function conditionalPrefix(limited: boolean): string {
  return limited ? "may" : "can";
}

function buildGammaIfThenPathGroups(
  position: SpyGammaSpotPosition,
  limited: boolean,
): {
  readonly flipPaths: string[];
  readonly putPaths: string[];
  readonly callPaths: string[];
} {
  const may = conditionalPrefix(limited);
  const flip = position.gammaFlip;
  const callWall = position.callWall;
  const putWall = position.putWall;
  const flipPaths: string[] = [];
  const putPaths: string[] = [];
  const callPaths: string[] = [];

  if (flip !== null) {
    if (position.aboveFlip) {
      flipPaths.push(
        `If SPY spot crosses from above gamma flip ${flip} to below → amplification / vol expansion risk ${may} rise`,
      );
    } else if (position.belowFlip) {
      flipPaths.push(
        `If SPY spot reclaims and holds above gamma flip ${flip} → stabilizing / mean-reverting regime ${may} resume`,
      );
    }
  }

  if (putWall !== null) {
    if (position.belowPutWall) {
      putPaths.push(
        `If SPY reclaims and holds above put wall ${putWall} → downside flush risk ${may} ease`,
      );
    } else if (position.abovePutWall || position.nearPutWall) {
      putPaths.push(
        `If SPY breaks and holds below put wall ${putWall} → downside instability / support removal ${may} increase`,
      );
    }
  }

  if (callWall !== null) {
    if (position.belowCallWall || position.nearCallWall) {
      callPaths.push(
        `If SPY breaks and holds above call wall ${callWall} → upside chase / hedge pressure ${may} rise`,
      );
    } else if (position.aboveCallWall) {
      callPaths.push(
        `If SPY fails to hold above call wall ${callWall} → upside chase pressure ${may} ease toward the flip band`,
      );
    }
  }

  return { flipPaths, putPaths, callPaths };
}

function assembleGammaIfThenPaths(
  position: SpyGammaSpotPosition,
  limited: boolean,
): string[] {
  const { flipPaths, putPaths, callPaths } = buildGammaIfThenPathGroups(
    position,
    limited,
  );
  const paths: string[] = [...flipPaths];

  if (position.aboveCallWall && callPaths.length > 0) {
    paths.push(callPaths[0]!);
  } else if (position.belowPutWall && putPaths.length > 0) {
    paths.push(putPaths[0]!);
  } else if (putPaths.length > 0) {
    paths.push(putPaths[0]!);
  } else if (callPaths.length > 0) {
    paths.push(callPaths[0]!);
  }

  return paths.slice(0, 2);
}

function buildGammaInvalidationConditions(
  position: SpyGammaSpotPosition,
  limited: boolean,
): string[] {
  const conditions: string[] = [];
  const may = conditionalPrefix(limited);
  const flip = position.gammaFlip;
  const callWall = position.callWall;
  const putWall = position.putWall;

  if (flip !== null && position.aboveFlip) {
    conditions.push(
      `SPY spot crosses from above gamma flip ${flip} to below and holds`,
    );
  }
  if (callWall !== null && position.belowCallWall) {
    conditions.push(
      `SPY breaks and holds above call wall ${callWall} — chase / hedge pressure ${may} dominate mean-reversion base`,
    );
  }
  if (putWall !== null && position.abovePutWall) {
    conditions.push(
      `SPY breaks and holds below put wall ${putWall} — support removal ${may} invalidate stabilization`,
    );
  }
  if (position.dealerFlowStabilizing) {
    conditions.push(
      `dealer flow shifts from stabilizing to amplifying / trend-following`,
    );
  }

  return conditions;
}

function buildBreadthTransitionPaths(
  payload: V2AiStudyPayload,
  limited: boolean,
): string[] {
  const breadth = payload.breadth;
  if (!breadth?.signal || breadth.signal === "unavailable") return [];
  const may = conditionalPrefix(limited);
  const label = breadthSignalLabel(
    breadth.signal as "strong" | "mixed" | "weak",
    "available",
  );
  if (breadth.signal === "mixed") {
    return [
      `If breadth improves from ${label} to Strong → participation ${may} broaden`,
      `If breadth weakens from ${label} to Weak → narrow participation ${may} persist`,
    ];
  }
  if (breadth.signal === "weak") {
    return [`If breadth improves from ${label} to Mixed or Strong → participation ${may} broaden`];
  }
  if (breadth.signal === "strong") {
    return [`If breadth weakens from ${label} to Mixed or Weak → participation ${may} narrow`];
  }
  return [];
}

function buildBreadthInvalidationConditions(payload: V2AiStudyPayload): string[] {
  const breadth = payload.breadth;
  if (!breadth?.signal || breadth.signal === "unavailable") return [];
  const label = breadthSignalLabel(
    breadth.signal as "strong" | "mixed" | "weak",
    "available",
  );
  if (breadth.signal === "mixed" || breadth.signal === "weak") {
    return [`breadth weakens from ${label} to Weak with no breadth recovery`];
  }
  return [`breadth shifts from ${label} to Mixed or Weak`];
}

function buildRegimeFallback(payload: V2AiStudyPayload): string {
  const parts: string[] = [];
  const macro = payload.macro;
  if (macro?.label) {
    const sessionNote = macro.marketSessionDate
      ? ` · ${macro.marketSessionDate} session`
      : "";
    const labelLower = macro.label.toLowerCase();
    const riskDir =
      macro.riskDirection &&
      macro.riskDirection !== "mixed" &&
      !labelLower.includes(macro.riskDirection)
        ? ` (${macro.riskDirection} risk)`
        : macro.riskDirection === "mixed" && !labelLower.includes("mixed")
          ? " (risk mixed)"
          : "";
    parts.push(`${macro.label}${riskDir}${sessionNote}`);
  }
  const spy = payload.spyGamma;
  if (spy?.regime && typeof spy.regime === "string") {
    parts.push(`SPY ${spy.regime.replaceAll("_", " ")} gamma`);
  }
  if (spy?.dealerFlow && typeof spy.dealerFlow === "string") {
    parts.push(spy.dealerFlow);
  }
  if (payload.breadth?.signal && payload.breadth.signal !== "unavailable") {
    const stale =
      payload.breadth.stale && payload.breadth.marketSessionDate
        ? ` · dated ${payload.breadth.marketSessionDate}`
        : "";
    parts.push(
      `SPY breadth ${breadthSignalLabel(
        payload.breadth.signal as "strong" | "mixed" | "weak",
        "available",
      )}${stale}`,
    );
  }
  if (payload.volMispricing?.spySignal) {
    parts.push(
      volMispricingSignalLabel(
        payload.volMispricing.spySignal as "vol_expensive" | "vol_underpriced" | "balanced",
      ),
    );
  }
  if (payload.ctaProxy?.signal) {
    parts.push(
      `CTA proxy ${ctaProxySignalLabel(
        payload.ctaProxy.signal as CtaProxyTrendSignal,
        "available",
      )}`,
    );
  }
  const leader = payload.sectorRotation?.leadingImproving[0];
  if (leader) {
    parts.push(`${leader.label} leads 5D RS ${formatRsPct(leader.rs5d)}`);
  }
  if (payload.decision?.stance) {
    parts.push(`stance ${payload.decision.stance}`);
  }
  if (payload.dataQuality.limitations.length > 0) {
    parts.push(`data: ${payload.dataQuality.limitations[0]}`);
  }
  return parts.join("; ") || "Connected inputs are partial.";
}

function buildBaseCaseFallback(payload: V2AiStudyPayload): string {
  const parts: string[] = [];
  const limited = payload.dataQuality.interpretationConfidence === "limited";
  const spy = payload.spyGamma;

  if (payload.decision?.stance) {
    let line = `Model stance ${payload.decision.stance}`;
    if (payload.decision.riskScore !== null && payload.decision.riskScore !== undefined) {
      line += ` · risk ${payload.decision.riskScore}`;
    }
    if (payload.decision.exposure) {
      line += ` · exposure ${payload.decision.exposure.min}–${payload.decision.exposure.max}%`;
    }
    parts.push(line);
  }

  if (spy?.dealerFlow && typeof spy.dealerFlow === "string") {
    const position = deriveSpyGammaSpotPosition(spy);
    const flip = position.gammaFlip;
    if (flip !== null && position.nearFlip) {
      parts.push(`${spy.dealerFlow} with spot near gamma flip ${flip}`);
    } else if (flip !== null && position.aboveFlip) {
      parts.push(`${spy.dealerFlow} with spot above gamma flip ${flip}`);
    } else if (flip !== null && position.belowFlip) {
      parts.push(`${spy.dealerFlow} with spot below gamma flip ${flip}`);
    } else {
      parts.push(spy.dealerFlow);
    }
  } else if (spy?.regime && typeof spy.regime === "string") {
    parts.push(`SPY ${spy.regime.replaceAll("_", " ")} gamma structure`);
  }

  if (payload.macro?.label) {
    parts.push(`macro driver ${payload.macro.label}`);
  }

  if (limited) {
    parts.push("interpretation stays conditional given coverage gaps");
  }

  return parts.join(". ") || "No defensible base case from connected inputs.";
}

function buildIfThenFallback(payload: V2AiStudyPayload): string {
  const limited = payload.dataQuality.interpretationConfidence === "limited";
  const spy = payload.spyGamma;
  const position = deriveSpyGammaSpotPosition(spy);
  const paths: string[] = [
    ...assembleGammaIfThenPaths(position, limited),
    ...buildBreadthTransitionPaths(payload, limited),
  ];

  if (
    payload.eventGate?.state &&
    payload.eventGate.state !== "clear" &&
    paths.length < 2
  ) {
    const headline = payload.eventGate.headline ?? `event gate ${payload.eventGate.state}`;
    const may = conditionalPrefix(limited);
    paths.push(`If ${headline} shifts risk tone → macro mix ${may} change`);
  }
  const leader = payload.sectorRotation?.leadingImproving[0];
  if (leader && paths.length < 2) {
    paths.push(
      `If ${leader.label} RS fades from ${formatRsPct(leader.rs5d)} → cyclical leadership may narrow`,
    );
  }

  return (
    paths.slice(0, 2).join(". ") ||
    "No conditional paths from observable levels in connected inputs."
  );
}

function buildInvalidationFallback(payload: V2AiStudyPayload): string {
  const limited = payload.dataQuality.interpretationConfidence === "limited";
  const spy = payload.spyGamma;
  const position = deriveSpyGammaSpotPosition(spy);
  const conditions: string[] = [
    ...buildGammaInvalidationConditions(position, limited),
    ...buildBreadthInvalidationConditions(payload),
  ];

  if (
    payload.decision?.riskChange !== null &&
    payload.decision?.riskChange !== undefined &&
    payload.decision.riskChange > 0 &&
    conditions.length < 2
  ) {
    conditions.push(
      `portfolio risk rises further beyond prior +${payload.decision.riskChange}`,
    );
  }
  const weak = payload.sectorRotation?.weakening[0];
  if (weak && conditions.length < 2) {
    conditions.push(
      `${weak.label} RS improves from ${formatRsPct(weak.rs5d)} vs SPY — cyclical weakness ${conditionalPrefix(limited)} clear`,
    );
  }

  return (
    conditions.slice(0, 2).join("; ") ||
    "No falsifiable invalidation conditions in connected inputs."
  );
}

function buildTensionFallback(payload: V2AiStudyPayload): string {
  const tensions: string[] = [];
  const spy = payload.spyGamma;
  const position = deriveSpyGammaSpotPosition(spy);

  if (position.dealerFlowStabilizing && position.belowPutWall && position.putWall !== null) {
    tensions.push(
      `stabilizing flow with spot above flip vs spot below put wall ${position.putWall}`,
    );
  }
  if (
    position.dealerFlowStabilizing &&
    position.aboveCallWall &&
    position.callWall !== null
  ) {
    tensions.push(
      `stabilizing / mean-reverting flow vs spot above call wall ${position.callWall} (chase zone)`,
    );
  }

  if (
    spy?.dealerFlow &&
    typeof spy.dealerFlow === "string" &&
    payload.breadth?.signal &&
    payload.breadth.signal !== "unavailable"
  ) {
    const stale = payload.breadth.stale ? " (dated breadth)" : "";
    tensions.push(
      `${spy.dealerFlow} vs SPY breadth ${breadthSignalLabel(
        payload.breadth.signal as "strong" | "mixed" | "weak",
        "available",
      )}${stale}`,
    );
  }

  if (
    payload.volMispricing?.spySignal === "vol_underpriced" &&
    spy?.incomplete === true
  ) {
    tensions.push("vol underpriced vs incomplete gamma snapshot");
  } else if (
    payload.volMispricing?.spySignal === "vol_expensive" &&
    spy?.regime === "positive"
  ) {
    tensions.push("vol expensive vs positive gamma stabilization");
  }

  if (
    payload.decision?.riskChange !== null &&
    payload.decision?.riskChange !== undefined &&
    payload.decision.riskChange > 0 &&
    spy?.regime === "positive"
  ) {
    tensions.push(`positive gamma vs portfolio risk +${payload.decision.riskChange}`);
  }

  if (payload.macro?.riskDirection === "mixed" && leaderImproves(payload)) {
    tensions.push("mixed macro risk vs sector leadership");
  }

  const leader = payload.sectorRotation?.leadingImproving[0];
  const weak = payload.sectorRotation?.weakening[0];
  if (leader && weak && tensions.length < 2) {
    tensions.push(
      `${leader.label} leadership vs ${weak.label} weakening on 5D RS`,
    );
  }

  return tensions[0] ?? "No major signal disagreement flagged in connected inputs.";
}

function leaderImproves(payload: V2AiStudyPayload): boolean {
  return (payload.sectorRotation?.leadingImproving.length ?? 0) > 0;
}

export function buildV2AiStudyFallback(
  payload: V2AiStudyPayload,
): V2AiStudyInterpretation {
  const dataQuality = payload.dataQuality;

  return withInterpretationMeta(
    {
      status: "fallback",
      source: "deterministic",
      regime: buildRegimeFallback(payload),
      baseCase: buildBaseCaseFallback(payload),
      ifThen: buildIfThenFallback(payload),
      invalidation: buildInvalidationFallback(payload),
      tension: buildTensionFallback(payload),
      missingReason: null,
    },
    dataQuality,
  );
}

export function previewV2AiStudyInterpretation(): V2AiStudyInterpretation {
  return {
    status: "preview",
    source: "preview",
    confidence: "moderate",
    dataLimitations: [],
    regime:
      "Illustrative growth-led macro (risk mixed) with positive SPY gamma and stabilizing dealer flow; breadth mixed in preview.",
    baseCase:
      "Illustrative hold stance with moderate risk; structure favors mean-reversion near flip — preview payload only.",
    ifThen:
      "If SPY loses illustrative gamma flip → vol expansion risk rises. If XLK leadership fades → cyclical bid may narrow.",
    invalidation:
      "SPY sustained below illustrative put wall; breadth shifts to strong participation.",
    tension:
      "Illustrative stabilizing dealer flow vs mixed breadth; vol expensive vs positive gamma in preview.",
    missingReason: null,
  };
}

function interpretationFromLlmOutput(
  parsed: z.infer<typeof V2AiStudyLlmOutputSchema>,
  dataQuality: V2AiStudyPayload["dataQuality"],
): V2AiStudyInterpretation {
  return withInterpretationMeta(
    {
      status: "ready",
      source: "openai",
      regime: parsed.regime.trim(),
      baseCase: parsed.base_case.trim(),
      ifThen: parsed.if_then.trim(),
      invalidation: parsed.invalidation.trim(),
      tension: parsed.tension.trim(),
      missingReason: null,
    },
    dataQuality,
  );
}

function conciseOpenAiErrorMessage(status: number, rawText: string): string {
  try {
    const payload = JSON.parse(rawText) as { error?: { message?: string } };
    const message = payload.error?.message?.trim();
    if (message) {
      return message.length > 140 ? `${message.slice(0, 137)}...` : message;
    }
  } catch {
    // non-JSON error body
  }
  const trimmed = rawText.trim();
  if (!trimmed) return `HTTP ${status}`;
  return trimmed.length > 140 ? `${trimmed.slice(0, 137)}...` : trimmed;
}

function buildV2CommandAiStudyOpenAiBody(
  config: AiStudyLlmRuntimeConfig,
  userPrompt: string,
): Record<string, unknown> {
  const reasoning = openAiResponsesReasoningEffort(config.model);
  return {
    model: config.model,
    input: [
      {
        role: "system",
        content: [
          { type: "input_text", text: V2_COMMAND_AI_STUDY_SYSTEM_PROMPT },
        ],
      },
      {
        role: "user",
        content: [{ type: "input_text", text: userPrompt }],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "v2_command_ai_study",
        strict: true,
        schema: V2_COMMAND_AI_STUDY_JSON_SCHEMA,
      },
    },
    ...(reasoning ? { reasoning } : {}),
    max_output_tokens: config.maxOutputTokens,
  };
}

export async function generateV2CommandAiStudyInterpretation(input: {
  readonly payload: V2AiStudyPayload;
  readonly config: AiStudyLlmRuntimeConfig;
  readonly fetchImpl?: FetchLike;
  readonly apiUrl?: string;
  readonly env?: NodeJS.ProcessEnv;
}): Promise<V2AiStudyInterpretation> {
  const dataQuality = input.payload.dataQuality;
  const fallback = buildV2AiStudyFallback(input.payload);
  const env = input.env ?? process.env;
  const modelSource = describeAiStudyLlmModelSource(env);

  if (!input.config.apiKey) {
    const missing = describeMissingAiStudyLlmEnv(env);
    const missingVars =
      missing.length > 0 ? missing.join(", ") : "OPENAI_API_KEY";
    return {
      ...fallback,
      status: "fallback",
      source: "deterministic",
      missingReason: `${missingVars} missing — set in .env or deployment environment (${modelSource}). Deterministic summary shown.`,
    };
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const apiUrl = input.apiUrl ?? OPENAI_RESPONSES_URL;
  const userPrompt = JSON.stringify(input.payload);
  const body = buildV2CommandAiStudyOpenAiBody(input.config, userPrompt);

  const maxAttempts =
    1 + input.config.maxRetries + input.config.parseRetries;
  let lastError = "unknown error";

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.config.timeoutMs);
    try {
      const response = await fetchImpl(apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const rawText = await response.text();
      if (!response.ok) {
        lastError = `HTTP ${response.status}: ${conciseOpenAiErrorMessage(
          response.status,
          rawText,
        )}`;
        continue;
      }
      let json: unknown;
      try {
        json = JSON.parse(rawText) as unknown;
      } catch {
        lastError = "OpenAI response is not JSON";
        continue;
      }
      const text = extractOutputText(json);
      if (!text) {
        lastError = "OpenAI response missing structured output text";
        continue;
      }
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(text) as unknown;
      } catch {
        lastError = "Model output is not JSON";
        continue;
      }
      const parsed = V2AiStudyLlmOutputSchema.safeParse(parsedJson);
      if (!parsed.success) {
        lastError = `Model output schema invalid: ${parsed.error.issues[0]?.message ?? "schema"}`;
        continue;
      }
      const grounding = validateV2AiStudyLlmGrounding(parsed.data, input.payload);
      if (!grounding.ok) {
        lastError = `Grounding failed: ${grounding.reason}`;
        continue;
      }
      return interpretationFromLlmOutput(parsed.data, dataQuality);
    } catch (error: unknown) {
      if (error instanceof Error && error.name === "AbortError") {
        lastError = "OpenAI request timed out";
      } else {
        lastError = error instanceof Error ? error.message : String(error);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    ...fallback,
    status: "fallback",
    source: "deterministic",
    missingReason: `LLM unavailable (model=${input.config.model}; ${lastError}) — deterministic summary shown.`,
  };
}
