import { createHash } from "node:crypto";
import type {
  AiMarketReactionNarrative,
  AiMarketReactionNarratorOutput,
  EventMarketContext,
  EventMarketReaction,
} from "@/contracts";
import type { ReactionEvidenceItem } from "./evidence";
import { AI_REACTION_PROMPT_VERSION } from "./prompt";

const PROHIBITED =
  /\b(hawkish|dovish|bullish|bearish|beat|miss|hotter than expected|cooler than expected|buy|sell|overweight|underweight|take profit|stop.?loss|risk-on|risk-off|liked|disliked|investors interpreted|fund flows?|rotation)\b/i;

const CAUSAL =
  /\b(because|caused|led to|driven by|in response to|as a result of)\b/i;

const BAD_ENTITY =
  /\b(DXY|dollar index|treasury yields?|10[\s-]?year yield|S&P 500 index|official index)\b/i;

function extractNumericTokens(text: string): string[] {
  const out: string[] = [];
  const re =
    /-?\d{1,3}(?:,\d{3})*(?:\.\d+)?%?|\d+(?:\.\d+)?(?:\s*percent)?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const token = m[0]!.trim();
    if (token) out.push(token);
  }
  return out;
}

function normalizeNumToken(token: string): string {
  return token
    .toLowerCase()
    .replace(/,/g, "")
    .replace(/%/g, "")
    .replace(/\s*percent\s*/g, "")
    .replace(/\s+/g, "");
}

function corpusForEvidence(
  items: readonly ReactionEvidenceItem[],
  ids: readonly string[],
): string {
  const set = new Set(ids);
  const parts: string[] = [];
  for (const e of items) {
    if (!set.has(e.evidenceId)) continue;
    parts.push(
      e.evidenceId,
      e.window ?? "",
      e.symbol ?? "",
      String(e.value),
      e.classification ?? "",
      e.baselineTimestamp ?? "",
      e.windowTimestamp ?? "",
    );
  }
  // Allow window labels in prose
  parts.push("+5m", "+30m", "+2h", "5m", "30m", "2h", "session close", "0");
  return parts.join(" ");
}

function numbersSupported(
  text: string,
  corpus: string,
): { ok: boolean; bad?: string } {
  const allowed = new Set(
    extractNumericTokens(corpus).map(normalizeNumToken).filter(Boolean),
  );
  for (const token of extractNumericTokens(text)) {
    const n = normalizeNumToken(token);
    if (!n) continue;
    if (allowed.has(n)) continue;
    if (corpus.includes(token.replace(/,/g, ""))) continue;
    if ([...allowed].some((a) => a.includes(n) || n.includes(a))) continue;
    return { ok: false, bad: token };
  }
  return { ok: true };
}

function classificationMismatch(
  text: string,
  cited: readonly ReactionEvidenceItem[],
): string | null {
  const breadth = cited.find((e) => e.kind === "equityBreadth");
  if (breadth) {
    if (
      /broadly higher/i.test(text) &&
      breadth.value !== "broadly_higher"
    ) {
      return "breadth mismatch: text says broadly higher";
    }
    if (
      /broadly lower/i.test(text) &&
      breadth.value !== "broadly_lower"
    ) {
      return "breadth mismatch: text says broadly lower";
    }
  }
  const lead = cited.find((e) => e.kind === "leadership");
  if (lead) {
    if (
      /nasdaq proxy leads|qqq outperformed/i.test(text) &&
      lead.value !== "nasdaq_proxy_leads"
    ) {
      return "leadership mismatch";
    }
    if (
      /small-cap proxy leads|iwm outperformed/i.test(text) &&
      lead.value !== "small_cap_proxy_leads"
    ) {
      return "leadership mismatch";
    }
  }
  const dev = cited.find((e) => e.kind === "development");
  if (dev && typeof dev.value === "string") {
    for (const word of [
      "extended",
      "held",
      "faded",
      "reversed",
    ] as const) {
      if (new RegExp(`\\b${word}\\b`, "i").test(text) && dev.value !== word) {
        // Only fail if this development evidence is the primary cited and text asserts a different path word
        if (cited.filter((c) => c.kind === "development").length === 1) {
          return `development mismatch: text says ${word}`;
        }
      }
    }
  }
  return null;
}

export function aiMarketReactionIdFor(parts: {
  readonly catalystId: string;
  readonly marketContextIdentity: string;
  readonly marketReactionIdentity: string;
  readonly reactionRulesVersion: string;
  readonly promptVersion: string;
  readonly model: string;
}): string {
  const digest = createHash("sha256")
    .update(
      [
        parts.catalystId,
        parts.marketContextIdentity,
        parts.marketReactionIdentity,
        parts.reactionRulesVersion,
        parts.promptVersion,
        parts.model,
      ].join("|"),
      "utf8",
    )
    .digest("hex")
    .slice(0, 16);
  return `aimrxn_${digest}`;
}

export interface ValidateAiMarketReactionOptions {
  readonly context: EventMarketContext;
  readonly reaction: EventMarketReaction;
  readonly evidence: readonly ReactionEvidenceItem[];
  readonly marketContextIdentity: string;
  readonly marketReactionIdentity: string;
  readonly output: AiMarketReactionNarratorOutput;
  readonly provider: string;
  readonly model: string;
  readonly generatedAt: string;
  readonly promptVersion?: string;
  readonly synthetic?: boolean;
  readonly usage?: AiMarketReactionNarrative["usage"];
}

export function validateAiMarketReactionOutput(
  options: ValidateAiMarketReactionOptions,
): AiMarketReactionNarrative {
  const promptVersion = options.promptVersion ?? AI_REACTION_PROMPT_VERSION;
  const evidenceById = new Map(
    options.evidence.map((e) => [e.evidenceId, e]),
  );
  const errors: string[] = [];
  let citationsValid = true;
  let numbersValid = true;
  let prohibited = false;

  if (options.reaction.status === "insufficient") {
    errors.push("input reaction insufficient — AI must not narrate as complete");
  }
  if (
    options.context.id !== options.reaction.marketContextId ||
    options.marketContextIdentity !== options.reaction.marketContextIdentity
  ) {
    errors.push("stale market context / reaction identity mismatch");
  }

  if (
    (options.reaction.status === "partial" ||
      options.context.status === "partial") &&
    options.output.limitations.every(
      (l) => !/unavailable|partial|incomplete|missing/i.test(l),
    )
  ) {
    errors.push("partial input requires an incompleteness limitation");
  }

  if (
    options.output.bullets.length < 2 ||
    options.output.bullets.length > 4
  ) {
    errors.push("bullet count must be 2–4");
    citationsValid = false;
  }

  const texts = [
    options.output.headline,
    ...options.output.bullets.map((b) => b.text),
  ];
  for (const t of texts) {
    if (PROHIBITED.test(t) || CAUSAL.test(t)) {
      errors.push("prohibited causal/tone/trading language");
      prohibited = true;
    }
    if (BAD_ENTITY.test(t)) {
      errors.push("forbidden entity rewrite (DXY/yield/index)");
      prohibited = true;
    }
  }

  for (const bullet of options.output.bullets) {
    if (!bullet.evidenceIds.length) {
      errors.push(`bullet ${bullet.id}: missing evidenceIds`);
      citationsValid = false;
      continue;
    }
    const cited: ReactionEvidenceItem[] = [];
    for (const id of bullet.evidenceIds) {
      const ev = evidenceById.get(id);
      if (!ev) {
        errors.push(`bullet ${bullet.id}: unknown evidenceId ${id}`);
        citationsValid = false;
        continue;
      }
      if (
        ev.sourceContextId !== options.context.id ||
        ev.sourceReactionId !== options.reaction.id ||
        ev.marketContextIdentity !== options.marketContextIdentity ||
        ev.marketReactionIdentity !== options.marketReactionIdentity
      ) {
        errors.push(`bullet ${bullet.id}: evidence identity mismatch`);
        citationsValid = false;
      }
      cited.push(ev);
    }
    const corpus = corpusForEvidence(options.evidence, bullet.evidenceIds);
    const num = numbersSupported(bullet.text, corpus);
    if (!num.ok) {
      errors.push(`bullet ${bullet.id}: unsupported number/token ${num.bad}`);
      numbersValid = false;
    }
    const mismatch = classificationMismatch(bullet.text, cited);
    if (mismatch) errors.push(`bullet ${bullet.id}: ${mismatch}`);
  }

  const headlineCorpus = corpusForEvidence(
    options.evidence,
    options.output.bullets.flatMap((b) => b.evidenceIds),
  );
  const headlineNums = numbersSupported(
    options.output.headline,
    headlineCorpus,
  );
  if (!headlineNums.ok) {
    errors.push(`headline: unsupported number/token ${headlineNums.bad}`);
    numbersValid = false;
  }

  const hardFail =
    !citationsValid ||
    !numbersValid ||
    prohibited ||
    errors.length > 0;

  let status: AiMarketReactionNarrative["status"] = hardFail
    ? "rejected"
    : options.reaction.status === "partial" ||
        options.context.status === "partial"
      ? "partial"
      : "complete";

  if (
    (options.reaction.status === "partial" ||
      options.context.status === "partial") &&
    status === "complete"
  ) {
    status = "partial";
  }
  if (options.reaction.status === "insufficient" && !hardFail) {
    status = "partial";
  }

  return {
    schemaVersion: "0.1.0",
    id: aiMarketReactionIdFor({
      catalystId: options.reaction.catalystId,
      marketContextIdentity: options.marketContextIdentity,
      marketReactionIdentity: options.marketReactionIdentity,
      reactionRulesVersion: options.reaction.reactionRulesVersion,
      promptVersion,
      model: options.model,
    }),
    catalystId: options.reaction.catalystId,
    marketContextId: options.context.id,
    marketContextIdentity: options.marketContextIdentity,
    marketReactionId: options.reaction.id,
    marketReactionIdentity: options.marketReactionIdentity,
    reactionRulesVersion: options.reaction.reactionRulesVersion,
    promptVersion,
    provider: options.provider,
    model: options.model,
    status,
    // Rejected narratives must not surface partial AI copy in UI/cache consumers.
    headline: hardFail ? undefined : options.output.headline,
    bullets: hardFail ? undefined : options.output.bullets,
    validationErrors: errors,
    usage: options.usage,
    generatedAt: options.generatedAt,
    synthetic: options.synthetic ?? options.reaction.synthetic,
  };
}

export function unavailableAiMarketReaction(options: {
  readonly context: EventMarketContext;
  readonly reaction: EventMarketReaction;
  readonly marketContextIdentity: string;
  readonly marketReactionIdentity: string;
  readonly provider: string;
  readonly model: string;
  readonly generatedAt: string;
  readonly error: string;
  readonly promptVersion?: string;
}): AiMarketReactionNarrative {
  const promptVersion = options.promptVersion ?? AI_REACTION_PROMPT_VERSION;
  return {
    schemaVersion: "0.1.0",
    id: aiMarketReactionIdFor({
      catalystId: options.reaction.catalystId,
      marketContextIdentity: options.marketContextIdentity,
      marketReactionIdentity: options.marketReactionIdentity,
      reactionRulesVersion: options.reaction.reactionRulesVersion,
      promptVersion,
      model: options.model,
    }),
    catalystId: options.reaction.catalystId,
    marketContextId: options.context.id,
    marketContextIdentity: options.marketContextIdentity,
    marketReactionId: options.reaction.id,
    marketReactionIdentity: options.marketReactionIdentity,
    reactionRulesVersion: options.reaction.reactionRulesVersion,
    promptVersion,
    provider: options.provider,
    model: options.model,
    status: "unavailable",
    validationErrors: [options.error],
    generatedAt: options.generatedAt,
    synthetic: options.reaction.synthetic,
  };
}
