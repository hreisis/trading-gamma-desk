import { describe, expect, it } from "vitest";
import { buildAiStudyEvidenceCorpus } from "@/ai-study/evidence-corpus";
import { validateAiStudyReport } from "@/ai-study/validate";
import type { AiStudyNarratorRawOutput } from "@/contracts/ai-study-briefing";

function claim(text: string, evidenceIds: string[]) {
  return { text, evidenceIds };
}

describe("validateAiStudyReport", () => {
  const evidence = buildAiStudyEvidenceCorpus(
    {
      sessionDate: "2026-08-04",
      macro: {
        sessionDate: "2026-08-04",
        label: "Rates-led easing",
        primaryRegime: "rates_led",
        riskDirection: "mixed",
        confidenceScore: 68,
        interpretation: "Macro interpretation from packet.",
        assets: [],
      },
      marketTemperature: null,
      catalysts: [],
      gammaStructure: null,
      marketQuotes: [],
      historicalStudy: null,
    },
    [],
  );

  it("allows confidence display tokens such as 68/100", () => {
    const report: AiStudyNarratorRawOutput = {
      marketRegime: claim("Macro confidence score 68/100 (uncalibrated).", [
        "macro.confidenceScore",
        "macro.confidenceDisplay",
      ]),
      mainDrivers: [claim("Rates-led easing from packet.", ["macro.label"])],
      keyLevelsStructure: [claim("Structure unavailable.", ["macro.label"])],
      upcomingRisks: [claim("Listed catalysts only.", ["macro.label"])],
      scenarios: {
        bull: claim("Conditional path if macro context persists.", ["macro.label"]),
        base: claim("Status-quo path using supplied facts only.", ["macro.label"]),
        bear: claim("Conditional path if macro risk direction intensifies.", [
          "macro.riskDirection",
        ]),
      },
    };

    const result = validateAiStudyReport({ report, evidence });
    expect(result.ok).toBe(true);
    expect(result.grounding.numbersValid).toBe(true);
  });

  it("ignores numeric fragments inside ISO session dates", () => {
    const report: AiStudyNarratorRawOutput = {
      marketRegime: claim("Macro session date 2026-08-04 from packet.", [
        "macro.sessionDate",
      ]),
      mainDrivers: [claim("Rates-led easing from packet.", ["macro.label"])],
      keyLevelsStructure: [claim("Structure unavailable.", ["macro.label"])],
      upcomingRisks: [claim("Listed catalysts only.", ["macro.label"])],
      scenarios: {
        bull: claim("Conditional path if macro context persists.", ["macro.label"]),
        base: claim("Status-quo path using supplied facts only.", ["macro.label"]),
        bear: claim("Conditional path if macro risk direction intensifies.", [
          "macro.riskDirection",
        ]),
      },
    };

    const result = validateAiStudyReport({ report, evidence });
    expect(result.ok).toBe(true);
  });

  it("allows explicitly conditional scenario language", () => {
    const report: AiStudyNarratorRawOutput = {
      marketRegime: claim("Rates-led easing from packet.", ["macro.label"]),
      mainDrivers: [claim("Macro driver from packet.", ["macro.label"])],
      keyLevelsStructure: [claim("Structure unavailable.", ["macro.label"])],
      upcomingRisks: [claim("Listed catalysts only.", ["macro.label"])],
      scenarios: {
        bull: claim("Conditional path if provided macro context will rally.", [
          "macro.label",
        ]),
        base: claim("Status-quo path using supplied facts only.", ["macro.label"]),
        bear: claim("Conditional downside if macro risk direction intensifies.", [
          "macro.riskDirection",
        ]),
      },
    };

    const result = validateAiStudyReport({ report, evidence });
    expect(result.ok).toBe(true);
    expect(result.grounding.prohibitedLanguageDetected).toBe(false);
  });

  it("accepts rounded percent tokens grounded in macro pct values", () => {
    const pctEvidence = buildAiStudyEvidenceCorpus(
      {
        sessionDate: "2026-08-05",
        macro: {
          sessionDate: "2026-08-05",
          label: "Liquidity-led risk-on",
          primaryRegime: "liquidity",
          riskDirection: "risk_on",
          confidenceScore: 41,
          interpretation: "USD proxy moved on the session.",
          assets: [
            {
              symbol: "USD",
              value: -0.24857954545454142,
              unit: "pct",
              zScore: -1.355112555496593,
              role: "confirming",
            },
          ],
        },
        marketTemperature: null,
        catalysts: [],
        gammaStructure: null,
        marketQuotes: [],
        historicalStudy: null,
      },
      [],
    );

    const report: AiStudyNarratorRawOutput = {
      marketRegime: claim("Liquidity-led risk-on from packet.", ["macro.label"]),
      mainDrivers: [
        claim("USD proxy fell about 0.25% on the session.", [
          "macro.asset.USD.value",
        ]),
      ],
      keyLevelsStructure: [claim("Structure unavailable.", ["macro.label"])],
      upcomingRisks: [claim("Listed catalysts only.", ["macro.label"])],
      scenarios: {
        bull: claim("Conditional path if macro context persists.", ["macro.label"]),
        base: claim("Status-quo path using supplied facts only.", ["macro.label"]),
        bear: claim("Conditional path if macro risk direction intensifies.", [
          "macro.riskDirection",
        ]),
      },
    };

    const result = validateAiStudyReport({ report, evidence: pctEvidence });
    expect(result.ok).toBe(true);
    expect(result.grounding.numbersValid).toBe(true);
  });

  it("still rejects unsupported invented numbers", () => {
    const report: AiStudyNarratorRawOutput = {
      marketRegime: claim("Invented level at 999.99 from nowhere.", ["macro.label"]),
      mainDrivers: [claim("Macro driver from packet.", ["macro.label"])],
      keyLevelsStructure: [claim("Structure unavailable.", ["macro.label"])],
      upcomingRisks: [claim("Listed catalysts only.", ["macro.label"])],
      scenarios: {
        bull: claim("Conditional path if macro context persists.", ["macro.label"]),
        base: claim("Status-quo path using supplied facts only.", ["macro.label"]),
        bear: claim("Conditional downside if macro risk direction intensifies.", [
          "macro.riskDirection",
        ]),
      },
    };

    const result = validateAiStudyReport({ report, evidence });
    expect(result.ok).toBe(false);
    expect(result.grounding.numbersValid).toBe(false);
  });
});
