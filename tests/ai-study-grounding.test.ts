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
