import type {
  AiNarratorOutput,
  OfficialAiBrief,
  OfficialBrief,
} from "@/contracts";
import { createHash } from "node:crypto";
import { AI_BRIEF_PROMPT_VERSION } from "./prompt";

const PROHIBITED =
  /\b(hawkish|dovish|bullish|bearish|beat|miss|hotter than expected|cooler than expected|buy|sell|overweight|underweight|long|short|take profit|stop.?loss)\b/i;

const CONSENSUS_BEAT_MISS =
  /\b(beat(s|ing)?|miss(es|ed|ing)?)\b.{0,40}\b(consensus|expect|forecast|estimate)\b|\b(above|below)\s+expect/i;

function extractNumericTokens(text: string): string[] {
  const out: string[] = [];
  const re =
    /\$?-?\d{1,3}(?:,\d{3})*(?:\.\d+)?%?|\d+(?:\.\d+)?(?:\s*[-–to]+\s*\d+(?:\.\d+)?)?(?:\s*percent)?/gi;
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
    .replace(/\$/g, "")
    .replace(/%/g, "")
    .replace(/\s*percent\s*/g, "")
    .replace(/\s+/g, "")
    .replace(/–/g, "-")
    .replace(/to/g, "-");
}

function allowedNumberCorpus(brief: OfficialBrief, factIds: string[]): string {
  const facts = brief.facts.filter((f) => factIds.includes(f.id));
  const parts: string[] = [
    brief.referencePeriod ?? "",
    brief.releaseFamily,
  ];
  for (const f of facts) {
    parts.push(f.text, f.label, f.evidence.excerpt);
    for (const v of f.values ?? []) {
      parts.push(String(v.value), v.unit, v.period ?? "");
    }
  }
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
    // Skip pure year tokens already in metadata if present
    if (allowed.has(n)) continue;
    // Allow range parts if both ends appear
    if (n.includes("-")) {
      const [a, b] = n.split("-");
      if (a && b && allowed.has(a) && allowed.has(b)) continue;
    }
    // Allow if corpus contains the raw number loosely
    if (corpus.includes(token.replace(/,/g, ""))) continue;
    if ([...allowed].some((a) => a.includes(n) || n.includes(a))) continue;
    return { ok: false, bad: token };
  }
  return { ok: true };
}

export function aiBriefIdFor(parts: {
  readonly inputBriefId: string;
  readonly documentContentHash: string;
  readonly extractorVersion: string;
  readonly promptVersion: string;
  readonly model: string;
}): string {
  const digest = createHash("sha256")
    .update(
      [
        parts.inputBriefId,
        parts.documentContentHash,
        parts.extractorVersion,
        parts.promptVersion,
        parts.model,
      ].join("|"),
      "utf8",
    )
    .digest("hex")
    .slice(0, 16);
  return `oaibrief_${digest}`;
}

export interface ValidateAiBriefOptions {
  readonly input: OfficialBrief;
  readonly output: AiNarratorOutput;
  readonly provider: string;
  readonly model: string;
  readonly generatedAt: string;
  readonly promptVersion?: string;
  readonly synthetic?: boolean;
}

/**
 * Local hard validation after LLM structured output.
 * Schema-valid JSON alone is never sufficient.
 */
export function validateAiBriefOutput(
  options: ValidateAiBriefOptions,
): OfficialAiBrief {
  const promptVersion = options.promptVersion ?? AI_BRIEF_PROMPT_VERSION;
  const factIds = new Set(options.input.facts.map((f) => f.id));
  const errors: string[] = [];
  let citationsValid = true;
  let numbersValid = true;
  let prohibitedInferenceDetected = false;

  if (options.input.status === "unavailable") {
    errors.push("input brief unavailable — AI must not run");
  }
  if (
    options.input.status === "partial" &&
    options.output.limitations.every(
      (l) => !/incomplete|partial/i.test(l),
    )
  ) {
    errors.push("partial input requires an incompleteness limitation");
  }

  if (options.output.bullets.length < 2 || options.output.bullets.length > 4) {
    errors.push("bullet count must be 2–4");
    citationsValid = false;
  }

  for (const bullet of options.output.bullets) {
    if (!bullet.factIds.length) {
      errors.push(`bullet ${bullet.id}: missing factIds`);
      citationsValid = false;
      continue;
    }
    for (const id of bullet.factIds) {
      if (!factIds.has(id)) {
        errors.push(`bullet ${bullet.id}: unknown factId ${id}`);
        citationsValid = false;
      }
    }
    const corpus = allowedNumberCorpus(options.input, bullet.factIds);
    const num = numbersSupported(bullet.text, corpus);
    if (!num.ok) {
      errors.push(`bullet ${bullet.id}: unsupported number/token ${num.bad}`);
      numbersValid = false;
    }
    if (PROHIBITED.test(bullet.text) || CONSENSUS_BEAT_MISS.test(bullet.text)) {
      errors.push(`bullet ${bullet.id}: prohibited inference/trading language`);
      prohibitedInferenceDetected = true;
    }
  }

  const headlineCorpus = allowedNumberCorpus(
    options.input,
    options.output.bullets.flatMap((b) => b.factIds),
  );
  const headlineNums = numbersSupported(options.output.headline, headlineCorpus);
  if (!headlineNums.ok) {
    errors.push(`headline: unsupported number/token ${headlineNums.bad}`);
    numbersValid = false;
  }
  if (
    PROHIBITED.test(options.output.headline) ||
    CONSENSUS_BEAT_MISS.test(options.output.headline)
  ) {
    errors.push("headline: prohibited inference/trading language");
    prohibitedInferenceDetected = true;
  }

  if (
    options.input.referencePeriod &&
    options.output.headline.includes(options.input.referencePeriod) === false &&
    options.output.bullets.some((b) =>
      /\b20\d{2}(?:-Q[1-4]|-\d{2})?\b/.test(b.text),
    )
  ) {
    // Soft: only reject if a different period-looking token appears
    for (const b of options.output.bullets) {
      const periods = b.text.match(/\b20\d{2}(?:-Q[1-4]|-\d{2})\b/g) ?? [];
      for (const p of periods) {
        if (p !== options.input.referencePeriod) {
          errors.push(`entity mismatch: unexpected period ${p}`);
        }
      }
    }
  }

  const schemaValid = errors.length === 0 || !errors.some((e) =>
    e.includes("schema"),
  );
  const hardFail =
    !citationsValid ||
    !numbersValid ||
    prohibitedInferenceDetected ||
    errors.length > 0;

  let status: OfficialAiBrief["status"] = hardFail
    ? "rejected"
    : options.input.status === "partial"
      ? "partial"
      : "complete";

  if (options.input.status === "partial" && status === "complete") {
    status = "partial";
  }

  return {
    schemaVersion: "0.1.0",
    id: aiBriefIdFor({
      inputBriefId: options.input.id,
      documentContentHash: options.input.documentContentHash,
      extractorVersion: options.input.extractorVersion,
      promptVersion,
      model: options.model,
    }),
    inputBriefId: options.input.id,
    documentId: options.input.documentId,
    documentContentHash: options.input.documentContentHash,
    extractorVersion: options.input.extractorVersion,
    promptVersion,
    provider: options.provider,
    model: options.model,
    generatedAt: options.generatedAt,
    status,
    headline: options.output.headline,
    bullets: options.output.bullets,
    limitations: [
      ...options.output.limitations,
      ...(options.input.status === "partial"
        ? ["Input deterministic brief was partial — summary may be incomplete."]
        : []),
    ],
    validation: {
      schemaValid,
      citationsValid,
      numbersValid,
      prohibitedInferenceDetected,
      errors,
    },
    synthetic: options.synthetic ?? options.input.synthetic,
  };
}

export function unavailableAiBrief(options: {
  readonly input: OfficialBrief;
  readonly provider: string;
  readonly model: string;
  readonly generatedAt: string;
  readonly error: string;
  readonly promptVersion?: string;
}): OfficialAiBrief {
  const promptVersion = options.promptVersion ?? AI_BRIEF_PROMPT_VERSION;
  return {
    schemaVersion: "0.1.0",
    id: aiBriefIdFor({
      inputBriefId: options.input.id,
      documentContentHash: options.input.documentContentHash,
      extractorVersion: options.input.extractorVersion,
      promptVersion,
      model: options.model,
    }),
    inputBriefId: options.input.id,
    documentId: options.input.documentId,
    documentContentHash: options.input.documentContentHash,
    extractorVersion: options.input.extractorVersion,
    promptVersion,
    provider: options.provider,
    model: options.model,
    generatedAt: options.generatedAt,
    status: "unavailable",
    headline: "AI brief unavailable",
    bullets: [],
    limitations: [options.error],
    validation: {
      schemaValid: false,
      citationsValid: false,
      numbersValid: false,
      prohibitedInferenceDetected: false,
      errors: [options.error],
    },
    synthetic: options.input.synthetic,
  };
}
