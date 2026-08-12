import { z } from "zod";
import type { EventGateSnapshot } from "@/contracts/event-gate";
import type { FetchLike } from "@/ingest/http";
import type {
  V2AiStudyInterpretation,
  V2CommandCenterView,
  V2GammaSummary,
} from "@/desk/v2-command-center";
import { breadthSignalLabel, formatSectorEtfLabel } from "@/desk/v2-command-center";
import {
  ctaProxySignalLabel,
  formatGexCompact,
  formatIvHvSpreadVolPts,
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

export const V2_COMMAND_AI_STUDY_PROMPT_VERSION = "0.1.0";
export const V2_COMMAND_AI_STUDY_MAX_OUTPUT_TOKENS = 420;

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
}

const V2AiStudyLlmOutputSchema = z.object({
  market_setup: z.string().min(1).max(320),
  key_upside_trigger: z.string().min(1).max(280),
  key_downside_trigger: z.string().min(1).max(280),
  main_supporting_signal: z.string().min(1).max(280),
  main_conflicting_signal: z.string().min(1).max(280),
});

export const V2_COMMAND_AI_STUDY_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "market_setup",
    "key_upside_trigger",
    "key_downside_trigger",
    "main_supporting_signal",
    "main_conflicting_signal",
  ],
  properties: {
    market_setup: { type: "string" },
    key_upside_trigger: { type: "string" },
    key_downside_trigger: { type: "string" },
    main_supporting_signal: { type: "string" },
    main_conflicting_signal: { type: "string" },
  },
} as const;

export const V2_COMMAND_AI_STUDY_SYSTEM_PROMPT = `You are GammaDesk Command Center AI Study — a concise interpreter of existing deterministic model outputs.

Rules:
- Use ONLY fields in the user JSON payload. Do not invent prices, levels, probabilities, catalysts, or signals.
- Do not recalculate risk, gamma, breadth, rotation, or any numeric model output.
- If a topic is absent from the payload, say it is not available in connected inputs — do not guess.
- Gamma describes structure/amplification context, not a standalone buy/sell call.
- Keep each answer to one or two short sentences. Total output must fit a compact card.
- No trade advice, position sizing, or fabricated event detail.`;

function gammaPayload(item: V2GammaSummary): Record<string, unknown> | null {
  if (item.status === "unavailable") return null;
  const out: Record<string, unknown> = { symbol: item.symbol };
  if (item.regime) out.regime = item.regime;
  if (item.dealerFlowRegime) out.dealerFlow = item.dealerFlowRegime;
  if (item.spot !== null) out.spot = item.spot;
  if (item.putWall !== null) out.putWall = item.putWall;
  if (item.callWall !== null) out.callWall = item.callWall;
  if (item.gammaFlip !== null) out.gammaFlip = item.gammaFlip;
  if (item.netGex !== null) out.netGex = formatGexCompact(item.netGex);
  if (item.restOfDayRange.status === "available") {
    out.restOfDayRange = formatRestOfDayRangeLabel(item.restOfDayRange);
  }
  if (item.freshness === "stale" || item.freshness === "incomplete") {
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
    ...(macro.interpretation ? { interpretation: macro.interpretation } : {}),
    ...(macro.evidence.length > 0 ? { evidence: macro.evidence } : {}),
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

  return payload as V2AiStudyPayload;
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

export function buildV2AiStudyFallback(
  payload: V2AiStudyPayload,
): V2AiStudyInterpretation {
  const setupParts: string[] = [];
  if (payload.decision?.stance) {
    setupParts.push(`Model stance: ${payload.decision.stance}.`);
  }
  if (payload.decision?.riskScore !== null && payload.decision?.riskScore !== undefined) {
    setupParts.push(`Portfolio risk ${payload.decision.riskScore}.`);
  }
  if (payload.macro?.label) {
    setupParts.push(`Macro driver: ${payload.macro.label}.`);
  }
  if (payload.macro?.interpretation) {
    setupParts.push(payload.macro.interpretation);
  } else if (payload.macro?.evidence && payload.macro.evidence.length > 0) {
    setupParts.push(payload.macro.evidence.slice(0, 2).join(" "));
  }
  const spyGamma = payload.spyGamma;
  if (spyGamma?.dealerFlow && typeof spyGamma.dealerFlow === "string") {
    setupParts.push(`SPY dealer flow: ${spyGamma.dealerFlow}.`);
  }

  let keyUpsideTrigger = "No clear upside trigger in connected inputs.";
  const topLeader = payload.sectorRotation?.leadingImproving[0];
  if (topLeader) {
    keyUpsideTrigger = `${topLeader.label} leads on 5D RS ${formatRsPct(topLeader.rs5d)} vs SPY.`;
  } else if (payload.breadth?.signal === "strong") {
    keyUpsideTrigger = `SPY breadth signal ${payload.breadth.signal} supports broad participation.`;
  } else if (payload.ctaProxy?.signal === "buying") {
    keyUpsideTrigger = `CTA proxy ${ctaProxySignalLabel(payload.ctaProxy.signal as CtaProxyTrendSignal, "available")} aligns with trend support.`;
  }

  let keyDownsideTrigger = "No explicit downside trigger in connected inputs.";
  if (payload.eventGate?.state && payload.eventGate.state !== "clear") {
    keyDownsideTrigger =
      payload.eventGate.headline ??
      `Event gate ${payload.eventGate.state} — monitor catalyst window.`;
  } else if (payload.sectorRotation?.weakening[0]) {
    const weak = payload.sectorRotation.weakening[0];
    keyDownsideTrigger = `${weak.label} weak on 5D RS ${formatRsPct(weak.rs5d)} vs SPY.`;
  } else if (
    payload.decision?.riskScore !== null &&
    payload.decision?.riskScore !== undefined &&
    payload.decision.riskScore >= 66
  ) {
    keyDownsideTrigger = `Elevated portfolio risk score ${payload.decision.riskScore}.`;
  }

  let mainSupportingSignal = "Limited aligned signals in connected inputs.";
  if (payload.breadth?.signal && payload.breadth.signal !== "unavailable") {
    const ma20 =
      payload.breadth.percentAboveMa20 !== null
        ? `${payload.breadth.percentAboveMa20}% > MA20`
        : "breadth available";
    mainSupportingSignal = `SPY breadth ${breadthSignalLabel(payload.breadth.signal as "strong" | "mixed" | "weak", "available")} (${ma20}).`;
  } else if (payload.ctaProxy?.signal) {
    mainSupportingSignal = `CTA proxy ${ctaProxySignalLabel(payload.ctaProxy.signal as CtaProxyTrendSignal, "available")}${payload.ctaProxy.context ? `: ${payload.ctaProxy.context}` : ""}`;
  } else if (spyGamma?.regime && typeof spyGamma.regime === "string") {
    mainSupportingSignal = `SPY gamma regime ${spyGamma.regime.replaceAll("_", " ")}.`;
  }

  let mainConflictingSignal = "No major conflicting signal flagged in connected inputs.";
  if (payload.volMispricing?.spySignal === "vol_expensive") {
    mainConflictingSignal = `Vol mispricing: ${volMispricingSignalLabel("vol_expensive")} (IV−HV ${formatIvHvSpreadVolPts(payload.volMispricing.ivMinusHvVolPts)}).`;
  } else if (
    payload.decision?.riskChange !== null &&
    payload.decision?.riskChange !== undefined &&
    payload.decision.riskChange > 0
  ) {
    mainConflictingSignal = `Portfolio risk rose ${payload.decision.riskChange} vs prior publication.`;
  } else if (
    spyGamma?.regime &&
    typeof spyGamma.regime === "string" &&
    spyGamma.regime.includes("negative")
  ) {
    mainConflictingSignal = `SPY ${spyGamma.regime.replaceAll("_", " ")} — downside moves may amplify.`;
  }

  return {
    status: "fallback",
    source: "deterministic",
    marketSetup: setupParts.join(" ") || "Command Center inputs are partial.",
    keyUpsideTrigger,
    keyDownsideTrigger,
    mainSupportingSignal,
    mainConflictingSignal,
    missingReason: null,
  };
}

export function previewV2AiStudyInterpretation(): V2AiStudyInterpretation {
  return {
    status: "preview",
    source: "preview",
    marketSetup:
      "Illustrative hold stance with moderate risk; macro and structure inputs are methodology preview only.",
    keyUpsideTrigger:
      "Illustrative XLK · Technology leadership on positive 5D relative strength vs SPY.",
    keyDownsideTrigger:
      "Illustrative defensive sector weakness; not live market data.",
    mainSupportingSignal:
      "Illustrative improving SPY breadth participation in the preview payload.",
    mainConflictingSignal:
      "Illustrative vol expensive signal — options rich vs realized vol in preview.",
    missingReason: null,
  };
}

function interpretationFromLlmOutput(
  parsed: z.infer<typeof V2AiStudyLlmOutputSchema>,
): V2AiStudyInterpretation {
  return {
    status: "ready",
    source: "openai",
    marketSetup: parsed.market_setup.trim(),
    keyUpsideTrigger: parsed.key_upside_trigger.trim(),
    keyDownsideTrigger: parsed.key_downside_trigger.trim(),
    mainSupportingSignal: parsed.main_supporting_signal.trim(),
    mainConflictingSignal: parsed.main_conflicting_signal.trim(),
    missingReason: null,
  };
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
      return interpretationFromLlmOutput(parsed.data);
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
