import { z } from "zod";
import {
  ASSET_REGISTRY,
  FeatureFlag,
  IsoDate,
  MacroSymbol,
  Unit,
} from "./common";

export const VolatilityWindow = z.object({
  /** Requested window length. */
  length: z.number().int().positive(),
  /** Latest session the window may reach, i.e. t-1. Never t. */
  endsAt: IsoDate,
  /** End date of each historical change actually used, ascending. */
  sessionDates: z.array(IsoDate),
  /** Historical changes actually available; may fall short of `length`. */
  validCount: z.number().int().min(0),
});

const MacroFeatureBase = z.object({
  symbol: MacroSymbol,
  instrument: z.string().min(1),
  isProxy: z.boolean(),
  unit: Unit,
  currentChange: z.number().nullable(),
  /** The change spans currentFrom -> currentTo, i.e. t-1 -> t. */
  currentFrom: IsoDate,
  currentTo: IsoDate,
  consecutiveSessions: z.boolean(),
  window: VolatilityWindow,
  sigmaRaw: z.number().min(0).nullable(),
  sigmaUsed: z.number().min(0).nullable(),
  sigmaFloorApplied: z.boolean(),
  zScore: z.number().nullable(),
  flags: z.array(FeatureFlag),
});

export const MacroFeature = MacroFeatureBase.superRefine((f, ctx) => {
  const definition = ASSET_REGISTRY[f.symbol];

  if (f.unit !== definition.unit) {
    ctx.addIssue({
      code: "custom",
      path: ["unit"],
      message: `${f.symbol} must be reported in ${definition.unit}, got ${f.unit}`,
    });
  }

  if (f.isProxy !== definition.isProxy) {
    ctx.addIssue({
      code: "custom",
      path: ["isProxy"],
      message: `${f.symbol} isProxy must be ${definition.isProxy} per the asset registry`,
    });
  }

  // The current observation must not participate in estimating its own scale.
  if (f.window.endsAt !== f.currentFrom) {
    ctx.addIssue({
      code: "custom",
      path: ["window", "endsAt"],
      message: `window must end at t-1 (${f.currentFrom}), got ${f.window.endsAt}`,
    });
  }

  if (f.currentTo <= f.currentFrom) {
    ctx.addIssue({
      code: "custom",
      path: ["currentTo"],
      message: "currentTo must be after currentFrom",
    });
  }

  if (f.window.sessionDates.length !== f.window.validCount) {
    ctx.addIssue({
      code: "custom",
      path: ["window", "sessionDates"],
      message: `expected ${f.window.validCount} session dates, got ${f.window.sessionDates.length}`,
    });
  }

  if (f.window.validCount > f.window.length) {
    ctx.addIssue({
      code: "custom",
      path: ["window", "validCount"],
      message: "validCount may not exceed the requested window length",
    });
  }

  // A short window is representable, but it can never produce a z-score.
  if (f.zScore !== null && f.window.validCount !== f.window.length) {
    ctx.addIssue({
      code: "custom",
      path: ["window", "validCount"],
      message: `a z-score requires a full window of ${f.window.length}, got ${f.window.validCount}`,
    });
  }

  if (f.window.validCount < f.window.length && !f.flags.includes("insufficientHistory")) {
    ctx.addIssue({
      code: "custom",
      path: ["flags"],
      message: "a short window must be flagged insufficientHistory",
    });
  }

  const strictlyIncreasing = f.window.sessionDates.every(
    (d, i) => i === 0 || d > f.window.sessionDates[i - 1]!,
  );
  if (!strictlyIncreasing) {
    ctx.addIssue({
      code: "custom",
      path: ["window", "sessionDates"],
      message: "session dates must be strictly increasing",
    });
  }

  const last = f.window.sessionDates.at(-1);
  if (last !== undefined) {
    if (last > f.window.endsAt) {
      ctx.addIssue({
        code: "custom",
        path: ["window", "sessionDates"],
        message: `last session date ${last} may not exceed window.endsAt ${f.window.endsAt}`,
      });
    }
    // Rule: the last historical change ends exactly at t-1 whenever a z-score
    // is claimed. A shorter reach is only acceptable alongside a null z-score.
    if (f.zScore !== null && last !== f.window.endsAt) {
      ctx.addIssue({
        code: "custom",
        path: ["window", "sessionDates"],
        message: `a z-score requires the window to reach ${f.window.endsAt}, got ${last}`,
      });
    }
  }

  if (f.window.sessionDates.some((d) => d >= f.currentTo)) {
    ctx.addIssue({
      code: "custom",
      path: ["window", "sessionDates"],
      message: "window may not contain the current session",
    });
  }

  if (f.sigmaRaw !== null && f.sigmaUsed !== null) {
    if (f.sigmaUsed < f.sigmaRaw) {
      ctx.addIssue({
        code: "custom",
        path: ["sigmaUsed"],
        message: "sigmaUsed may only raise sigmaRaw, never lower it",
      });
    }
    const floored = f.sigmaUsed > f.sigmaRaw;
    if (floored !== f.sigmaFloorApplied) {
      ctx.addIssue({
        code: "custom",
        path: ["sigmaFloorApplied"],
        message: `sigmaFloorApplied must be ${floored} given sigmaRaw ${f.sigmaRaw} and sigmaUsed ${f.sigmaUsed}`,
      });
    }
    if (floored && !f.flags.includes("sigmaFloorApplied")) {
      ctx.addIssue({
        code: "custom",
        path: ["flags"],
        message: "flags must include sigmaFloorApplied when the floor binds",
      });
    }
  }

  // A zero MAD means over half the window is identical, which in practice
  // means repeated or filled prints rather than a merely quiet market.
  if (f.sigmaRaw === 0) {
    if (f.zScore !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["zScore"],
        message: "zScore must be null when sigmaRaw is 0",
      });
    }
    for (const required of ["volUnavailable", "repeatedPrints"] as const) {
      if (!f.flags.includes(required)) {
        ctx.addIssue({
          code: "custom",
          path: ["flags"],
          message: `flags must include ${required} when sigmaRaw is 0`,
        });
      }
    }
  }

  if (f.zScore === null) {
    const explained = (
      [
        "volUnavailable",
        "insufficientHistory",
        "missingAdjacentSession",
        "invalidPrice",
        "missing",
        "stale",
      ] as const
    ).some((flag) => f.flags.includes(flag));
    if (!explained) {
      ctx.addIssue({
        code: "custom",
        path: ["flags"],
        message: "a null zScore must be explained by a flag",
      });
    }
  }

  // Never bridge a gap: without an adjacent prior session there is no
  // single-session change to report, so the value must be absent rather than
  // silently spanning two sessions.
  if (!f.consecutiveSessions) {
    if (!f.flags.includes("missingAdjacentSession")) {
      ctx.addIssue({
        code: "custom",
        path: ["flags"],
        message: "non-adjacent sessions must be flagged missingAdjacentSession",
      });
    }
    if (f.currentChange !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["currentChange"],
        message: "a change may not span non-adjacent sessions",
      });
    }
  }
});

export type MacroFeature = z.infer<typeof MacroFeature>;

export const MacroFeatureSet = z.array(MacroFeature).superRefine((features, ctx) => {
  const seen = new Set<string>();
  for (const [i, f] of features.entries()) {
    if (seen.has(f.symbol)) {
      ctx.addIssue({
        code: "custom",
        path: [i, "symbol"],
        message: `duplicate feature for ${f.symbol}`,
      });
    }
    seen.add(f.symbol);
  }
});
