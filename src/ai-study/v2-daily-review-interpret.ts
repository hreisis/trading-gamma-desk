import { z } from "zod";
import type { FetchLike } from "@/ingest/http";
import type {
  CommandCenterV1DailySnapshot,
  V2DailyReview,
  V2DailyReviewErrorSource,
  V2DailyReviewInterpretationContext,
} from "@/desk/command-center-v1";
import type { V2AiStudyConfidence, V2CommandCenterView } from "@/desk/v2-command-center";
import type { AiStudyLlmRuntimeConfig } from "./config";
import {
  describeAiStudyLlmModelSource,
  describeMissingAiStudyLlmEnv,
  OPENAI_RESPONSES_URL,
  openAiResponsesReasoningEffort,
} from "./config";
import { extractOutputText } from "./openai-utils";

export const V2_DAILY_REVIEW_PROMPT_VERSION = "0.2.0";
export const V2_DAILY_REVIEW_MAX_OUTPUT_TOKENS = 480;

export const V2DailyReviewErrorSourceSchema = z.enum([
  "data",
  "model",
  "regime",
  "none",
]);

export const V2DailyReviewLlmOutputSchema = z.object({
  what_worked: z.string().min(1).max(320),
  what_failed: z.string().min(1).max(320),
  error_source: V2DailyReviewErrorSourceSchema,
  error_explanation: z.string().min(1).max(280),
  tomorrow_watch: z.string().min(1).max(320),
});

export const V2_DAILY_REVIEW_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "what_worked",
    "what_failed",
    "error_source",
    "error_explanation",
    "tomorrow_watch",
  ],
  properties: {
    what_worked: { type: "string" },
    what_failed: { type: "string" },
    error_source: { type: "string", enum: ["data", "model", "regime", "none"] },
    error_explanation: { type: "string" },
    tomorrow_watch: { type: "string" },
  },
} as const;

export const V2_DAILY_REVIEW_SYSTEM_PROMPT = `You are GammaDesk Daily Review — a constrained self-critique layer over deterministic end-of-day review outputs.

Output five fields (1–2 short sentences each):
- what_worked: morning thesis elements validated by session close/high/low and level-touch flags — not raw touch events alone.
- what_failed: morning thesis elements contradicted by close vs walls/flip/ROD and stance alignment — wall touch alone is NOT a failure.
- error_source: exactly one of data | model | regime | none (enum only).
- error_explanation: brief grounded reason for that classification.
- tomorrow_watch: 1–2 observable follow-ups already in the payload.

- Thesis rules (use morningThesis + sessionOutcome close vs levels):
- Stabilizing dealer flow: morning thesis expects walls to hold/reject — closing through a wall contradicts that thesis.
- Amplifying dealer flow: close above call wall or below put wall can support upside/downside chase while still below flip — not automatic failure.
- Wall breaks alone do NOT classify as regime.
- Regime (error_source regime) requires flip-side transition: morning spot above flip with close below flip, or morning spot below flip with close above flip.
- ROD outside band only challenges thesis when a published ROD band existed in the morning snapshot.
- Gamma flip touch alone does not prove regime failure unless close crosses flip versus morning spot side; intraday cross order is NOT available from daily OHLC.
- data: only when stale/incomplete/missing inputs materially impair the miss discussed.
- model: adequate inputs but an explicit recorded morning expectation (stance, stabilizing wall hold, published ROD) was contradicted.
- regime: observable gamma-flip regime transition only.
- none: morning thesis broadly consistent with outcome; no explicit expectation invalidated.

Rules:
- Use ONLY payload fields. Never invent intraday sequence, probabilities, prices, sectors, or catalysts.
- sessionOutcome provides daily OHLC and touch flags only.
- Do not recalculate touches or outcome strings.
- dataQuality.interpretationConfidence is pre-computed — do NOT output confidence.
- Keep each field concise; no trade advice.`;

export interface V2DailyReviewThesisCritique {
  readonly worked: string[];
  readonly failed: string[];
  readonly watch: string[];
}

export interface V2DailyReviewPayload {
  readonly promptVersion: string;
  readonly sessionDate: string;
  readonly morningThesis: {
    readonly stance: string | null;
    readonly stabilizingDealerFlow: boolean;
    readonly amplifyingDealerFlow: boolean;
    readonly rodPublished: boolean;
    readonly morningSpotAboveFlip: boolean | null;
  };
  readonly morningSnapshot: {
    readonly stance: string | null;
    readonly riskScore: number | null;
    readonly exposure: { readonly min: number; readonly max: number } | null;
    readonly spy: {
      readonly spot: number | null;
      readonly callWall: number | null;
      readonly putWall: number | null;
      readonly gammaFlip: number | null;
      readonly dealerFlow: string | null;
      readonly restOfDayRange: {
        readonly status: string;
        readonly lower: number | null;
        readonly upper: number | null;
      };
    };
    readonly qqq: {
      readonly spot: number | null;
      readonly callWall: number | null;
      readonly putWall: number | null;
      readonly gammaFlip: number | null;
      readonly dealerFlow: string | null;
    };
    readonly breadth: CommandCenterV1DailySnapshot["breadth"];
    readonly ctaProxy: CommandCenterV1DailySnapshot["ctaProxy"];
    readonly volMispricing: CommandCenterV1DailySnapshot["volMispricing"];
    readonly sectorRotation: CommandCenterV1DailySnapshot["sectorRotation"];
  };
  readonly sessionOutcome: {
    readonly actualOutcome: string;
    readonly spy: {
      readonly open: number;
      readonly high: number;
      readonly low: number;
      readonly close: number;
      readonly direction: string | null;
      readonly callWallTouched: boolean | null;
      readonly putWallTouched: boolean | null;
      readonly flipTouched: boolean | null;
      readonly rodInside: boolean | null;
      readonly closeAboveCallWall: boolean | null;
      readonly closeBelowPutWall: boolean | null;
      readonly closeAboveFlip: boolean | null;
      readonly closeBelowFlip: boolean | null;
    };
    readonly qqq: {
      readonly open: number | null;
      readonly high: number | null;
      readonly low: number | null;
      readonly close: number | null;
      readonly direction: string | null;
      readonly callWallTouched: boolean | null;
      readonly putWallTouched: boolean | null;
      readonly flipTouched: boolean | null;
      readonly rodInside: boolean | null;
      readonly closeAboveCallWall: boolean | null;
      readonly closeBelowPutWall: boolean | null;
      readonly closeAboveFlip: boolean | null;
      readonly closeBelowFlip: boolean | null;
    } | null;
  };
  readonly thesisCritique: V2DailyReviewThesisCritique;
  readonly dataQuality: {
    readonly interpretationConfidence: V2AiStudyConfidence;
    readonly limitations: readonly string[];
    readonly missingTopics: readonly string[];
  };
}

function isStabilizingDealerFlow(dealerFlow: string | null): boolean {
  if (!dealerFlow) return false;
  return /stabilizing|mean-reverting/i.test(dealerFlow);
}

function isAmplifyingDealerFlow(dealerFlow: string | null): boolean {
  if (!dealerFlow) return false;
  return /amplifying|trend-following/i.test(dealerFlow);
}

function rodWasPublished(
  rod: CommandCenterV1DailySnapshot["spy"]["restOfDayRange"],
): boolean {
  return rod.status === "available";
}

function spotAboveLevel(
  spot: number | null,
  level: number | null,
): boolean | null {
  if (spot === null || level === null) return null;
  return spot >= level;
}

function closeVsLevel(
  close: number,
  level: number | null,
): {
  readonly above: boolean | null;
  readonly below: boolean | null;
} {
  if (level === null) return { above: null, below: null };
  return { above: close >= level, below: close <= level };
}

/** Thesis-based worked/failed — attributes only to expectations encoded in the morning snapshot. */
export function deriveDailyReviewThesisCritique(
  context: V2DailyReviewInterpretationContext,
): V2DailyReviewThesisCritique {
  const snapshot = context.morningSnapshot;
  const spy = snapshot.spy;
  const bar = context.spyBar;
  const eval_ = context.spyEval;
  const worked: string[] = [];
  const failed: string[] = [];
  const watch: string[] = [];
  const stabilizing = isStabilizingDealerFlow(spy.dealerFlow);
  const amplifying = isAmplifyingDealerFlow(spy.dealerFlow);
  const rodPublished = rodWasPublished(spy.restOfDayRange);
  const close = bar.close;
  const callWall = spy.callWall;
  const putWall = spy.putWall;
  const flip = spy.gammaFlip;
  const morningAboveFlip = spotAboveLevel(spy.spot, flip);
  const callClose = closeVsLevel(close, callWall);
  const putClose = closeVsLevel(close, putWall);
  const flipClose = closeVsLevel(close, flip);

  if (rodPublished) {
    if (eval_.rodInside === true) {
      worked.push(
        "SPY close stayed inside the published ROD 90% band — consistent with morning range expectations.",
      );
    } else if (eval_.rodInside === false) {
      failed.push(
        "SPY close finished outside the published ROD 90% band — morning range thesis challenged.",
      );
      watch.push("SPY close outside ROD — reassess range at the open");
    }
  }

  if (callWall !== null) {
    if (callClose.above) {
      if (stabilizing) {
        failed.push(
          `SPY closed at/above call wall ${callWall} — contradicts stabilizing mean-reversion morning thesis.`,
        );
        watch.push(`Monitor SPY hold above call wall ${callWall}`);
      } else if (
        amplifying &&
        flip !== null &&
        flipClose.below === true
      ) {
        worked.push(
          `SPY closed at/above call wall ${callWall} while still below gamma flip ${flip} — consistent with amplifying upside chase.`,
        );
        watch.push(`Monitor SPY hold above call wall ${callWall}`);
      } else if (amplifying) {
        worked.push(
          `SPY closed at/above call wall ${callWall} — consistent with amplifying upside chase.`,
        );
        watch.push(`Monitor SPY hold above call wall ${callWall}`);
      } else {
        watch.push(`SPY closed at/above call wall ${callWall}`);
      }
    } else if (
      eval_.callWallTouched === true &&
      stabilizing &&
      eval_.rodInside === true
    ) {
      worked.push(
        `SPY probed call wall ${callWall} but closed below it inside the ROD band.`,
      );
      watch.push(`Monitor SPY reaction at call wall ${callWall}`);
    } else if (eval_.callWallTouched === true) {
      watch.push(`SPY call wall ${callWall} was in play`);
    }
  }

  if (putWall !== null) {
    if (putClose.below) {
      if (stabilizing) {
        failed.push(
          `SPY closed at/below put wall ${putWall} — contradicts stabilizing mean-reversion morning thesis.`,
        );
        watch.push(`Monitor SPY support at put wall ${putWall}`);
      } else if (
        amplifying &&
        flip !== null &&
        flipClose.below === true
      ) {
        worked.push(
          `SPY closed at/below put wall ${putWall} while still below gamma flip ${flip} — consistent with amplifying downside pressure.`,
        );
        watch.push(`Monitor SPY support at put wall ${putWall}`);
      } else if (amplifying) {
        worked.push(
          `SPY closed at/below put wall ${putWall} — consistent with amplifying downside pressure.`,
        );
        watch.push(`Monitor SPY support at put wall ${putWall}`);
      } else {
        watch.push(`SPY closed at/below put wall ${putWall}`);
      }
    } else if (
      eval_.putWallTouched === true &&
      stabilizing &&
      eval_.rodInside === true
    ) {
      worked.push(
        `SPY probed put wall ${putWall} but closed above it inside the ROD band.`,
      );
      watch.push(`Monitor SPY support at put wall ${putWall}`);
    } else if (eval_.putWallTouched === true) {
      watch.push(`SPY put wall ${putWall} was in play`);
    }
  }

  if (flip !== null) {
    if (morningAboveFlip === true && flipClose.below === true) {
      failed.push(
        `SPY closed below gamma flip ${flip} after morning spot was above — structural regime shift.`,
      );
    } else if (morningAboveFlip === false && flipClose.above === true) {
      failed.push(
        `SPY closed above gamma flip ${flip} after morning spot was below — structural regime shift.`,
      );
    } else if (
      eval_.flipTouched === true &&
      morningAboveFlip === true &&
      flipClose.above === true
    ) {
      watch.push(
        `SPY gamma flip ${flip} was in play with close still above flip — intraday cross sequence not available from daily OHLC.`,
      );
    } else if (eval_.flipTouched === true) {
      watch.push(`SPY gamma flip ${flip} was in play`);
    }
  }

  const spyDir = eval_.direction;
  const stance = snapshot.stance;
  if (spyDir && stance) {
    if (stance === "buy" && spyDir === "up") {
      worked.push("Buy stance aligned with a positive SPY session close.");
    } else if (stance === "buy" && spyDir === "down") {
      failed.push("Buy stance conflicted with a negative SPY session close.");
    } else if (stance === "reduce" && spyDir === "down") {
      worked.push("Reduce stance aligned with a weaker SPY session close.");
    } else if (stance === "reduce" && spyDir === "up") {
      failed.push("Reduce stance conflicted with a positive SPY session close.");
    }
  }

  if (
    snapshot.breadth.signalStatus === "available" &&
    snapshot.breadth.signal &&
    spyDir
  ) {
    if (snapshot.breadth.signal === "strong" && spyDir === "up") {
      worked.push("SPY breadth strength aligned with the session outcome.");
    } else if (snapshot.breadth.signal === "weak" && spyDir === "down") {
      worked.push("Weak breadth aligned with the weaker session outcome.");
    } else if (
      (snapshot.breadth.signal === "strong" && spyDir === "down") ||
      (snapshot.breadth.signal === "weak" && spyDir === "up")
    ) {
      failed.push("Breadth signal conflicted with SPY session direction.");
    }
  }

  if (snapshot.ctaProxy.signal && spyDir) {
    if (snapshot.ctaProxy.signal === "buying" && spyDir === "up") {
      worked.push("CTA proxy buying aligned with the SPY session.");
    } else if (snapshot.ctaProxy.signal === "selling" && spyDir === "down") {
      worked.push("CTA proxy selling aligned with the SPY session.");
    } else if (
      (snapshot.ctaProxy.signal === "buying" && spyDir === "down") ||
      (snapshot.ctaProxy.signal === "selling" && spyDir === "up")
    ) {
      failed.push("CTA proxy conflicted with SPY session direction.");
    }
  }

  return { worked, failed, watch };
}

function dataMateriallyImpairsMiss(
  limitations: readonly string[],
  failed: readonly string[],
): boolean {
  if (limitations.length === 0 || failed.length === 0) return false;
  const structuralMiss = failed.some((line) =>
    /regime shift|gamma flip|ROD|contradicts stabilizing/i.test(line),
  );
  const incompleteGamma = limitations.some((line) =>
    /gamma incomplete/i.test(line),
  );
  if (structuralMiss && incompleteGamma) return true;
  const missingQqq = limitations.some((line) => /QQQ session bar/i.test(line));
  if (missingQqq && failed.some((line) => /QQQ/i.test(line))) return true;
  const staleBreadth = limitations.some((line) => /breadth dated/i.test(line));
  if (staleBreadth && failed.some((line) => /breadth/i.test(line))) return true;
  return false;
}

export function classifyDailyReviewErrorSource(
  critique: V2DailyReviewThesisCritique,
  dataQuality: V2DailyReviewPayload["dataQuality"],
): { readonly source: V2DailyReviewErrorSource; readonly explanation: string } {
  if (critique.failed.length === 0) {
    return {
      source: "none",
      explanation: "Morning thesis was broadly consistent with available session outcome.",
    };
  }

  if (dataMateriallyImpairsMiss(dataQuality.limitations, critique.failed)) {
    const limitation = dataQuality.limitations.find((line) =>
      /gamma incomplete|breadth dated|QQQ session bar/i.test(line),
    );
    return {
      source: "data",
      explanation:
        limitation ??
        "Stale or incomplete morning inputs materially impair confidence in the miss.",
    };
  }

  if (
    critique.failed.some((line) => /structural regime shift/i.test(line))
  ) {
    return {
      source: "regime",
      explanation:
        "Observable gamma-flip side changed versus morning spot (regime transition).",
    };
  }

  const hasStance = critique.failed.some((line) => /stance conflicted/i.test(line));
  const hasSignal = critique.failed.some((line) =>
    /breadth|CTA proxy conflicted/i.test(line),
  );
  const hasRod = critique.failed.some((line) => /ROD 90% band/i.test(line));
  const hasStabilizingWall = critique.failed.some((line) =>
    /contradicts stabilizing/i.test(line),
  );
  return {
    source: "model",
    explanation: hasStance
      ? "Recorded morning stance expectation was contradicted by session close."
      : hasRod
        ? "Published morning ROD range expectation was contradicted by session close."
        : hasStabilizingWall
          ? "Stabilizing dealer-flow wall-hold expectation was contradicted by session close."
          : hasSignal
            ? "Recorded morning signal alignment expectation was contradicted by session outcome."
            : "An explicit morning expectation in the snapshot was contradicted by session outcome.",
  };
}

function gammaSnapshotPayload(
  snapshot: CommandCenterV1DailySnapshot["spy"],
): V2DailyReviewPayload["morningSnapshot"]["spy"] {
  return {
    spot: snapshot.spot,
    callWall: snapshot.callWall,
    putWall: snapshot.putWall,
    gammaFlip: snapshot.gammaFlip,
    dealerFlow: snapshot.dealerFlow,
    restOfDayRange: {
      status: snapshot.restOfDayRange.status,
      lower: snapshot.restOfDayRange.lower,
      upper: snapshot.restOfDayRange.upper,
    },
  };
}

function spySessionPayload(
  context: V2DailyReviewInterpretationContext,
): V2DailyReviewPayload["sessionOutcome"]["spy"] {
  const spy = context.morningSnapshot.spy;
  const close = context.spyBar.close;
  const callClose = closeVsLevel(close, spy.callWall);
  const putClose = closeVsLevel(close, spy.putWall);
  const flipClose = closeVsLevel(close, spy.gammaFlip);
  return {
    open: context.spyBar.open,
    high: context.spyBar.high,
    low: context.spyBar.low,
    close,
    direction: context.spyEval.direction,
    callWallTouched: context.spyEval.callWallTouched,
    putWallTouched: context.spyEval.putWallTouched,
    flipTouched: context.spyEval.flipTouched,
    rodInside: context.spyEval.rodInside,
    closeAboveCallWall: callClose.above,
    closeBelowPutWall: putClose.below,
    closeAboveFlip: flipClose.above,
    closeBelowFlip: flipClose.below,
  };
}

function listMissingReviewTopics(
  payload: Omit<V2DailyReviewPayload, "dataQuality">,
): string[] {
  const missing: string[] = [];
  if (!payload.morningSnapshot.breadth.signal) missing.push("breadth");
  if (!payload.morningSnapshot.ctaProxy.signal) missing.push("ctaProxy");
  if (payload.sessionOutcome.qqq === null) missing.push("qqqSessionBar");
  if (payload.morningSnapshot.sectorRotation.leadingImproving.length === 0) {
    missing.push("sectorRotation");
  }
  return missing;
}

export function deriveV2DailyReviewDataQuality(
  view: V2CommandCenterView,
  context: V2DailyReviewInterpretationContext,
  payload: Omit<V2DailyReviewPayload, "dataQuality">,
): V2DailyReviewPayload["dataQuality"] {
  const limitations: string[] = [];
  const missingTopics = listMissingReviewTopics(payload);
  const snapshot = context.morningSnapshot;

  if (view.spyBreadth.stale && view.spyBreadth.marketSessionDate) {
    limitations.push(`Morning breadth dated (${view.spyBreadth.marketSessionDate} session)`);
  }
  if (view.gamma[0].freshness === "incomplete" || view.gamma[0].status === "incomplete") {
    limitations.push(
      `Morning SPY gamma incomplete (${view.gamma[0].dataLabel ?? view.gamma[0].sessionDate ?? "dated snapshot"})`,
    );
  }
  if (!context.qqqBar) {
    limitations.push("QQQ session bar unavailable for cross-check");
  }
  if (snapshot.sectorRotation.stale && snapshot.sectorRotation.sessionDate) {
    limitations.push(
      `Morning sector rotation dated (${snapshot.sectorRotation.sessionDate} session)`,
    );
  }

  let interpretationConfidence: V2AiStudyConfidence = "high";
  if (limitations.length >= 2) {
    interpretationConfidence = "limited";
  } else if (limitations.length === 1 || missingTopics.length >= 2) {
    interpretationConfidence = "moderate";
  }

  return {
    interpretationConfidence,
    limitations,
    missingTopics,
  };
}

export function buildV2DailyReviewPayload(
  review: V2DailyReview,
  context: V2DailyReviewInterpretationContext,
  view: V2CommandCenterView,
): V2DailyReviewPayload {
  const snapshot = context.morningSnapshot;
  const spy = snapshot.spy;
  const thesisCritique = deriveDailyReviewThesisCritique(context);
  const body = {
    promptVersion: V2_DAILY_REVIEW_PROMPT_VERSION,
    sessionDate: review.sessionDate ?? snapshot.sessionDate,
    morningThesis: {
      stance: snapshot.stance,
      stabilizingDealerFlow: isStabilizingDealerFlow(spy.dealerFlow),
      amplifyingDealerFlow: isAmplifyingDealerFlow(spy.dealerFlow),
      rodPublished: rodWasPublished(spy.restOfDayRange),
      morningSpotAboveFlip: spotAboveLevel(spy.spot, spy.gammaFlip),
    },
    morningSnapshot: {
      stance: snapshot.stance,
      riskScore: snapshot.riskScore,
      exposure: snapshot.exposure,
      spy: gammaSnapshotPayload(spy),
      qqq: {
        spot: snapshot.qqq.spot,
        callWall: snapshot.qqq.callWall,
        putWall: snapshot.qqq.putWall,
        gammaFlip: snapshot.qqq.gammaFlip,
        dealerFlow: snapshot.qqq.dealerFlow,
      },
      breadth: snapshot.breadth,
      ctaProxy: snapshot.ctaProxy,
      volMispricing: snapshot.volMispricing,
      sectorRotation: snapshot.sectorRotation,
    },
    sessionOutcome: {
      actualOutcome: review.actualOutcome,
      spy: spySessionPayload(context),
      qqq: context.qqqBar
        ? {
            open: context.qqqBar.open,
            high: context.qqqBar.high,
            low: context.qqqBar.low,
            close: context.qqqBar.close,
            direction: context.qqqEval.direction,
            callWallTouched: context.qqqEval.callWallTouched,
            putWallTouched: context.qqqEval.putWallTouched,
            flipTouched: context.qqqEval.flipTouched,
            rodInside: context.qqqEval.rodInside,
            closeAboveCallWall: closeVsLevel(
              context.qqqBar.close,
              snapshot.qqq.callWall,
            ).above,
            closeBelowPutWall: closeVsLevel(
              context.qqqBar.close,
              snapshot.qqq.putWall,
            ).below,
            closeAboveFlip: closeVsLevel(
              context.qqqBar.close,
              snapshot.qqq.gammaFlip,
            ).above,
            closeBelowFlip: closeVsLevel(
              context.qqqBar.close,
              snapshot.qqq.gammaFlip,
            ).below,
          }
        : null,
    },
    thesisCritique,
  };

  const dataQuality = deriveV2DailyReviewDataQuality(view, context, body);
  return { ...body, dataQuality };
}

function splitReviewBullets(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const parts = trimmed
    .split(/\n|;\s+|(?<=\.)\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.map((part) => (part.endsWith(".") ? part : `${part}.`));
}

function bulletsToText(lines: readonly string[], empty: string): string {
  return lines.length > 0 ? lines.join(". ") : empty;
}

export function validateV2DailyReviewLlmGrounding(
  parsed: z.infer<typeof V2DailyReviewLlmOutputSchema>,
  payload: V2DailyReviewPayload,
): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  const fullText = [
    parsed.what_worked,
    parsed.what_failed,
    parsed.error_explanation,
    parsed.tomorrow_watch,
  ].join(" ");

  if (/\b(probability|likely|chance of|%\s*chance)\b/i.test(fullText)) {
    return { ok: false, reason: "probability language not supported in payload" };
  }

  if (
    parsed.error_source === "none" &&
    payload.thesisCritique.failed.length > 0
  ) {
    return {
      ok: false,
      reason: "error_source none conflicts with thesis failures in payload",
    };
  }

  if (
    parsed.error_source === "data" &&
    !dataMateriallyImpairsMiss(
      payload.dataQuality.limitations,
      payload.thesisCritique.failed,
    )
  ) {
    return {
      ok: false,
      reason: "error_source data requires a material data limitation for the miss",
    };
  }

  const sectorMatches = fullText.match(/\bXL[A-Z]{1,2}\b/g) ?? [];
  const allowedSectors = new Set<string>();
  for (const row of [
    ...payload.morningSnapshot.sectorRotation.leadingImproving,
    ...payload.morningSnapshot.sectorRotation.weakening,
  ]) {
    allowedSectors.add(row.symbol);
    allowedSectors.add(row.label);
  }
  for (const symbol of sectorMatches) {
    if (!allowedSectors.has(symbol)) {
      return { ok: false, reason: `unsupported sector symbol ${symbol}` };
    }
  }

  return { ok: true };
}

export function buildV2DailyReviewFallback(
  review: V2DailyReview,
  payload: V2DailyReviewPayload,
  context: V2DailyReviewInterpretationContext,
): V2DailyReview {
  const dataQuality = payload.dataQuality;
  const critique = deriveDailyReviewThesisCritique(context);
  const error = classifyDailyReviewErrorSource(critique, dataQuality);
  const workedText = bulletsToText(
    critique.worked,
    "No morning thesis elements were clearly validated by available session outcome.",
  );
  const failedText = bulletsToText(
    critique.failed,
    "No morning thesis elements were clearly contradicted by available session outcome.",
  );
  const watch =
    critique.watch.length > 0
      ? critique.watch.slice(0, 2)
      : review.tomorrowWatch.length > 0
        ? review.tomorrowWatch.slice(0, 2)
        : ["Re-check SPY/QQQ structure levels and dealer flow at the open."];

  return {
    ...review,
    source: "deterministic",
    confidence: dataQuality.interpretationConfidence,
    dataLimitations: dataQuality.limitations,
    whatWorked: splitReviewBullets(workedText),
    whatFailed: splitReviewBullets(failedText),
    errorSource: error.source,
    errorExplanation: error.explanation,
    tomorrowWatch: watch,
  };
}

function interpretationFromLlmOutput(
  review: V2DailyReview,
  parsed: z.infer<typeof V2DailyReviewLlmOutputSchema>,
  dataQuality: V2DailyReviewPayload["dataQuality"],
): V2DailyReview {
  return {
    ...review,
    source: "openai",
    confidence: dataQuality.interpretationConfidence,
    dataLimitations: dataQuality.limitations,
    whatWorked: splitReviewBullets(parsed.what_worked.trim()),
    whatFailed: splitReviewBullets(parsed.what_failed.trim()),
    errorSource: parsed.error_source,
    errorExplanation: parsed.error_explanation.trim(),
    tomorrowWatch: splitReviewBullets(parsed.tomorrow_watch.trim()).slice(0, 2),
  };
}

function buildOpenAiBody(
  config: AiStudyLlmRuntimeConfig,
  userPrompt: string,
): Record<string, unknown> {
  const reasoning = openAiResponsesReasoningEffort(config.model);
  return {
    model: config.model,
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: V2_DAILY_REVIEW_SYSTEM_PROMPT }],
      },
      {
        role: "user",
        content: [{ type: "input_text", text: userPrompt }],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "v2_daily_review",
        strict: true,
        schema: V2_DAILY_REVIEW_JSON_SCHEMA,
      },
    },
    ...(reasoning ? { reasoning } : {}),
    max_output_tokens: config.maxOutputTokens,
  };
}

export async function generateV2DailyReviewInterpretation(input: {
  readonly review: V2DailyReview;
  readonly context: V2DailyReviewInterpretationContext;
  readonly view: V2CommandCenterView;
  readonly config: AiStudyLlmRuntimeConfig;
  readonly fetchImpl?: FetchLike;
  readonly apiUrl?: string;
  readonly env?: NodeJS.ProcessEnv;
}): Promise<V2DailyReview> {
  const payload = buildV2DailyReviewPayload(
    input.review,
    input.context,
    input.view,
  );
  const fallback = buildV2DailyReviewFallback(
    input.review,
    payload,
    input.context,
  );
  const env = input.env ?? process.env;
  const modelSource = describeAiStudyLlmModelSource(env);

  if (!input.config.apiKey) {
    const missing = describeMissingAiStudyLlmEnv(env);
    const missingVars =
      missing.length > 0 ? missing.join(", ") : "OPENAI_API_KEY";
    return {
      ...fallback,
      missingReason: `${missingVars} missing — set in .env or deployment environment (${modelSource}). Deterministic critique shown.`,
    };
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const apiUrl = input.apiUrl ?? OPENAI_RESPONSES_URL;
  const body = buildOpenAiBody(input.config, JSON.stringify(payload));
  const maxAttempts = 1 + input.config.maxRetries + input.config.parseRetries;
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
        lastError = `HTTP ${response.status}`;
        continue;
      }
      const json = JSON.parse(rawText) as unknown;
      const text = extractOutputText(json);
      if (!text) {
        lastError = "OpenAI response missing structured output text";
        continue;
      }
      const parsedJson = JSON.parse(text) as unknown;
      const parsed = V2DailyReviewLlmOutputSchema.safeParse(parsedJson);
      if (!parsed.success) {
        lastError = `Model output schema invalid: ${parsed.error.issues[0]?.message ?? "schema"}`;
        continue;
      }
      const grounding = validateV2DailyReviewLlmGrounding(parsed.data, payload);
      if (!grounding.ok) {
        lastError = `Grounding failed: ${grounding.reason}`;
        continue;
      }
      return interpretationFromLlmOutput(
        input.review,
        parsed.data,
        payload.dataQuality,
      );
    } catch (error: unknown) {
      lastError = error instanceof Error ? error.message : String(error);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    ...fallback,
    missingReason: `LLM unavailable (model=${input.config.model}; ${lastError}) — deterministic critique shown.`,
  };
}
