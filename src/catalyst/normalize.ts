import { createHash } from "node:crypto";
import {
  Catalyst,
  CatalystCategory,
  CatalystDirection,
  CatalystImportance,
  CatalystMacroChannel,
  CatalystSourceType,
  CatalystStatus,
  CATALYST_SCHEMA_VERSION,
  compareCatalystImportance,
  type Catalyst as CatalystType,
} from "@/contracts";
import type { CatalystRawEvent, NormalizeResult } from "./types";

const CONFIDENCE_NOTE =
  "classification clarity only — not a market direction probability" as const;

const CATEGORY_MAP: Record<string, CatalystCategory> = {
  "monetary-policy": "monetary-policy",
  monetary_policy: "monetary-policy",
  fomc: "monetary-policy",
  fed: "monetary-policy",
  rates: "monetary-policy",
  inflation: "inflation",
  cpi: "inflation",
  pce: "inflation",
  labor: "labor",
  payrolls: "labor",
  nfp: "labor",
  employment: "labor",
  growth: "growth",
  gdp: "growth",
  fiscal: "fiscal",
  geopolitics: "geopolitics",
  geopolitical: "geopolitics",
  energy: "energy",
  oil: "energy",
  liquidity: "liquidity",
  earnings: "earnings",
  positioning: "positioning",
  other: "other",
};

const STATUS_MAP: Record<string, CatalystStatus> = {
  upcoming: "upcoming",
  scheduled: "upcoming",
  released: "released",
  printed: "released",
  developing: "developing",
  breaking: "developing",
  resolved: "resolved",
  closed: "resolved",
};

const DIRECTION_MAP: Record<string, CatalystDirection> = {
  "risk-on": "risk-on",
  risk_on: "risk-on",
  "risk-off": "risk-off",
  risk_off: "risk-off",
  inflationary: "inflationary",
  disinflationary: "disinflationary",
  "growth-positive": "growth-positive",
  growth_positive: "growth-positive",
  "growth-negative": "growth-negative",
  growth_negative: "growth-negative",
  mixed: "mixed",
  unclear: "unclear",
};

const CHANNEL_MAP: Record<string, CatalystMacroChannel> = {
  fed_rates: "fed_rates",
  rates: "fed_rates",
  inflation: "inflation",
  growth: "growth",
  liquidity: "liquidity",
  risk_sentiment: "risk_sentiment",
  risk: "risk_sentiment",
  energy: "energy",
  earnings: "earnings",
  other: "other",
};

const DEFAULT_CHANNELS: Record<CatalystCategory, CatalystMacroChannel[]> = {
  "monetary-policy": ["fed_rates"],
  inflation: ["inflation"],
  labor: ["growth", "fed_rates"],
  growth: ["growth"],
  fiscal: ["growth", "liquidity"],
  geopolitics: ["risk_sentiment"],
  energy: ["energy", "inflation"],
  liquidity: ["liquidity"],
  earnings: ["earnings", "growth"],
  positioning: ["other"],
  other: ["other"],
};

const CATEGORY_IMPORTANCE_FLOOR: Record<CatalystCategory, CatalystImportance> = {
  "monetary-policy": "high",
  inflation: "high",
  labor: "high",
  growth: "medium",
  fiscal: "medium",
  geopolitics: "high",
  energy: "medium",
  liquidity: "medium",
  earnings: "medium",
  positioning: "low",
  other: "low",
};

function stripDiacritics(s: string): string {
  return s.normalize("NFKD").replace(/\p{M}/gu, "");
}

function normalizeToken(s: string): string {
  return stripDiacritics(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Normalize to ISO-8601 with explicit offset or Z. */
export function normalizeDateTime(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Already contract-shaped.
  if (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(
      trimmed,
    )
  ) {
    return trimmed;
  }
  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function mapCategory(raw: string | undefined): CatalystCategory | null {
  if (!raw) return null;
  const key = normalizeToken(raw).replace(/\s+/g, "_");
  return CATEGORY_MAP[key] ?? CATEGORY_MAP[normalizeToken(raw)] ?? null;
}

export function mapStatus(raw: string | undefined): CatalystStatus | null {
  if (!raw) return null;
  return STATUS_MAP[normalizeToken(raw).replace(/\s+/g, "_")] ?? null;
}

export function mapDirection(raw: string | undefined): CatalystDirection {
  if (!raw) return "unclear";
  return (
    DIRECTION_MAP[normalizeToken(raw).replace(/\s+/g, "_")] ??
    DIRECTION_MAP[normalizeToken(raw).replace(/\s+/g, "-")] ??
    "unclear"
  );
}

export function mapSourceType(raw: string | undefined): CatalystSourceType {
  const key = normalizeToken(raw ?? "synthetic").replace(/\s+/g, "_");
  if (
    key === "calendar" ||
    key === "news" ||
    key === "social" ||
    key === "manual" ||
    key === "synthetic"
  ) {
    return key;
  }
  return "synthetic";
}

export function mapChannels(
  category: CatalystCategory,
  raw: readonly string[] | undefined,
): CatalystMacroChannel[] {
  if (raw && raw.length > 0) {
    const mapped = raw
      .map((c) => CHANNEL_MAP[normalizeToken(c).replace(/\s+/g, "_")])
      .filter((c): c is CatalystMacroChannel => c !== undefined);
    if (mapped.length > 0) return [...new Set(mapped)];
  }
  return DEFAULT_CHANNELS[category];
}

/**
 * Deterministic importance: max(floor(category), raw hint, keyword bump).
 * Never computed in the UI.
 */
export function rankImportance(options: {
  readonly category: CatalystCategory;
  readonly rawImportance?: string;
  readonly headline: string;
  readonly status: CatalystStatus;
}): CatalystImportance {
  let best: CatalystImportance = CATEGORY_IMPORTANCE_FLOOR[options.category];
  const raw = options.rawImportance
    ? normalizeToken(options.rawImportance)
    : "";
  if (raw === "critical" || raw === "high" || raw === "medium" || raw === "low") {
    if (compareCatalystImportance(raw, best) > 0) best = raw;
  }
  const text = normalizeToken(options.headline);
  if (
    /\b(emergency|war|attack|halt|crisis|surprise)\b/.test(text) &&
    compareCatalystImportance("critical", best) > 0
  ) {
    best = "critical";
  } else if (
    /\b(fomc|cpi|payroll|nfp|opec)\b/.test(text) &&
    compareCatalystImportance("high", best) > 0
  ) {
    best = "high";
  }
  if (options.status === "upcoming" && best === "critical") {
    // Upcoming scheduled prints rarely warrant critical until released.
    best = "high";
  }
  return best;
}

export function buildDedupeKey(options: {
  readonly externalId?: string;
  readonly sourceName: string;
  readonly category: CatalystCategory;
  readonly occurredAt: string;
  readonly headline: string;
}): string {
  if (options.externalId && options.externalId.trim()) {
    return `ext:${normalizeToken(options.externalId).replace(/\s+/g, "-")}`;
  }
  const day = options.occurredAt.slice(0, 10);
  const head = normalizeToken(options.headline).slice(0, 80).replace(/\s+/g, "-");
  const src = normalizeToken(options.sourceName).replace(/\s+/g, "-");
  return `${src}|${options.category}|${day}|${head}`;
}

export function buildCatalystId(dedupeKey: string): string {
  const digest = createHash("sha256").update(dedupeKey).digest("hex").slice(0, 16);
  return `cat_${digest}`;
}

function classificationConfidence(options: {
  readonly categoryKnown: boolean;
  readonly direction: CatalystDirection;
  readonly hasEvidence: boolean;
  readonly hasAssets: boolean;
}): { score: number; calibrated: false; note: typeof CONFIDENCE_NOTE } {
  let score = 40;
  if (options.categoryKnown) score += 25;
  if (options.direction !== "unclear") score += 15;
  if (options.hasEvidence) score += 10;
  if (options.hasAssets) score += 10;
  return {
    score: Math.min(100, score),
    calibrated: false,
    note: CONFIDENCE_NOTE,
  };
}

/**
 * Pure: raw event → canonical Catalyst, or a structured validation error.
 * Does not touch the network, UI, or macro regime scoring.
 */
export function normalizeCatalystEvent(raw: CatalystRawEvent): NormalizeResult {
  if (raw.synthetic !== true) {
    return {
      ok: false,
      error: "M2-1 accepts only synthetic raw events (synthetic: true)",
      path: "synthetic",
      raw,
    };
  }
  if (!raw.headline?.trim()) {
    return { ok: false, error: "headline is required", path: "headline", raw };
  }
  if (!raw.sourceName?.trim()) {
    return {
      ok: false,
      error: "sourceName is required",
      path: "sourceName",
      raw,
    };
  }
  const occurredAt = raw.occurredAt
    ? normalizeDateTime(raw.occurredAt)
    : null;
  const observedAt = raw.observedAt
    ? normalizeDateTime(raw.observedAt)
    : occurredAt;
  if (!occurredAt) {
    return {
      ok: false,
      error: "occurredAt missing or not a parseable datetime",
      path: "occurredAt",
      raw,
    };
  }
  if (!observedAt) {
    return {
      ok: false,
      error: "observedAt missing or not a parseable datetime",
      path: "observedAt",
      raw,
    };
  }

  const category = mapCategory(raw.rawCategory);
  if (!category) {
    return {
      ok: false,
      error: `unknown rawCategory: ${String(raw.rawCategory)}`,
      path: "rawCategory",
      raw,
    };
  }
  const status = mapStatus(raw.rawStatus) ?? "released";
  const direction = mapDirection(raw.rawDirection);
  const importance = rankImportance({
    category,
    rawImportance: raw.rawImportance,
    headline: raw.headline,
    status,
  });
  const affectedAssets = [...new Set(raw.affectedAssets ?? [])].filter(
    (a) => a.trim().length > 0,
  );
  const macroChannels = mapChannels(category, raw.macroChannels);
  const dedupeKey = buildDedupeKey({
    externalId: raw.externalId ?? raw.supersedesExternalId,
    sourceName: raw.sourceName,
    category,
    occurredAt,
    headline: raw.headline,
  });
  const id = buildCatalystId(dedupeKey);
  const statements =
    raw.evidenceStatements && raw.evidenceStatements.length > 0
      ? raw.evidenceStatements
      : [`Synthetic fixture: ${raw.headline.trim()}`];
  const evidence = statements.map((statement, i) => ({
    id: `${id}_ev${i + 1}`,
    statement,
    basis: "synthetic_fixture",
  }));

  const candidate = {
    schemaVersion: CATALYST_SCHEMA_VERSION,
    id,
    occurredAt,
    observedAt,
    sourceType: mapSourceType(raw.sourceType),
    sourceName: raw.sourceName.trim(),
    sourceUrl:
      raw.sourceUrl === undefined || raw.sourceUrl === null
        ? null
        : raw.sourceUrl,
    headline: raw.headline.trim(),
    summary: (raw.summary ?? raw.headline).trim(),
    category,
    importance,
    status,
    affectedAssets,
    macroChannels,
    direction,
    confidence: classificationConfidence({
      categoryKnown: true,
      direction,
      hasEvidence: evidence.length > 0,
      hasAssets: affectedAssets.length > 0,
    }),
    evidence,
    dedupeKey,
    synthetic: true as const,
  };

  const parsed = Catalyst.safeParse(candidate);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => i.message).join("; "),
      path: parsed.error.issues[0]?.path.join(".") || "catalyst",
      raw,
    };
  }
  return { ok: true, catalyst: parsed.data };
}

/** Prefer newer observation; on tie, prefer higher importance then id. */
export function preferCatalyst(
  a: CatalystType,
  b: CatalystType,
): CatalystType {
  if (a.observedAt !== b.observedAt) {
    return a.observedAt > b.observedAt ? a : b;
  }
  const imp = compareCatalystImportance(a.importance, b.importance);
  if (imp !== 0) return imp > 0 ? a : b;
  return a.id >= b.id ? a : b;
}
