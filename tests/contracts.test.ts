import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DominantDriver,
  MacroFeature,
  RegimeSignatureConfig,
} from "@/contracts";

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`../fixtures/macro/${name}`, import.meta.url), "utf8"),
  );
}

const driverFixture = fixture("dominant-driver.rates-led-easing.json");
const featureFixture = fixture("macro-feature.us2y.json");
const signatureFixture = fixture("regime-signature.sig-2026-07-01.json");

/** Structured clone keeps each mutation test independent of the others. */
function mutate<T>(source: unknown, apply: (draft: any) => void): T {
  const draft = structuredClone(source) as any;
  apply(draft);
  return draft as T;
}

function expectRejected(schema: { safeParse: (v: unknown) => { success: boolean } }, value: unknown, expected: RegExp) {
  const result = schema.safeParse(value) as {
    success: boolean;
    error?: { issues: { message: string }[] };
  };
  expect(result.success).toBe(false);
  const messages = (result.error?.issues ?? []).map((i) => i.message).join(" | ");
  expect(messages).toMatch(expected);
}

describe("fixtures satisfy the contracts", () => {
  it("accepts the rates-led easing driver", () => {
    expect(DominantDriver.safeParse(driverFixture).success).toBe(true);
  });

  it("accepts the US2Y macro feature", () => {
    expect(MacroFeature.safeParse(featureFixture).success).toBe(true);
  });

  it("accepts the signature config", () => {
    expect(RegimeSignatureConfig.safeParse(signatureFixture).success).toBe(true);
  });
});

describe("volatility window cannot include the current observation", () => {
  it("rejects a window ending at t instead of t-1", () => {
    expectRejected(
      MacroFeature,
      mutate(featureFixture, (f) => {
        f.window.endsAt = f.currentTo;
      }),
      /window must end at t-1/,
    );
  });

  it("rejects a window containing the current session", () => {
    expectRejected(
      MacroFeature,
      mutate(featureFixture, (f) => {
        f.window.sessionDates[19] = "2026-07-28";
        f.window.endsAt = "2026-07-28";
        f.currentFrom = "2026-07-28";
      }),
      /may not contain the current session/,
    );
  });

  it("rejects a z-score built on a short window", () => {
    expectRejected(
      MacroFeature,
      mutate(featureFixture, (f) => {
        f.window.validCount = 18;
        f.window.sessionDates = f.window.sessionDates.slice(2);
        f.flags = ["insufficientHistory"];
      }),
      /a z-score requires a full window of 20, got 18/,
    );
  });

  it("accepts a short window only alongside a null z-score", () => {
    const short = mutate(featureFixture, (f: any) => {
      f.window.validCount = 18;
      f.window.sessionDates = f.window.sessionDates.slice(2);
      f.zScore = null;
      f.sigmaRaw = null;
      f.sigmaUsed = null;
      f.flags = ["insufficientHistory", "volUnavailable"];
    });
    expect(MacroFeature.safeParse(short).success).toBe(true);
  });

  it("requires a short window to be flagged", () => {
    expectRejected(
      MacroFeature,
      mutate(featureFixture, (f) => {
        f.window.validCount = 18;
        f.window.sessionDates = f.window.sessionDates.slice(2);
        f.zScore = null;
        f.sigmaRaw = null;
        f.sigmaUsed = null;
        f.flags = ["volUnavailable"];
      }),
      /short window must be flagged insufficientHistory/,
    );
  });
});

describe("degenerate volatility is reported, not smoothed over", () => {
  it("requires a null z-score when sigmaRaw is zero", () => {
    expectRejected(
      MacroFeature,
      mutate(featureFixture, (f) => {
        f.sigmaRaw = 0;
        f.sigmaUsed = 0;
      }),
      /zScore must be null when sigmaRaw is 0/,
    );
  });

  it("treats a zero MAD as repeated prints, not a quiet market", () => {
    expectRejected(
      MacroFeature,
      mutate(featureFixture, (f) => {
        f.sigmaRaw = 0;
        f.sigmaUsed = 0;
        f.zScore = null;
        f.flags = ["volUnavailable"];
      }),
      /must include repeatedPrints/,
    );
  });

  it("rejects an unexplained null z-score", () => {
    expectRejected(
      MacroFeature,
      mutate(featureFixture, (f) => {
        f.zScore = null;
      }),
      /null zScore must be explained by a flag/,
    );
  });

  it("rejects an unflagged missing adjacent session", () => {
    expectRejected(
      MacroFeature,
      mutate(featureFixture, (f) => {
        f.consecutiveSessions = false;
      }),
      /must be flagged missingAdjacentSession/,
    );
  });

  it("rejects a change that spans non-adjacent sessions", () => {
    expectRejected(
      MacroFeature,
      mutate(featureFixture, (f) => {
        f.consecutiveSessions = false;
        f.zScore = null;
        f.flags = ["missingAdjacentSession", "volUnavailable"];
      }),
      /may not span non-adjacent sessions/,
    );
  });
});

describe("units and proxies are registry-owned", () => {
  it("rejects a yield reported in percent", () => {
    expectRejected(
      MacroFeature,
      mutate(featureFixture, (f) => {
        f.unit = "pct";
      }),
      /must be reported in bps/,
    );
  });

  it("rejects passing a proxy off as the underlying", () => {
    expectRejected(
      DominantDriver,
      mutate(driverFixture, (d) => {
        const gold = d.evidence.find((e: any) => e.symbol === "GOLD");
        gold.isProxy = false;
      }),
      /isProxy must be true/,
    );
  });
});

describe("every claim resolves to evidence", () => {
  it("rejects a contradiction that references nothing", () => {
    expectRejected(
      DominantDriver,
      mutate(driverFixture, (d) => {
        d.contradictions = ["ev_does_not_exist"];
      }),
      /does not reference any evidence entry/,
    );
  });

  it("rejects interpretation citing unknown evidence", () => {
    expectRejected(
      DominantDriver,
      mutate(driverFixture, (d) => {
        d.interpretation.evidenceIds = ["ev_invented"];
      }),
      /does not reference any evidence entry/,
    );
  });

  it("rejects a contradiction whose asset is not contradicting", () => {
    expectRejected(
      DominantDriver,
      mutate(driverFixture, (d) => {
        d.contradictions = ["ev_us2y"];
      }),
      /listed as a contradiction but its role is confirming/,
    );
  });
});

describe("confidence aggregation is auditable", () => {
  it("requires component weights to sum to 1", () => {
    expectRejected(
      DominantDriver,
      mutate(driverFixture, (d) => {
        d.confidence.components[0].weight = 0.5;
      }),
      /weights must sum to 1/,
    );
  });

  it("requires every component to be present", () => {
    expectRejected(
      DominantDriver,
      mutate(driverFixture, (d) => {
        d.confidence.components = d.confidence.components.slice(0, 4);
      }),
      /missing components: strength|weights must sum to 1/,
    );
  });

  it("forces an explicit zero when a component fails", () => {
    expectRejected(
      DominantDriver,
      mutate(driverFixture, (d) => {
        d.confidence.components[1].value = 0;
        d.confidence.zeroedBy = "distinctiveness";
      }),
      /score must be exactly 0/,
    );
  });

  it("requires zeroedBy to name the failing component", () => {
    expectRejected(
      DominantDriver,
      mutate(driverFixture, (d) => {
        d.confidence.components[1].value = 0;
        d.confidence.score = 0;
        d.confidence.zeroedBy = "strength";
      }),
      /zeroedBy must name the failing component/,
    );
  });

  it("accepts a legitimate explicit zero", () => {
    const zeroed = mutate(driverFixture, (d: any) => {
      d.confidence.components[1].value = 0;
      d.confidence.score = 0;
      d.confidence.zeroedBy = "distinctiveness";
    });
    expect(DominantDriver.safeParse(zeroed).success).toBe(true);
  });

  it("rejects a score above an applied hard cap", () => {
    expectRejected(
      DominantDriver,
      mutate(driverFixture, (d) => {
        d.confidence.hardCapsApplied = [
          {
            rule: "insufficient_effective_confirmations",
            cappedAt: 40,
            basis: "effectiveConfirmations = 1.0",
          },
        ];
      }),
      /exceeds applied cap 40/,
    );
  });
});

describe("fallback regimes cannot smuggle in a claim", () => {
  it("rejects polarity on a fallback", () => {
    expectRejected(
      DominantDriver,
      mutate(driverFixture, (d) => {
        d.primaryRegime = "mixed_unresolved";
        d.label = "Unresolved";
      }),
      /is a fallback and carries no polarity/,
    );
  });

  it("rejects a risk direction under insufficient_data", () => {
    expectRejected(
      DominantDriver,
      mutate(driverFixture, (d) => {
        d.primaryRegime = "insufficient_data";
        d.polarity = null;
        d.label = "Insufficient data";
      }),
      /may not assert a risk direction/,
    );
  });

  it("requires a zero score under insufficient_data", () => {
    expectRejected(
      DominantDriver,
      mutate(driverFixture, (d) => {
        d.primaryRegime = "insufficient_data";
        d.polarity = null;
        d.riskDirection = null;
        d.label = "Insufficient data";
      }),
      /must report a score of 0/,
    );
  });

  it("rejects a driver-shaped label for risk_sentiment", () => {
    expectRejected(
      DominantDriver,
      mutate(driverFixture, (d) => {
        d.primaryRegime = "risk_sentiment";
        d.label = "Risk-sentiment-led risk-on";
      }),
      /must be "Risk-on \(broad\)"/,
    );
  });

  it("accepts the prescribed risk_sentiment label", () => {
    const broad = mutate(driverFixture, (d: any) => {
      d.primaryRegime = "risk_sentiment";
      d.label = "Risk-on (broad)";
    });
    expect(DominantDriver.safeParse(broad).success).toBe(true);
  });
});

describe("signature config keeps the scoring model honest", () => {
  it("requires lambda weights to sum to 1", () => {
    expectRejected(
      RegimeSignatureConfig,
      mutate(signatureFixture, (c) => {
        c.confidenceParams.lambda.strength = 0.4;
      }),
      /lambda weights must sum to 1/,
    );
  });

  it("rejects a signature that overspends a correlation block", () => {
    expectRejected(
      RegimeSignatureConfig,
      mutate(signatureFixture, (c) => {
        c.signatures.fed_rates.US10Y = 0.9;
      }),
      /block rates spends .* against a budget of 1/,
    );
  });

  it("rejects blocks that do not partition the registry", () => {
    expectRejected(
      RegimeSignatureConfig,
      mutate(signatureFixture, (c) => {
        c.evidenceBlocks.rates = ["US2Y"];
      }),
      /US10Y must appear in exactly one block/,
    );
  });

  it("rejects a block assignment that disagrees with the registry", () => {
    expectRejected(
      RegimeSignatureConfig,
      mutate(signatureFixture, (c) => {
        c.evidenceBlocks.rates = ["US2Y", "US10Y", "GOLD"];
        c.evidenceBlocks.haven = [];
      }),
      /GOLD belongs to block haven/,
    );
  });
});
