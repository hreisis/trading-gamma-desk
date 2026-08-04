import { createHash } from "node:crypto";
import type {
  StudyEvidenceBundle,
  StudyMemo,
  StudyMemoBullet,
  StudyMemoNarratorOutput,
} from "@/contracts";
import { STUDY_MEMO_PROMPT_VERSION } from "./prompt";
import {
  bundleFieldCorpus,
  enumerateBundleFieldPaths,
  pathsResolve,
} from "./citations";

const PROHIBITED =
  /\b(buy|sell|long|short|overweight|underweight|take profit|stop.?loss|bullish|bearish|hawkish|dovish)\b/i;

const PREDICTION =
  /\b(will rally|will fall|will rise|will drop|predict|forecast|expect returns|trade signal|go long|go short)\b/i;

const PRICE_LITERAL = /\$\s?\d|\bSPY at \d|\bSPX at \d/i;

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
    .replace(/–/g, "-");
}

function numbersSupported(
  text: string,
  corpus: string,
): { ok: boolean; bad?: string } {
  for (const token of extractNumericTokens(text)) {
    const n = normalizeNumToken(token);
    if (!n) continue;
    if (corpus.includes(token.replace(/,/g, ""))) continue;
    const corpusNorm = normalizeNumToken(corpus);
    if (corpusNorm.includes(n)) continue;
    if (/^\d+$/.test(n) && corpusNorm.includes(`${n}d`)) continue;
    return { ok: false, bad: token };
  }
  return { ok: true };
}

function checkBullets(
  bundle: StudyEvidenceBundle,
  allowedPaths: ReadonlySet<string>,
  bullets: readonly StudyMemoBullet[],
  label: string,
  errors: string[],
  flags: {
    citationsValid: boolean;
    numbersValid: boolean;
    prohibitedInferenceDetected: boolean;
  },
): void {
  for (const bullet of bullets) {
    if (!bullet.bundleFieldPaths.length) {
      errors.push(`${label} ${bullet.id}: missing bundleFieldPaths`);
      flags.citationsValid = false;
      continue;
    }
    const resolved = pathsResolve(bundle, bullet.bundleFieldPaths, allowedPaths);
    if (!resolved.ok) {
      errors.push(
        `${label} ${bullet.id}: unknown bundleFieldPath ${resolved.badPath}`,
      );
      flags.citationsValid = false;
    }
    const corpus = bundleFieldCorpus(bundle, bullet.bundleFieldPaths);
    const num = numbersSupported(bullet.text, corpus);
    if (!num.ok) {
      errors.push(`${label} ${bullet.id}: unsupported number/token ${num.bad}`);
      flags.numbersValid = false;
    }
    if (PROHIBITED.test(bullet.text) || PREDICTION.test(bullet.text)) {
      errors.push(`${label} ${bullet.id}: prohibited inference/trading language`);
      flags.prohibitedInferenceDetected = true;
    }
    if (PRICE_LITERAL.test(bullet.text)) {
      errors.push(`${label} ${bullet.id}: unsupported price literal`);
      flags.numbersValid = false;
    }
  }
}

export function studyMemoIdFor(parts: {
  readonly bundleId: string;
  readonly bundleSchemaVersion: string;
  readonly promptVersion: string;
  readonly model: string;
}): string {
  const digest = createHash("sha256")
    .update(
      [
        parts.bundleId,
        parts.bundleSchemaVersion,
        parts.promptVersion,
        parts.model,
      ].join("|"),
      "utf8",
    )
    .digest("hex")
    .slice(0, 16);
  return `studymemo_${digest}`;
}

export interface ValidateStudyMemoOptions {
  readonly bundle: StudyEvidenceBundle;
  readonly output: StudyMemoNarratorOutput;
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
export function validateStudyMemoOutput(
  options: ValidateStudyMemoOptions,
): StudyMemo {
  const promptVersion = options.promptVersion ?? STUDY_MEMO_PROMPT_VERSION;
  const allowedPaths = enumerateBundleFieldPaths(options.bundle);
  const errors: string[] = [];
  const flags = {
    citationsValid: true,
    numbersValid: true,
    prohibitedInferenceDetected: false,
  };

  if (options.output.evidence.length < 1) {
    errors.push("evidence must contain at least one bullet");
    flags.citationsValid = false;
  }

  checkBullets(
    options.bundle,
    allowedPaths,
    options.output.evidence,
    "evidence",
    errors,
    flags,
  );
  checkBullets(
    options.bundle,
    allowedPaths,
    options.output.inference,
    "inference",
    errors,
    flags,
  );
  checkBullets(
    options.bundle,
    allowedPaths,
    options.output.limitations,
    "limitations",
    errors,
    flags,
  );
  checkBullets(
    options.bundle,
    allowedPaths,
    options.output.unknowns,
    "unknowns",
    errors,
    flags,
  );

  const headlineCorpus = bundleFieldCorpus(
    options.bundle,
    options.output.evidence.flatMap((b) => b.bundleFieldPaths),
  );
  const headlineNums = numbersSupported(options.output.headline, headlineCorpus);
  if (!headlineNums.ok) {
    errors.push(`headline: unsupported number/token ${headlineNums.bad}`);
    flags.numbersValid = false;
  }
  if (
    PROHIBITED.test(options.output.headline) ||
    PREDICTION.test(options.output.headline) ||
    PRICE_LITERAL.test(options.output.headline)
  ) {
    errors.push("headline: prohibited inference/trading language");
    flags.prohibitedInferenceDetected = true;
  }

  if (
    options.bundle.cohortQuality.warnings.length > 0 &&
    options.output.limitations.length === 0 &&
    options.output.unknowns.length === 0
  ) {
    errors.push("bundle warnings present — memo must note limitations or unknowns");
    flags.citationsValid = false;
  }

  const status: StudyMemo["status"] =
    errors.length === 0
      ? options.bundle.cohortQuality.status === "thin"
        ? "partial"
        : "complete"
      : "rejected";

  return {
    kind: "StudyMemo",
    schemaVersion: "0.1.0",
    id: studyMemoIdFor({
      bundleId: options.bundle.bundleId,
      bundleSchemaVersion: options.bundle.schemaVersion,
      promptVersion,
      model: options.model,
    }),
    bundleId: options.bundle.bundleId,
    bundleSchemaVersion: options.bundle.schemaVersion,
    promptVersion,
    provider: options.provider,
    model: options.model,
    generatedAt: options.generatedAt,
    status,
    headline: options.output.headline,
    evidence: options.output.evidence,
    inference: options.output.inference,
    limitations: options.output.limitations,
    unknowns: options.output.unknowns,
    validation: {
      schemaValid: true,
      citationsValid: flags.citationsValid,
      numbersValid: flags.numbersValid,
      prohibitedInferenceDetected: flags.prohibitedInferenceDetected,
      errors,
    },
    synthetic: options.synthetic ?? false,
  };
}

export function unavailableStudyMemo(options: {
  readonly bundle: StudyEvidenceBundle;
  readonly provider: string;
  readonly model: string;
  readonly generatedAt: string;
  readonly error: string;
  readonly synthetic?: boolean;
}): StudyMemo {
  return {
    kind: "StudyMemo",
    schemaVersion: "0.1.0",
    id: studyMemoIdFor({
      bundleId: options.bundle.bundleId,
      bundleSchemaVersion: options.bundle.schemaVersion,
      promptVersion: STUDY_MEMO_PROMPT_VERSION,
      model: options.model,
    }),
    bundleId: options.bundle.bundleId,
    bundleSchemaVersion: options.bundle.schemaVersion,
    promptVersion: STUDY_MEMO_PROMPT_VERSION,
    provider: options.provider,
    model: options.model,
    generatedAt: options.generatedAt,
    status: "unavailable",
    headline: "Study memo unavailable",
    evidence: [],
    inference: [],
    limitations: [],
    unknowns: [
      {
        id: "unk_unavailable",
        text: options.error,
        bundleFieldPaths: ["bundle.bundleId"],
      },
    ],
    validation: {
      schemaValid: true,
      citationsValid: false,
      numbersValid: true,
      prohibitedInferenceDetected: false,
      errors: [options.error],
    },
    synthetic: options.synthetic ?? false,
  };
}

export function abstainStudyMemo(options: {
  readonly bundle: StudyEvidenceBundle;
  readonly provider: string;
  readonly model: string;
  readonly generatedAt: string;
  readonly synthetic?: boolean;
}): StudyMemo {
  const { bundle } = options;
  const limitationBullets: StudyMemoBullet[] = bundle.limitations
    .slice(0, 3)
    .map((text, i) => ({
      id: `lim_${i + 1}`,
      text,
      bundleFieldPaths: ["bundle.limitations"],
    }));

  const unknownBullets: StudyMemoBullet[] = [
    {
      id: "unk_insufficient",
      text: `Evidence status is ${bundle.evidenceStatus}; similar-regime cohort is not adequate for inference.`,
      bundleFieldPaths: [
        "bundle.evidenceStatus",
        "bundle.cohortQuality.status",
      ],
    },
  ];
  if (bundle.cohortQuality.warnings.length > 0) {
    unknownBullets.push({
      id: "unk_warnings",
      text: `Cohort warnings: ${bundle.cohortQuality.warnings.join("; ")}`,
      bundleFieldPaths: ["bundle.cohortQuality.warnings"],
    });
  }

  return {
    kind: "StudyMemo",
    schemaVersion: "0.1.0",
    id: studyMemoIdFor({
      bundleId: bundle.bundleId,
      bundleSchemaVersion: bundle.schemaVersion,
      promptVersion: STUDY_MEMO_PROMPT_VERSION,
      model: options.model,
    }),
    bundleId: bundle.bundleId,
    bundleSchemaVersion: bundle.schemaVersion,
    promptVersion: STUDY_MEMO_PROMPT_VERSION,
    provider: options.provider,
    model: options.model,
    generatedAt: options.generatedAt,
    status: "abstained",
    headline: "Insufficient evidence — study memo abstained",
    evidence: [
      {
        id: "ev_status",
        text: `Primary horizon ${bundle.primaryHorizon} evidence status is ${bundle.evidenceStatus}.`,
        bundleFieldPaths: [
          "bundle.primaryHorizon",
          "bundle.evidenceStatus",
          "bundle.statusBasis.ruleId",
        ],
      },
    ],
    inference: [],
    limitations: limitationBullets,
    unknowns: unknownBullets,
    validation: {
      schemaValid: true,
      citationsValid: true,
      numbersValid: true,
      prohibitedInferenceDetected: false,
      errors: ["abstained: insufficient evidence — LLM not invoked"],
    },
    synthetic: options.synthetic ?? false,
  };
}
