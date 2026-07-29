import { z } from "zod";
import {
  ALL_SYMBOLS,
  blockOf,
  CorrelationBlock,
  MacroSymbol,
  Regime,
  SemVer,
  sumsToOne,
} from "./common";

export const ConfidenceComponentName = z.enum([
  "patternMatch",
  "distinctiveness",
  "coherence",
  "effectiveBreadth",
  "strength",
]);
export type ConfidenceComponentName = z.infer<typeof ConfidenceComponentName>;

export const CONFIDENCE_COMPONENT_NAMES = ConfidenceComponentName.options;

const SignatureWeights = z.partialRecord(
  MacroSymbol,
  z.number().min(-1).max(1),
);

export const ConfidenceParams = z.object({
  /** Reference gap for distinctiveness, scaled by template similarity. */
  marginRef: z.number().positive(),
  ambiguityFloor: z.number().min(0).max(1),
  concentrationThreshold: z.number().min(0).max(1),
  lambda: z.record(ConfidenceComponentName, z.number().min(0).max(1)),
  /**
   * Gates band labels. While false the UI shows the numeric score only,
   * because the thresholds have never been checked against outcomes.
   */
  calibrated: z.boolean(),
});

const RegimeSignatureConfigBase = z.object({
  signatureVersion: z.string().min(1),
  methodologyVersion: SemVer,
  polarityConvention: z.string().min(1),
  correlationBlocks: z.record(CorrelationBlock, z.array(MacroSymbol).nonempty()),
  blockWeightBudget: z.record(CorrelationBlock, z.number().positive()),
  signatures: z.record(Regime, SignatureWeights),
  riskVector: SignatureWeights,
  confidenceParams: ConfidenceParams,
  sigmaFloors: z.partialRecord(MacroSymbol, z.number().positive()),
});

export const RegimeSignatureConfig = RegimeSignatureConfigBase.superRefine(
  (config, ctx) => {
    const lambdaValues = CONFIDENCE_COMPONENT_NAMES.map(
      (name) => config.confidenceParams.lambda[name],
    );

    if (lambdaValues.some((v) => v === undefined)) {
      ctx.addIssue({
        code: "custom",
        path: ["confidenceParams", "lambda"],
        message: `lambda must define every component: ${CONFIDENCE_COMPONENT_NAMES.join(", ")}`,
      });
    } else if (!sumsToOne(lambdaValues as number[])) {
      ctx.addIssue({
        code: "custom",
        path: ["confidenceParams", "lambda"],
        message: `lambda weights must sum to 1, got ${lambdaValues.reduce((a, b) => a! + b!, 0)}`,
      });
    }

    // Blocks must partition the registry, otherwise effectiveBreadth has an
    // ill-defined denominator.
    const assigned = new Map<MacroSymbol, CorrelationBlock[]>();
    for (const [block, symbols] of Object.entries(config.correlationBlocks)) {
      for (const symbol of symbols ?? []) {
        const blocks = assigned.get(symbol) ?? [];
        blocks.push(block as CorrelationBlock);
        assigned.set(symbol, blocks);

        if (blockOf(symbol) !== block) {
          ctx.addIssue({
            code: "custom",
            path: ["correlationBlocks", block],
            message: `${symbol} belongs to block ${blockOf(symbol)} in the asset registry`,
          });
        }
      }
    }

    for (const symbol of ALL_SYMBOLS) {
      const blocks = assigned.get(symbol) ?? [];
      if (blocks.length !== 1) {
        ctx.addIssue({
          code: "custom",
          path: ["correlationBlocks"],
          message: `${symbol} must appear in exactly one block, found ${blocks.length}`,
        });
      }
    }

    for (const block of Object.keys(config.correlationBlocks)) {
      if (config.blockWeightBudget[block as CorrelationBlock] === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["blockWeightBudget"],
          message: `missing weight budget for block ${block}`,
        });
      }
    }

    // Budgeting weight per correlated block rather than per asset is what keeps
    // plain cosine from rewarding a signature for spreading weight across
    // inputs that carry the same information.
    for (const [regime, weights] of Object.entries(config.signatures)) {
      const spentByBlock = new Map<CorrelationBlock, number>();
      for (const [symbol, weight] of Object.entries(weights ?? {})) {
        const block = blockOf(symbol as MacroSymbol);
        spentByBlock.set(
          block,
          (spentByBlock.get(block) ?? 0) + Math.abs(weight as number),
        );
      }
      for (const [block, spent] of spentByBlock) {
        const budget = config.blockWeightBudget[block];
        if (budget !== undefined && spent > budget + 1e-9) {
          ctx.addIssue({
            code: "custom",
            path: ["signatures", regime],
            message: `block ${block} spends ${spent.toFixed(3)} against a budget of ${budget}`,
          });
        }
      }
    }
  },
);

export type RegimeSignatureConfig = z.infer<typeof RegimeSignatureConfig>;
export type ConfidenceParams = z.infer<typeof ConfidenceParams>;
