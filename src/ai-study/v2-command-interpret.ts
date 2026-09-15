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
import type { HygLqdCreditSignal } from "@/desk/hyg-lqd-credit";
import { formatHygLqdPct } from "@/desk/hyg-lqd-credit";
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

export const V2_COMMAND_AI_STUDY_PROMPT_VERSION = "0.4.3";
export const V2_COMMAND_AI_STUDY_MAX_OUTPUT_TOKENS = 900;
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
    readonly marketAction?: V2CommandCenterView["marketAction"];
    readonly riskChangeReason: string | null;
  };
  readonly qualitativeContext?: {
    readonly missingInputs: readonly string[];
    readonly previousSession: string | null;
    readonly previousRiskScore: number | null;
    readonly factorMoves: readonly {
      readonly id: string;
      readonly todayScore: number | null;
      readonly previousScore: number | null;
    }[];
    readonly spyRegime: string | null;
    readonly qqqRegime: string | null;
    readonly spyDealerFlow: string | null;
    readonly qqqDealerFlow: string | null;
    readonly riskDivergence: number | null;
    readonly gammaRegimeLabel: string | null;
    readonly breadthDivergenceLabel: string | null;
    readonly qqqVsSpy1dPct: number | null;
  };
  readonly creditHygLqd?: {
    readonly ratio: number | null;
    readonly change1dPct: number | null;
    readonly trend5dPct: number | null;
    readonly signal: string | null;
    readonly spyChange1dPct: number | null;
    readonly sessionDate: string | null;
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
    readonly advancingPct?: number | null;
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
  readonly historicalPolicy?: {
    readonly riskTrend?: string | null;
    readonly priorDate?: string | null;
    readonly trendReasons?: readonly string[];
    readonly positioning?: string | null;
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
  hidden_risk: z.string().min(1).max(320),
  reaction_quality: z.string().min(1).max(320),
  cross_asset_conflict: z.string().min(1).max(320),
  what_changed: z.string().min(1).max(320),
  what_matters_next: z.string().min(1).max(320),
});

export const V2_COMMAND_AI_STUDY_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "regime",
    "base_case",
    "if_then",
    "invalidation",
    "tension",
    "hidden_risk",
    "reaction_quality",
    "cross_asset_conflict",
    "what_changed",
    "what_matters_next",
  ],
  properties: {
    regime: { type: "string", minLength: 1, maxLength: 320 },
    base_case: { type: "string", minLength: 1, maxLength: 320 },
    if_then: { type: "string", minLength: 1, maxLength: 320 },
    invalidation: { type: "string", minLength: 1, maxLength: 320 },
    tension: { type: "string", minLength: 1, maxLength: 280 },
    hidden_risk: { type: "string", minLength: 1, maxLength: 320 },
    reaction_quality: { type: "string", minLength: 1, maxLength: 320 },
    cross_asset_conflict: { type: "string", minLength: 1, maxLength: 320 },
    what_changed: { type: "string", minLength: 1, maxLength: 320 },
    what_matters_next: { type: "string", minLength: 1, maxLength: 320 },
  },
} as const;

export const V2_COMMAND_AI_STUDY_SYSTEM_PROMPT = `You are GammaDesk Command Center AI Study — a constrained trading-research copilot over existing deterministic model outputs.

Numeric Risk / Opportunity / Trend / Positioning already exist elsewhere. Your job is to interpret what those scores cannot capture, using ONLY payload evidence.

Reasoning protocol — apply before writing:
1. Compare the current session with the prior-session evidence first. Identify the most consequential supported change; do not invent intraday ordering when only close-to-close data exists.
2. Select ONE dominant conflict or confirmation across equity structure, breadth/macro, and HYG/LQD credit. Organize the note around it instead of listing factors.
3. Classify the equity/credit relationship when both sides are present:
   - When creditHygLqd.spyChange1dPct is present, use its sign for the equity leg: below 0 = equity weakening/stress; above 0 = equity improvement. Do not substitute gamma regime for the observed equity direction.
   - Score confirmation from direction + magnitude + persistence (1D and 5D together). Never treat every weakening print as full confirmation.
   - No confirmation: HYG/LQD is stable, missing, or moving opposite the equity leg (e.g. equity weakening while HYG/LQD is improving/stable). Say "no credit confirmation" / "not yet confirmed by credit" and never label that divergence "meaningful", "strong", or "full".
   - Mild / early confirmation: same-direction credit move that is small or not persistent — 1D near/inside ~0.15% or 5D near/inside ~0.35%. Example: HYG/LQD −0.13% 1D / −0.35% 5D with equity weakening is early/mild credit confirmation, not meaningful/full confirmation.
   - Meaningful confirmation: 1D and 5D both clearly beyond those deadbands in the same direction as the equity leg.
   - Equity weakening + HYG/LQD weakening → credit may confirm equity stress at the strength above.
   - Equity weakening + HYG/LQD stable/improving → no credit confirmation of the equity stress.
   - Equity improvement + HYG/LQD weakening → the rally/improvement is NOT credit-confirmed. That is a quality conflict: it reduces conviction in ADD / SELECTIVE ADD / TACTICAL ADD. Never say the HYG/LQD print "supports", "validates", or "confirms" a bullish/selective-add thesis.
   - Do not claim confirmation when either equity evidence or creditHygLqd is absent.
4. The recommended action is ONLY historicalPolicy.positioning (Positioning V2). Never translate decision.stance (buy/hold/reduce) into the action. Stance may be mentioned only as a Risk V1 classification, never as the recommended action, "stance to buy/hold/reduce", or a buy/hold/reduce thesis.
   - If Positioning is absent, interpret structure without inventing a Positioning label and without using Risk stance as the action.
   - Quote the Positioning V2 label exactly when present (ADD, SELECTIVE ADD, HOLD / WAIT, TACTICAL ADD, HOLD, TRIM / DEFENSIVE, REDUCE CORE / TACTICAL REBOUND, REDUCE).
   - Opportunity wording is band-locked from the supplied score: <45 = limited tactical opportunity; 45–64 = moderate/selective opportunity; >=65 = elevated tactical/dislocation opportunity. Never write "high Opportunity" unless the score is >=65. Elevated/dislocation opportunity may come from washout and does NOT imply low Risk or automatic ADD.
   - Preserve logical polarity against Positioning V2, not Risk stance. Never say worsening credit invalidates a defensive Positioning label.
   - Confirmation conditions must reinforce the current Positioning. Invalidation conditions must weaken it. Do not swap these.
   - For TRIM / DEFENSIVE, REDUCE, and REDUCE CORE / TACTICAL REBOUND: confirmation = persistent Weak breadth, negative gamma, and/or amplifying dealer flow. Invalidation = breadth improvement (Weak→Mixed/Strong), gamma-flip reclaim, and/or dealer flow shifting to stabilizing. Recovery is never a TRIM confirmation.
   - For ADD / SELECTIVE ADD / TACTICAL ADD: confirmation = broader/aligned improvement (breadth Mixed→Strong, hold above flip/call wall, stabilizing flow). Invalidation = deterioration (breadth Weak, flip loss, amplifying flow) or unconfirmed rally quality (equity up while HYG/LQD weakens).
   - For HOLD / WAIT: confirmation preserves the wait (signals still conflict). Invalidation is a decisive alignment either constructive or defensive. For HOLD: confirmation is that risk stays elevated without a new reduce trigger; invalidation is either a clear repair (flip reclaim + broader breadth) or a clear deterioration (put-wall break / Weak breadth).
5. End the reasoning with concrete confirmation and invalidation conditions using only current payload levels/states. Confirmation must strengthen the base case; invalidation must falsify or materially weaken it.

Writing standard:
- Concise desk note; one sentence per field and target at most 180 characters. Use causal/relational language ("because", "while", "therefore", "not yet confirmed by") rather than a factor inventory.
- Synthesize relationships; do not repeat Risk, Opportunity, Trend, Positioning, breadth, macro, gamma, vol, and credit one by one.
- Each field must advance the same dominant thesis. Do not produce ten disconnected mini-summaries.
- Every claim must map to explicit payload evidence. No unsupported causality, chronology, market reaction, or catalyst narrative.

Output ten fields (1–2 short sentences each):
- regime: state the synthesized regime in one line, centered on the dominant confirmation/conflict; do not enumerate inputs. No credit mention.
- base_case: explain the most defensible implication for historicalPolicy.positioning. Use Risk stance only as classification if needed. Explicitly prevent elevated/dislocation Opportunity from being read as low Risk or ADD.
- if_then: give 1–2 observable confirmation paths that reinforce the current Positioning only — use transitions, not current-state restatement. For TRIM / DEFENSIVE do not put recovery in this field.
- invalidation: give 1–2 observable conditions that would weaken the current Positioning — never list conditions already true. For TRIM / DEFENSIVE this is where recovery belongs.
- tension: name the single most important disagreement or confirmation and why it matters; do not add a second unrelated conflict. No credit mention — express the equity/credit relationship in cross_asset_conflict instead.
- hidden_risk: state the risk the headline scores may miss. When HYG/LQD is weakening, identify deteriorating credit risk appetite; otherwise use only supported dated/incomplete/event/gamma risks. If none are present, say no off-model hidden risk is flagged.
- reaction_quality: whether participation/rotation/CTA confirms or contradicts the structure read (breadth vs dealer flow, leadership narrowness). Do not invent tape/news reactions. If those fields are missing, say reaction quality cannot be judged from connected inputs.
- cross_asset_conflict: explicitly classify the equity/HYG-LQD relationship when both are present, including confirmation strength (no / mild-early / meaningful), then explain why that restrains or supports Positioning V2. Equity up + HYG/LQD weakening restrains ADD / SELECTIVE ADD; it does not support it.
- what_changed: lead with the most consequential prior-session delta, then connect HYG/LQD 1D/5D if present. "First" means first in explanatory priority, not unsupported intraday chronology. When Risk moved, split factor polarity: name which connected factor increased Risk versus which offset it. Example: breadth Strong→Mixed increases Risk; macro mixed→risk_on decreases/offsets Risk. Never imply a risk-on or easing macro shift caused Risk to rise.
- what_matters_next: confirmation first (reinforces current Positioning), then invalidation (weakens it). Same polarity rules as if_then / invalidation.

Gamma structure semantics (compare spyGamma.spot vs gammaFlip, callWall, putWall before writing if_then, invalidation, or what_matters_next):
- Above gamma flip → more stabilizing / mean-reverting dealer-flow context; below gamma flip → amplification / trend / vol-expansion risk rises.
- Sustained break and hold above call wall → upside chase / hedge pressure may rise — do NOT imply mean reversion.
- Sustained break and hold below put wall → downside instability / support removal — do NOT treat as neutral.
- Use transitions: "If spot crosses from above flip to below…", "If spot breaks and holds above call wall…", "If breadth improves from Mixed to Strong…", "If dealer flow shifts from stabilizing to amplifying…".
- Do not use "loses flip" when spot is already below flip; do not use "below put wall" as invalidation when spot is already below put wall; do not use "reclaims flip" as invalidation when spot is already above flip.

Rules:
- Use ONLY fields in the user JSON payload. Do not invent prices, levels, probabilities, catalysts, news, sectors, or market reactions.
- dataQuality.interpretationConfidence is pre-computed — do NOT output your own confidence score.
- When dataQuality.limitations is non-empty, qualify stale or incomplete inputs in regime/base_case/hidden_risk (never describe them as live/current).
- When dataQuality.interpretationConfidence is "limited", keep language conditional; avoid strong directional claims.
- Macro interpretation and evidence describe completed-session closes — never frame them as intraday moves unless payload explicitly marks live.
- Do not recalculate or override Risk, Gamma, exposure, allocation, wall touch, ROD, breadth, CTA, or sector rotation.
- creditHygLqd is an Alpaca daily-bar HYG/LQD ratio only. Cite it solely in hidden_risk, cross_asset_conflict, and what_changed — never in other fields. Do not treat it as a Risk/Opportunity/Trend/Positioning input.
- HYG/LQD is a credit-risk-appetite proxy, NOT a credit-spread series. Never write "credit spreads tightened/widened" or use spread language; say the HYG/LQD ratio improved, weakened, or was stable.
- If a topic is in dataQuality.missingTopics or absent from the payload, omit it — do not guess.
- Gamma describes structure/amplification context, not a standalone buy/sell call.
- Use exact gamma levels (spot, putWall, callWall, gammaFlip) from the payload when referencing structure.
- Before writing each confirmation/invalidation, compare current spot with every cited wall/flip. A future condition must describe a state transition not already true. Allowed transitions by current position:
  - spot below put wall → "reclaims and holds above put wall" (recovery). Never "breaks/falls below put wall".
  - spot above put wall but below gamma flip → "reclaims and holds above gamma flip" (recovery) or "breaks and holds below put wall" (deterioration). Never "reclaims put wall" or "falls below gamma flip".
  - spot above gamma flip but below call wall → "breaks and holds above call wall" (chase) or "crosses from above flip to below" (deterioration). Never "reclaims gamma flip".
  - spot above call wall → "loses call wall" or "crosses back below flip". Never "breaks above call wall".
- Never invent numeric thresholds, recent highs/lows/troughs, or acceleration. For breadth use categorical transitions (Mixed → Strong, Weak → Mixed/Strong) unless the payload explicitly supplies a threshold.
- Final draft audit before returning JSON:
  1. Remove every credit mention from regime, base_case, if_then, invalidation, tension, reaction_quality, and what_matters_next. Banned there: "HYG/LQD", "creditHygLqd", "credit risk appetite", "credit appetite", "credit ratio", "credit conditions", "credit markets". Credit belongs only in hidden_risk, cross_asset_conflict, and what_changed.
  2. Remove all "credit spread", systemic-credit, tightening/widening, and credit-market claims; only the HYG/LQD risk-appetite proxy is supported.
  3. Remove any future condition already true at current spot/breadth state.
  4. Remove every number not copied from the payload and every invented threshold.
  5. Check that confirmation reinforces the current Positioning and invalidation weakens it. For TRIM / DEFENSIVE, recovery belongs only in invalidation. Do not treat Risk V1 stance as the action.
  6. In what_changed, do not attribute a Risk rise to a risk-on/easing factor. Separate Risk-increasing moves from Risk-offsetting moves.
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
    if (payload.decision.riskChangeReason) {
      for (const token of extractNumericTokens(payload.decision.riskChangeReason)) {
        const value = Number(normalizeNumToken(token));
        if (Number.isFinite(value)) add(value);
      }
    }
    if (payload.decision.exposure) {
      add(payload.decision.exposure.min);
      add(payload.decision.exposure.max);
    }
  }

  if (payload.breadth) {
    add(payload.breadth.percentAboveMa20);
    add(payload.breadth.percentAboveMa50);
    add(payload.breadth.advancingPct);
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

  const qualitative = payload.qualitativeContext;
  if (qualitative) {
    add(qualitative.previousRiskScore);
    add(qualitative.riskDivergence);
    add(qualitative.qqqVsSpy1dPct);
    for (const move of qualitative.factorMoves) {
      add(move.todayScore);
      add(move.previousScore);
    }
  }

  if (payload.creditHygLqd) {
    add(payload.creditHygLqd.ratio);
    add(payload.creditHygLqd.change1dPct);
    add(payload.creditHygLqd.trend5dPct);
    add(payload.creditHygLqd.spyChange1dPct);
  }

  if (payload.historicalPolicy?.trendReasons) {
    for (const reason of payload.historicalPolicy.trendReasons) {
      for (const token of extractNumericTokens(reason)) {
        const value = Number(normalizeNumToken(token));
        if (Number.isFinite(value)) add(value);
      }
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
    parsed.hidden_risk,
    parsed.reaction_quality,
    parsed.cross_asset_conflict,
    parsed.what_changed,
    parsed.what_matters_next,
  ];
  const fullText = texts.join(" ");

  const nonCreditFields = [
    parsed.regime,
    parsed.base_case,
    parsed.if_then,
    parsed.invalidation,
    parsed.tension,
    parsed.reaction_quality,
    parsed.what_matters_next,
  ].join(" ");
  if (
    /\b(HYG\/LQD|creditHygLqd|credit (?:risk )?appetite|credit ratio|credit conditions?|credit markets?)\b/i.test(
      nonCreditFields,
    )
  ) {
    return {
      ok: false,
      reason:
        "HYG/LQD credit evidence is restricted to hidden_risk, cross_asset_conflict, and what_changed",
    };
  }

  if (
    /\b(credit spreads?|spread tightening|spread widening|systemic credit)\b/i.test(
      fullText,
    )
  ) {
    return {
      ok: false,
      reason: "HYG/LQD is a ratio proxy, not a credit-spread series",
    };
  }

  if (
    /\b(breadth|advancing)[^.!?]{0,80}\b(above|below|over|under|exceed(?:s|ing)?|falls? to|rises? to)\s*(-?\d+(?:\.\d+)?)%/i.test(
      fullText,
    )
  ) {
    const match = fullText.match(
      /\b(?:breadth|advancing)[^.!?]{0,80}\b(?:above|below|over|under|exceed(?:s|ing)?|falls? to|rises? to)\s*(-?\d+(?:\.\d+)?)%/i,
    );
    const cited = match?.[1] ? Number(match[1]) : NaN;
    if (!Number.isFinite(cited) || !isCloseToAllowed(cited, allowedNumbers)) {
      return {
        ok: false,
        reason: "unsupported numeric breadth threshold",
      };
    }
  }

  if (
    /\brecent (?:highs?|lows?|troughs?)\b/i.test(fullText) ||
    /\baccelerat(?:e|es|ing|ed)\b[^.!?]{0,40}-?\d+(?:\.\d+)?%/i.test(fullText) ||
    /-?\d+(?:\.\d+)?%[^.!?]{0,40}\baccelerat(?:e|es|ing|ed)\b/i.test(fullText)
  ) {
    return {
      ok: false,
      reason: "unsupported path-dependent threshold or acceleration claim",
    };
  }

  const conditionalText = [
    parsed.if_then,
    parsed.invalidation,
    parsed.what_matters_next,
  ].join(" ");
  const position = deriveSpyGammaSpotPosition(payload.spyGamma);
  if (
    position.belowPutWall &&
    /\b(breaks?|falls?|drops?|declines?|breaches?)[^.!?]{0,60}\bbelow (?:(?:the|its) )?(?:SPY )?(?:put wall|putWall)/i.test(
      conditionalText,
    )
  ) {
    return { ok: false, reason: "put-wall condition is already true at current spot" };
  }
  if (
    position.abovePutWall &&
    /\breclaims?[^.!?]{0,60}\b(?:put wall|putWall)/i.test(conditionalText)
  ) {
    return { ok: false, reason: "put-wall reclaim is already true at current spot" };
  }
  if (
    position.belowFlip &&
    /\b(breaks?|falls?|drops?|breaches?|loses?)[^.!?]{0,60}\bbelow (?:(?:the|its) )?(?:SPY )?(?:gamma flip|gammaFlip)/i.test(
      conditionalText,
    )
  ) {
    return { ok: false, reason: "gamma-flip condition is already true at current spot" };
  }
  if (
    position.aboveFlip &&
    /\breclaims?[^.!?]{0,60}\b(?:gamma flip|gammaFlip)/i.test(conditionalText)
  ) {
    return { ok: false, reason: "gamma-flip reclaim is already true at current spot" };
  }
  if (
    position.aboveCallWall &&
    /\b(breaks?|rises?|moves?|reclaims?) [^.!?]{0,40}\babove (?:(?:the|its) )?(?:SPY )?(?:call wall|callWall)/i.test(
      conditionalText,
    )
  ) {
    return { ok: false, reason: "call-wall break is already true at current spot" };
  }

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

  const positioning = payload.historicalPolicy?.positioning?.trim() ?? "";
  if (
    /\bmodel stance (?:buy|hold|reduce)\b/i.test(fullText) ||
    /\b(buy|hold|reduce) stance\b/i.test(fullText) ||
    /\bstance (?:is|to|remains|supports?) (?:buy|hold|reduce)\b/i.test(fullText) ||
    /\b(?:buy|hold|reduce) thesis\b/i.test(fullText)
  ) {
    return {
      ok: false,
      reason: "Risk V1 stance must not be used as the recommended action",
    };
  }
  if (positioning) {
    if (!fullText.toLowerCase().includes(positioning.toLowerCase())) {
      return {
        ok: false,
        reason: "Positioning V2 label missing from interpretation",
      };
    }
  }

  const opportunity = payload.decision?.opportunityScore ?? null;
  if (opportunity !== null && Number.isFinite(opportunity)) {
    if (
      opportunity < 65 &&
      /\b(high|elevated)(?: tactical)?(?:\/dislocation)? opportunity\b/i.test(fullText)
    ) {
      return {
        ok: false,
        reason: "Opportunity is not in the elevated band",
      };
    }
    if (
      opportunity < 45 &&
      /\b(moderate|selective|elevated)(?:\/selective)?(?: tactical)?(?:\/dislocation)? opportunity\b/i.test(
        fullText,
      )
    ) {
      return {
        ok: false,
        reason: "Opportunity wording does not match the limited band",
      };
    }
    if (
      opportunity >= 45 &&
      opportunity < 65 &&
      /\b(limited tactical|elevated tactical|elevated\/dislocation) opportunity\b/i.test(
        fullText,
      )
    ) {
      return {
        ok: false,
        reason: "Opportunity wording does not match the moderate/selective band",
      };
    }
  }

  const credit = payload.creditHygLqd;
  if (credit) {
    const abs1d = Math.abs(credit.change1dPct ?? 0);
    const abs5d = Math.abs(credit.trend5dPct ?? 0);
    const meaningful = abs1d >= 0.15 && abs5d > 0.35;
    const creditText = [
      parsed.hidden_risk,
      parsed.cross_asset_conflict,
      parsed.what_changed,
    ].join(" ");
    const strongLabel = /\b(full|strong|meaningful(?:ly)?)\b/i;
    if (
      !meaningful &&
      (new RegExp(`${strongLabel.source}[^.!?]{0,48}\\bconfirm`, "i").test(creditText) ||
        new RegExp(`\\bconfirm[^.!?]{0,48}${strongLabel.source}`, "i").test(creditText) ||
        /\bequity stress is confirmed|\bconfirmed by (?:deteriorating )?credit/i.test(
          creditText,
        ))
    ) {
      return {
        ok: false,
        reason: "HYG/LQD move is only mild/early confirmation, not full confirmation",
      };
    }
    const spy1d = credit.spyChange1dPct;
    const creditImproving =
      ((credit.change1dPct ?? 0) > 0 && (credit.trend5dPct ?? 0) >= 0) ||
      ((credit.change1dPct ?? 0) >= 0 && (credit.trend5dPct ?? 0) > 0);
    const noConfirmationStated =
      /\bno (?:credit )?confirmation\b|\bnot (?:yet )?(?:credit[-\s])?confirmed\b|\bnot confirm(?:ing|ed)?\b|\bdoes not confirm\b|\bunconfirmed\b|\bnot credit-confirmed\b/i.test(
        creditText,
      );
    if (spy1d !== null && spy1d < 0 && creditImproving) {
      if (
        /\b(equity (?:stress|weakening).{0,48}confirm|(?:credit|HYG\/LQD).{0,48}confirm.{0,48}(?:equity|stress)|confirm(?:s|ed|ing|ation)?.{0,48}(?:equity stress|equity weakening)|credit confirmation of equity)\b/i.test(
          creditText,
        ) &&
        !noConfirmationStated
      ) {
        return {
          ok: false,
          reason: "equity stress is not confirmed while HYG/LQD is improving",
        };
      }
      if (
        /\b(full|strong|meaningful(?:ly)?)\b.{0,32}\bconfirm|\bconfirm.{0,32}\b(full|strong|meaningful(?:ly)?)\b/i.test(
          creditText,
        ) &&
        !noConfirmationStated
      ) {
        return {
          ok: false,
          reason:
            "equity/credit divergence must be stated as no confirmation, not a meaningful signal",
        };
      }
    }
    if (
      !meaningful &&
      !creditImproving &&
      strongLabel.test(creditText) &&
      !/\b(mild|early)\b/i.test(creditText)
    ) {
      return {
        ok: false,
        reason: "HYG/LQD magnitude does not support a meaningful-strength label",
      };
    }
    if (
      !meaningful &&
      !creditImproving &&
      /\bconfirm(?:s|ed|ing)?\b/i.test(creditText) &&
      !/\b(mild|early|no)\b.{0,32}\bconfirm|\bconfirm.{0,32}\b(mild|early|no)\b|\bno (?:credit )?confirmation\b|\bnot yet confirmed\b|\bnot confirmed\b/i.test(
        creditText,
      )
    ) {
      return {
        ok: false,
        reason: "HYG/LQD confirmation strength must be mild/early or none",
      };
    }
    const creditWeakening =
      ((credit.change1dPct ?? 0) < 0 && (credit.trend5dPct ?? 0) <= 0) ||
      ((credit.change1dPct ?? 0) <= 0 && (credit.trend5dPct ?? 0) < 0);
    if (
      spy1d !== null &&
      spy1d > 0 &&
      creditWeakening &&
      /\bconfirm(?:s|ed|ing|ation)?\b/i.test(creditText) &&
      !noConfirmationStated
    ) {
      return {
        ok: false,
        reason:
          "equity up with HYG/LQD weakening means the rally is not credit-confirmed",
      };
    }
    if (
      spy1d !== null &&
      spy1d > 0 &&
      creditWeakening &&
      /\b(support(?:s|ed|ing)?|validat(?:es|ed|ing)?)\b.{0,60}\b(add|selective add|bullish|constructive|positioning)\b|\b(add|selective add|bullish|constructive|positioning)\b.{0,60}\b(support(?:s|ed|ing)?|validat(?:es|ed|ing)?)\b/i.test(
        creditText,
      )
    ) {
      return {
        ok: false,
        reason:
          "equity up with HYG/LQD weakening does not support bullish/selective-add positioning",
      };
    }
  }

  if (
    /risk.{0,80}\b(rose|increased|rise|higher)\b.{0,80}\b(risk[_\s-]?on|easing)\b|\b(risk[_\s-]?on|easing)\b.{0,80}(caused|driving|reflecting).{0,40}\brisk\b.{0,20}\b(rose|increase)/i.test(
      parsed.what_changed,
    )
  ) {
    return {
      ok: false,
      reason: "do not attribute a Risk rise to a risk-on or easing factor",
    };
  }

  const defensivePositioning = /TRIM|REDUCE/i.test(positioning);
  if (defensivePositioning) {
    const confirmationFields = [parsed.if_then, parsed.what_matters_next].join(" ");
    if (
      /\b(confirm(?:s|ed|ing|ation)?|reinforce(?:s|d)?|strengthen(?:s|ed)?)\b.{0,90}\b(breadth.{0,24}(improv|recover|strong)|reclaim.{0,36}(flip|gamma)|stabiliz)/i.test(
        confirmationFields,
      ) ||
      /\b(if|when) (breadth.{0,40}(improv|recover|strong)|spot reclaims?.{0,40}(flip|gamma)|dealer flow.{0,24}stabiliz).{0,80}\b(confirm|reinforce|strengthen|defensive posture is reinforced|trim \/ defensive is reinforced)/i.test(
        confirmationFields,
      )
    ) {
      return {
        ok: false,
        reason:
          "TRIM / DEFENSIVE confirmation cannot be breadth improvement, flip reclaim, or stabilizing flow",
      };
    }
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

function creditHygLqdPayload(
  credit: HygLqdCreditSignal,
): V2AiStudyPayload["creditHygLqd"] | undefined {
  if (credit.status !== "available") return undefined;
  return {
    ratio: credit.ratio,
    change1dPct: credit.change1dPct,
    trend5dPct: credit.trend5dPct,
    signal: credit.signal,
    spyChange1dPct: credit.spyChange1dPct,
    sessionDate: credit.sessionDate,
  };
}

function creditHygLqdFacts(payload: V2AiStudyPayload): string | null {
  const credit = payload.creditHygLqd;
  if (!credit) return null;
  const parts = [`HYG/LQD ratio ${credit.ratio}`];
  if (credit.change1dPct !== null && credit.change1dPct !== undefined) {
    parts.push(`1D ${formatHygLqdPct(credit.change1dPct)}`);
  }
  if (credit.trend5dPct !== null && credit.trend5dPct !== undefined) {
    parts.push(`5D ${formatHygLqdPct(credit.trend5dPct)}`);
  }
  return parts.join(" · ");
}

function creditHiddenRiskLine(payload: V2AiStudyPayload): string | null {
  const credit = payload.creditHygLqd;
  if (!credit || credit.signal !== "weakening") return null;
  const facts = creditHygLqdFacts(payload);
  if (!facts) return null;
  return `${facts} — credit risk appetite deteriorating (not in the numeric risk score).`;
}

function creditCrossAssetLine(payload: V2AiStudyPayload): string | null {
  const credit = payload.creditHygLqd;
  if (!credit) return null;
  const facts = creditHygLqdFacts(payload);
  if (!facts) return null;
  const spy1d = credit.spyChange1dPct;
  if (
    (credit.signal === "stable" || credit.signal === "improving") &&
    spy1d !== null &&
    spy1d !== undefined &&
    spy1d < 0
  ) {
    return `${facts} vs SPY 1D ${formatHygLqdPct(spy1d)} — equity stress not yet confirmed by credit.`;
  }
  if (credit.signal === "weakening") {
    return `${facts} — credit risk appetite deteriorating.`;
  }
  return null;
}

function creditWhatChangedLine(payload: V2AiStudyPayload): string | null {
  const credit = payload.creditHygLqd;
  if (!credit) return null;
  const facts = creditHygLqdFacts(payload);
  if (!facts) return null;
  if (credit.signal === "weakening") {
    return `${facts} — credit risk appetite deteriorating.`;
  }
  if (credit.signal === "improving") {
    return `${facts} — HYG/LQD improving.`;
  }
  return `${facts} — HYG/LQD stable.`;
}

function qualitativeContextFromView(
  view: V2CommandCenterView,
): NonNullable<V2AiStudyPayload["qualitativeContext"]> {
  const comparison = view.riskSessionComparison;
  return {
    missingInputs: [...new Set(view.missingInputs)].slice(0, 8),
    previousSession: comparison?.previousSession ?? null,
    previousRiskScore: comparison?.previousRiskScore ?? null,
    factorMoves: (comparison?.factors ?? []).map((factor) => ({
      id: factor.id,
      todayScore: factor.todayScore,
      previousScore: factor.previousScore,
    })),
    spyRegime: view.gamma[0]?.regime ?? null,
    qqqRegime: view.gamma[1]?.regime ?? null,
    spyDealerFlow: view.gamma[0]?.dealerFlowRegime ?? null,
    qqqDealerFlow: view.gamma[1]?.dealerFlowRegime ?? null,
    riskDivergence: view.riskDivergence,
    gammaRegimeLabel: view.componentDivergence.gammaRegime.label,
    breadthDivergenceLabel: view.componentDivergence.breadth.label,
    qqqVsSpy1dPct: view.componentDivergence.relativePerformance.qqqVsSpy1dPct,
  };
}

export function buildV2AiStudyPayload(
  view: V2CommandCenterView,
  eventGate: EventGateSnapshot | null,
  historicalPolicy?: V2AiStudyPayload["historicalPolicy"],
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
      marketAction: view.marketAction,
      riskChangeReason: view.riskChangeReason,
    },
    qualitativeContext: qualitativeContextFromView(view),
    ...(creditHygLqdPayload(view.creditHygLqd)
      ? { creditHygLqd: creditHygLqdPayload(view.creditHygLqd) }
      : {}),
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
    ...(historicalPolicy ? { historicalPolicy } : {}),
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
  push("riskChangeReason", view.riskChangeReason, payload.decision?.riskChangeReason ?? null);

  const qualitative = payload.qualitativeContext;
  const expectedQualitative = qualitativeContextFromView(view);
  if (!qualitative) {
    mismatches.push("qualitativeContext: missing from payload");
  } else {
    push("qualitativeContext.missingInputs", expectedQualitative.missingInputs, qualitative.missingInputs);
    push("qualitativeContext.previousSession", expectedQualitative.previousSession, qualitative.previousSession);
    push("qualitativeContext.previousRiskScore", expectedQualitative.previousRiskScore, qualitative.previousRiskScore);
    push("qualitativeContext.factorMoves", expectedQualitative.factorMoves, qualitative.factorMoves);
    push("qualitativeContext.spyRegime", expectedQualitative.spyRegime, qualitative.spyRegime);
    push("qualitativeContext.qqqRegime", expectedQualitative.qqqRegime, qualitative.qqqRegime);
    push("qualitativeContext.spyDealerFlow", expectedQualitative.spyDealerFlow, qualitative.spyDealerFlow);
    push("qualitativeContext.qqqDealerFlow", expectedQualitative.qqqDealerFlow, qualitative.qqqDealerFlow);
    push("qualitativeContext.riskDivergence", expectedQualitative.riskDivergence, qualitative.riskDivergence);
    push("qualitativeContext.gammaRegimeLabel", expectedQualitative.gammaRegimeLabel, qualitative.gammaRegimeLabel);
    push(
      "qualitativeContext.breadthDivergenceLabel",
      expectedQualitative.breadthDivergenceLabel,
      qualitative.breadthDivergenceLabel,
    );
    push("qualitativeContext.qqqVsSpy1dPct", expectedQualitative.qqqVsSpy1dPct, qualitative.qqqVsSpy1dPct);
  }

  const expectedCredit = creditHygLqdPayload(view.creditHygLqd);
  if (expectedCredit) {
    if (!payload.creditHygLqd) {
      mismatches.push("creditHygLqd: missing from payload");
    } else {
      push("creditHygLqd.ratio", expectedCredit.ratio, payload.creditHygLqd.ratio);
      push("creditHygLqd.change1dPct", expectedCredit.change1dPct, payload.creditHygLqd.change1dPct);
      push("creditHygLqd.trend5dPct", expectedCredit.trend5dPct, payload.creditHygLqd.trend5dPct);
      push("creditHygLqd.signal", expectedCredit.signal, payload.creditHygLqd.signal);
      push(
        "creditHygLqd.spyChange1dPct",
        expectedCredit.spyChange1dPct,
        payload.creditHygLqd.spyChange1dPct,
      );
    }
  } else if (payload.creditHygLqd) {
    mismatches.push("creditHygLqd: payload present but HYG/LQD unavailable on view");
  }

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
  const positioning = payload.historicalPolicy?.positioning?.trim();
  if (positioning) {
    parts.push(`Positioning ${positioning}`);
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

  const positioning = payload.historicalPolicy?.positioning?.trim();
  if (positioning) {
    let line = `Positioning ${positioning}`;
    if (payload.decision?.riskScore !== null && payload.decision?.riskScore !== undefined) {
      line += ` · risk ${payload.decision.riskScore}`;
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

function buildHiddenRiskFallback(payload: V2AiStudyPayload): string {
  const parts: string[] = [];
  const spy = payload.spyGamma;
  const position = deriveSpyGammaSpotPosition(spy);

  if (payload.eventGate && payload.eventGate.state !== "clear") {
    const stale = payload.eventGate.stale ? " (stale)" : "";
    const headline = payload.eventGate.headline;
    parts.push(
      headline
        ? `Event gate ${payload.eventGate.state}${stale}: ${headline} is in connected inputs, not a scored tape reaction.`
        : `Event gate ${payload.eventGate.state}${stale} is open in connected inputs.`,
    );
  }
  if (spy?.incomplete === true) {
    parts.push("SPY gamma snapshot is incomplete, so wall/flip context may be understated in the score.");
  } else if (spy?.stale === true) {
    parts.push("SPY gamma is marked stale in connected inputs.");
  }
  if (payload.breadth?.stale) {
    const dated = payload.breadth.marketSessionDate
      ? ` dated ${payload.breadth.marketSessionDate}`
      : "";
    parts.push(`SPY breadth is stale${dated}, so participation may not match the scored session.`);
  }
  const missing = payload.qualitativeContext?.missingInputs ?? [];
  if (missing.length > 0) {
    parts.push(`Missing inputs: ${missing.slice(0, 2).join("; ")}.`);
  }
  if (position.belowFlip && position.gammaFlip !== null) {
    parts.push(
      `Spot is below gamma flip ${position.gammaFlip} — amplification is a structure fact the headline score may compress.`,
    );
  }
  if (payload.volMispricing?.spySignal === "vol_underpriced" && spy?.incomplete === true) {
    parts.push("Vol underpriced vs incomplete gamma snapshot.");
  }
  const creditHidden = creditHiddenRiskLine(payload);
  if (creditHidden) {
    parts.unshift(creditHidden);
  }

  return (
    parts.slice(0, 2).join(" ") ||
    "No off-model hidden risk is flagged in connected inputs."
  );
}

function buildReactionQualityFallback(payload: V2AiStudyPayload): string {
  const parts: string[] = [];
  const spy = payload.spyGamma;
  const breadthLabel =
    payload.breadth?.signal && payload.breadth.signal !== "unavailable"
      ? breadthSignalLabel(
          payload.breadth.signal as "strong" | "mixed" | "weak",
          "available",
        )
      : null;
  const stale = payload.breadth?.stale ? " (dated breadth)" : "";

  if (spy?.dealerFlow && typeof spy.dealerFlow === "string" && breadthLabel) {
    parts.push(`${spy.dealerFlow} vs SPY breadth ${breadthLabel}${stale}.`);
  }
  if (payload.ctaProxy?.signal && breadthLabel) {
    parts.push(
      `CTA proxy ${ctaProxySignalLabel(
        payload.ctaProxy.signal as CtaProxyTrendSignal,
        "available",
      )} vs SPY breadth ${breadthLabel}${stale}.`,
    );
  }
  const leader = payload.sectorRotation?.leadingImproving[0];
  const weak = payload.sectorRotation?.weakening[0];
  if (leader && weak) {
    parts.push(
      `Sector leadership is narrow: ${leader.label} vs ${weak.label} weakening on 5D RS.`,
    );
  }

  return (
    parts.slice(0, 2).join(" ") ||
    "Reaction quality cannot be judged from connected inputs."
  );
}

function buildCrossAssetConflictFallback(payload: V2AiStudyPayload): string {
  const qualitative = payload.qualitativeContext;
  const parts: string[] = [];

  if (qualitative?.spyRegime && qualitative.qqqRegime && qualitative.spyRegime !== qualitative.qqqRegime) {
    parts.push(
      `SPY gamma regime ${qualitative.spyRegime.replaceAll("_", " ")} vs QQQ ${qualitative.qqqRegime.replaceAll("_", " ")}.`,
    );
  }
  if (
    qualitative?.spyDealerFlow &&
    qualitative.qqqDealerFlow &&
    qualitative.spyDealerFlow !== qualitative.qqqDealerFlow
  ) {
    parts.push(`SPY dealer flow ${qualitative.spyDealerFlow} vs QQQ ${qualitative.qqqDealerFlow}.`);
  }
  if (qualitative?.gammaRegimeLabel) {
    parts.push(`Gamma regime divergence: ${qualitative.gammaRegimeLabel}.`);
  }
  if (qualitative?.breadthDivergenceLabel) {
    parts.push(`Breadth divergence: ${qualitative.breadthDivergenceLabel}.`);
  }
  if (qualitative?.riskDivergence !== null && qualitative?.riskDivergence !== undefined) {
    parts.push(`QQQ−SPY structural risk divergence ${qualitative.riskDivergence}.`);
  }
  if (qualitative?.qqqVsSpy1dPct !== null && qualitative?.qqqVsSpy1dPct !== undefined) {
    parts.push(`QQQ vs SPY 1D ${qualitative.qqqVsSpy1dPct}%.`);
  }
  if (payload.macro?.riskDirection === "mixed" && leaderImproves(payload)) {
    parts.push("Mixed macro risk vs sector leadership.");
  }
  const creditConflict = creditCrossAssetLine(payload);
  if (creditConflict) {
    parts.unshift(creditConflict);
  }

  return (
    parts.slice(0, 2).join(" ") ||
    "No cross-asset conflict is flagged in connected inputs."
  );
}

function buildWhatChangedFallback(payload: V2AiStudyPayload): string {
  const parts: string[] = [];
  const change = payload.decision?.riskChange;
  const reason = payload.decision?.riskChangeReason;
  const previousScore = payload.qualitativeContext?.previousRiskScore;
  const previousSession = payload.qualitativeContext?.previousSession;

  if (change !== null && change !== undefined) {
    let line = `Risk change ${change > 0 ? "+" : ""}${change}`;
    if (previousScore !== null && previousScore !== undefined) {
      line += ` vs previous session score ${previousScore}`;
    }
    if (previousSession) {
      line += ` (${previousSession})`;
    }
    if (reason) {
      line += ` — ${reason}`;
    }
    parts.push(`${line}.`);
  } else if (reason) {
    parts.push(reason);
  }

  const moves = (payload.qualitativeContext?.factorMoves ?? []).filter(
    (factor) =>
      factor.todayScore !== null &&
      factor.previousScore !== null &&
      factor.todayScore !== factor.previousScore,
  );
  if (moves.length > 0) {
    const top = moves
      .slice(0, 2)
      .map((factor) => `${factor.id} ${factor.previousScore}→${factor.todayScore}`);
    parts.push(`Factor moves: ${top.join("; ")}.`);
  }
  const creditChanged = creditWhatChangedLine(payload);
  if (creditChanged) {
    parts.unshift(creditChanged);
  }

  return (
    parts.slice(0, 2).join(" ") ||
    "No session-to-session change evidence is in connected inputs."
  );
}

function buildWhatMattersNextFallback(payload: V2AiStudyPayload): string {
  const text = buildIfThenFallback(payload);
  if (text.startsWith("No conditional")) {
    return "No next observable is specified in connected inputs.";
  }
  return text;
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
      hiddenRisk: buildHiddenRiskFallback(payload),
      reactionQuality: buildReactionQualityFallback(payload),
      crossAssetConflict: buildCrossAssetConflictFallback(payload),
      whatChanged: buildWhatChangedFallback(payload),
      whatMattersNext: buildWhatMattersNextFallback(payload),
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
    hiddenRisk:
      "Illustrative incomplete gamma and dated breadth — off-model coverage gaps only, preview payload.",
    reactionQuality:
      "Illustrative stabilizing dealer flow vs mixed breadth; leadership not confirmed by participation.",
    crossAssetConflict:
      "Illustrative SPY vs QQQ gamma/dealer-flow split in preview payload only.",
    whatChanged:
      "Illustrative risk eased vs prior session in preview payload — not a live session delta.",
    whatMattersNext:
      "If illustrative SPY loses gamma flip → vol expansion risk rises. If breadth improves from Mixed to Strong → participation may broaden.",
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
      hiddenRisk: parsed.hidden_risk.trim(),
      reactionQuality: parsed.reaction_quality.trim(),
      crossAssetConflict: parsed.cross_asset_conflict.trim(),
      whatChanged: parsed.what_changed.trim(),
      whatMattersNext: parsed.what_matters_next.trim(),
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

  const maxAttempts =
    1 + input.config.maxRetries + input.config.parseRetries;
  let lastError = "unknown error";
  let correction: string | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.config.timeoutMs);
    try {
      const attemptPrompt = correction
        ? `${userPrompt}\n\nThe prior draft was rejected by grounding validation: ${correction}. Regenerate the full JSON and fix that violation without adding new facts.`
        : userPrompt;
      const body = buildV2CommandAiStudyOpenAiBody(input.config, attemptPrompt);
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
        correction = lastError;
        continue;
      }
      const grounding = validateV2AiStudyLlmGrounding(parsed.data, input.payload);
      if (!grounding.ok) {
        lastError = `Grounding failed: ${grounding.reason}`;
        correction = grounding.reason;
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
