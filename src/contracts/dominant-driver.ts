import { z } from "zod";
import {
  ASSET_REGISTRY,
  AssetRole,
  CONTRACT_SCHEMA_VERSION,
  IsoDate,
  InterpretationGenerator,
  MacroSymbol,
  Polarity,
  PrimaryRegime,
  Regime,
  RegimeFallback,
  RiskDirection,
  SemVer,
  Timing,
  Unit,
  sumsToOne,
} from "./common";
import {
  CONFIDENCE_COMPONENT_NAMES,
  ConfidenceComponentName,
} from "./regime-signature";

export const Evidence = z.object({
  id: z.string().min(1),
  symbol: MacroSymbol,
  instrument: z.string().min(1),
  isProxy: z.boolean(),
  /** Prose is generated from the numbers below, never the other way round. */
  statement: z.string().min(1),
  value: z.number(),
  unit: Unit,
  zScore: z.number().nullable(),
  sourceDate: IsoDate,
});
export type Evidence = z.infer<typeof Evidence>;

export const AssetObservation = z.object({
  symbol: MacroSymbol,
  instrument: z.string().min(1),
  isProxy: z.boolean(),
  value: z.number().nullable(),
  unit: Unit,
  zScore: z.number().nullable(),
  role: AssetRole,
  /** Signed share of this asset in the winning signature's dot product. */
  contribution: z.number(),
  sourceDate: IsoDate.nullable(),
  staleDays: z.number().int().min(0).nullable(),
});
export type AssetObservation = z.infer<typeof AssetObservation>;

export const ConfidenceComponent = z.object({
  name: ConfidenceComponentName,
  value: z.number().min(0).max(1),
  weight: z.number().min(0).max(1),
});

export const HardCapRule = z.enum([
  "insufficient_effective_confirmations",
  "single_asset_shock",
  "mixed_unresolved",
  "insufficient_data",
]);

export const HardCapApplied = z.object({
  rule: HardCapRule,
  cappedAt: z.number().int().min(0).max(100),
  /** The measured quantity that triggered the cap, for audit. */
  basis: z.string().min(1),
});

export const ConfidenceDetail = z.object({
  runnerUpRegime: Regime.nullable(),
  scoreTop: z.number().min(-1).max(1),
  scoreSecond: z.number().min(-1).max(1).nullable(),
  templateSimilarity: z.number().min(0).max(1).nullable(),
  effectiveConfirmations: z.number().min(0),
  blocksWithNonZeroWeight: z.number().int().min(0),
});

const ConfidenceBase = z.object({
  score: z.number().int().min(0).max(100),
  aggregation: z.literal("weighted_geometric_mean"),
  components: z.array(ConfidenceComponent),
  coveragePenalty: z.number().min(0).max(1),
  /**
   * Names the component that forced an explicit zero. A geometric mean would
   * already collapse to zero, but recording which gate failed keeps the result
   * auditable instead of merely small.
   */
  zeroedBy: ConfidenceComponentName.nullable(),
  hardCapsApplied: z.array(HardCapApplied),
  calibrated: z.boolean(),
  detail: ConfidenceDetail,
});

export const Confidence = ConfidenceBase.superRefine((c, ctx) => {
  const names = c.components.map((component) => component.name);
  const missing = CONFIDENCE_COMPONENT_NAMES.filter((n) => !names.includes(n));
  if (missing.length > 0) {
    ctx.addIssue({
      code: "custom",
      path: ["components"],
      message: `missing components: ${missing.join(", ")}`,
    });
  }
  if (new Set(names).size !== names.length) {
    ctx.addIssue({
      code: "custom",
      path: ["components"],
      message: "component names must be unique",
    });
  }

  if (!sumsToOne(c.components.map((component) => component.weight))) {
    ctx.addIssue({
      code: "custom",
      path: ["components"],
      message: "component weights must sum to 1",
    });
  }

  const zeroed = c.components.find((component) => component.value <= 0);
  if (zeroed !== undefined) {
    if (c.zeroedBy !== zeroed.name) {
      ctx.addIssue({
        code: "custom",
        path: ["zeroedBy"],
        message: `zeroedBy must name the failing component (${zeroed.name})`,
      });
    }
    if (c.score !== 0) {
      ctx.addIssue({
        code: "custom",
        path: ["score"],
        message: "score must be exactly 0 when any component is not greater than 0",
      });
    }
  } else if (c.zeroedBy !== null) {
    ctx.addIssue({
      code: "custom",
      path: ["zeroedBy"],
      message: "zeroedBy must be null when every component is greater than 0",
    });
  }

  for (const cap of c.hardCapsApplied) {
    if (c.score > cap.cappedAt) {
      ctx.addIssue({
        code: "custom",
        path: ["score"],
        message: `score ${c.score} exceeds applied cap ${cap.cappedAt} from ${cap.rule}`,
      });
    }
  }
});
export type Confidence = z.infer<typeof Confidence>;

export const Interpretation = z.object({
  text: z.string().min(1),
  evidenceIds: z.array(z.string().min(1)).nonempty(),
  generator: InterpretationGenerator,
});

export const Methodology = z.object({
  methodologyVersion: SemVer,
  signatureVersion: z.string().min(1),
  window: z.number().int().positive(),
  excludesCurrentObservation: z.literal(true),
  muAssumption: z.literal("zero"),
  sigmaEstimator: z.literal("mad_about_zero_x1.4826"),
  cosineRenormalizedOnObservedDims: z.boolean(),
});

const DominantDriverBase = Timing.extend({
  schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION),
  primaryRegime: PrimaryRegime,
  polarity: Polarity.nullable(),
  riskDirection: RiskDirection.nullable(),
  label: z.string().min(1),
  confidence: Confidence,
  evidence: z.array(Evidence),
  /** References into `evidence[].id`; never free text. */
  contradictions: z.array(z.string().min(1)),
  assets: z.array(AssetObservation),
  interpretation: Interpretation,
  methodology: Methodology,
});

const FALLBACK_REGIMES = RegimeFallback.options as readonly string[];

export const DominantDriver = DominantDriverBase.superRefine((d, ctx) => {
  const ids = d.evidence.map((e) => e.id);
  const idSet = new Set(ids);

  if (idSet.size !== ids.length) {
    ctx.addIssue({
      code: "custom",
      path: ["evidence"],
      message: "evidence ids must be unique",
    });
  }

  for (const [i, id] of d.contradictions.entries()) {
    if (!idSet.has(id)) {
      ctx.addIssue({
        code: "custom",
        path: ["contradictions", i],
        message: `${id} does not reference any evidence entry`,
      });
    }
  }

  for (const [i, id] of d.interpretation.evidenceIds.entries()) {
    if (!idSet.has(id)) {
      ctx.addIssue({
        code: "custom",
        path: ["interpretation", "evidenceIds", i],
        message: `${id} does not reference any evidence entry`,
      });
    }
  }

  const roleBySymbol = new Map(d.assets.map((a) => [a.symbol, a.role]));

  const seenAssets = new Set<MacroSymbol>();
  for (const [i, asset] of d.assets.entries()) {
    if (seenAssets.has(asset.symbol)) {
      ctx.addIssue({
        code: "custom",
        path: ["assets", i, "symbol"],
        message: `duplicate observation for ${asset.symbol}`,
      });
    }
    seenAssets.add(asset.symbol);
  }

  // Units and proxy status are registry-owned, so a payload cannot quietly
  // relabel an ETF as the underlying or report a yield in percent.
  for (const [i, item] of d.evidence.entries()) {
    const definition = ASSET_REGISTRY[item.symbol];
    if (item.unit !== definition.unit) {
      ctx.addIssue({
        code: "custom",
        path: ["evidence", i, "unit"],
        message: `${item.symbol} must be reported in ${definition.unit}`,
      });
    }
    if (item.isProxy !== definition.isProxy) {
      ctx.addIssue({
        code: "custom",
        path: ["evidence", i, "isProxy"],
        message: `${item.symbol} isProxy must be ${definition.isProxy}`,
      });
    }
    if (item.instrument !== definition.instrument) {
      ctx.addIssue({
        code: "custom",
        path: ["evidence", i, "instrument"],
        message: `${item.symbol} instrument must be ${definition.instrument}`,
      });
    }
  }

  for (const [i, asset] of d.assets.entries()) {
    const definition = ASSET_REGISTRY[asset.symbol];
    if (asset.unit !== definition.unit) {
      ctx.addIssue({
        code: "custom",
        path: ["assets", i, "unit"],
        message: `${asset.symbol} must be reported in ${definition.unit}`,
      });
    }
    if (asset.isProxy !== definition.isProxy) {
      ctx.addIssue({
        code: "custom",
        path: ["assets", i, "isProxy"],
        message: `${asset.symbol} isProxy must be ${definition.isProxy}`,
      });
    }
    if (asset.role === "missing" && asset.value !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["assets", i, "value"],
        message: "a missing asset cannot carry a value",
      });
    }
  }

  // Something listed as a contradiction must actually be contradicting.
  for (const [i, id] of d.contradictions.entries()) {
    const item = d.evidence.find((e) => e.id === id);
    if (item === undefined) continue;
    const role = roleBySymbol.get(item.symbol);
    if (role !== undefined && role !== "contradicting") {
      ctx.addIssue({
        code: "custom",
        path: ["contradictions", i],
        message: `${item.symbol} is listed as a contradiction but its role is ${role}`,
      });
    }
  }

  const isFallback = FALLBACK_REGIMES.includes(d.primaryRegime);

  if (isFallback && d.polarity !== null) {
    ctx.addIssue({
      code: "custom",
      path: ["polarity"],
      message: `${d.primaryRegime} is a fallback and carries no polarity`,
    });
  }

  if (d.primaryRegime === "insufficient_data") {
    if (d.riskDirection !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["riskDirection"],
        message: "insufficient_data may not assert a risk direction",
      });
    }
    if (d.confidence.score !== 0) {
      ctx.addIssue({
        code: "custom",
        path: ["confidence", "score"],
        message: "insufficient_data must report a score of 0",
      });
    }
  }

  // Composing "{driver}-led {risk direction}" produces nonsense when the
  // winner is itself the risk axis.
  if (d.primaryRegime === "risk_sentiment") {
    if (!/^Risk-(on|off) \(broad\)$/.test(d.label)) {
      ctx.addIssue({
        code: "custom",
        path: ["label"],
        message: 'risk_sentiment label must be "Risk-on (broad)" or "Risk-off (broad)"',
      });
    }
  }
});

export type DominantDriver = z.infer<typeof DominantDriver>;
