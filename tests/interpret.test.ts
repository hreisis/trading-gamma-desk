import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ALL_SYMBOLS,
  DominantDriver,
  RegimeSignatureConfig,
  type MacroSymbol,
} from "@/contracts";
import { assembleSnapshot, type SymbolSeries } from "@/ingest";
import { defaultSessionCalendar } from "@/macro";
import {
  assertInterpretationSafe,
  interpretSnapshot,
  renderTemplateInterpretation,
  buildEvidence,
  InterpretationGuardrailError,
} from "@/interpret";

const config = RegimeSignatureConfig.parse(
  JSON.parse(
    readFileSync(
      "fixtures/macro/regime-signature.sig-2026-07-01.json",
      "utf8",
    ),
  ),
);

const summary = JSON.parse(
  readFileSync(
    "fixtures/macro/history/snapshot-2026-07-29.summary.json",
    "utf8",
  ),
) as { confidenceScore: number; calibrated: boolean; polarity: string };

function syntheticSeries(
  symbol: MacroSymbol,
  end: string,
  startLevel: number,
  path: "easing" | "inflation",
): SymbolSeries {
  const sessions: string[] = [end];
  let cursor = end;
  while (sessions.length < 24) {
    const previous = defaultSessionCalendar.previousSession(cursor);
    if (previous === null) break;
    sessions.unshift(previous);
    cursor = previous;
  }

  let level = startLevel;
  const bars = sessions.map((sessionDate, i) => {
    if (symbol === "US2Y" || symbol === "US10Y") {
      // Easing: yields drift down into the final session; inflation: drift up.
      const drift = path === "easing" ? -0.01 * (i % 3) : 0.015 * (i % 3);
      level = startLevel + drift;
    } else if (path === "inflation") {
      const bump =
        symbol === "OIL" || symbol === "COPPER" || symbol === "GOLD"
          ? 0.8
          : symbol === "USD"
            ? -0.4
            : 0.2;
      level = startLevel * (1 + (i === sessions.length - 1 ? bump : (i % 2 === 0 ? 0.2 : -0.15)) / 100);
    } else {
      const lastBump =
        symbol === "USD" || symbol === "BTC" ? -0.8 : 0.3;
      level =
        startLevel *
        (1 +
          (i === sessions.length - 1
            ? lastBump
            : i % 2 === 0
              ? 0.25
              : -0.2) /
            100);
    }
    return {
      sessionDate,
      value: level,
      source: "fixture",
      rawDate: sessionDate,
    };
  });

  return {
    symbol,
    instrument: symbol,
    isProxy: false,
    source: "fixture",
    bars,
  };
}

function snapshotFor(path: "easing" | "inflation") {
  const end = "2026-07-28";
  const series = ALL_SYMBOLS.map((symbol, i) =>
    syntheticSeries(
      symbol,
      end,
      symbol.includes("Y") ? 4.1 : 100 + i,
      path,
    ),
  );
  return assembleSnapshot(series, config, {
    marketSessionDate: end,
    generatedAt: "2026-07-29T08:15:00-04:00",
  });
}

describe("interpretSnapshot consumes the snapshot only", () => {
  it("emits a contract-valid DominantDriver without changing confidence", () => {
    const snapshot = snapshotFor("easing");
    const before = snapshot.classification.confidence.score;
    const driver = interpretSnapshot(snapshot);

    expect(DominantDriver.safeParse(driver).success).toBe(true);
    expect(driver.confidence.score).toBe(before);
    expect(driver.confidence).toEqual(snapshot.classification.confidence);
    expect(driver.interpretation.generator).toBe("template");
    expect(driver.primaryRegime).toBe(snapshot.classification.primaryRegime);
    expect(driver.polarity).toBe(snapshot.classification.polarity);
  });

  it("does not re-score when the same snapshot is interpreted twice", () => {
    const snapshot = snapshotFor("easing");
    const a = interpretSnapshot(snapshot);
    const b = interpretSnapshot(snapshot);
    expect(a.confidence).toEqual(b.confidence);
    expect(a.interpretation.text).toBe(b.interpretation.text);
    expect(a.evidence).toEqual(b.evidence);
  });
});

describe("polarity is not an equity recommendation", () => {
  it("keeps inflation/positive free of bullish equity language", () => {
    const snapshot = snapshotFor("inflation");
    // Force the classified shape the live freeze reported, without re-scoring
    // the confidence payload — interpretation must accept the snapshot as-is.
    const forced = {
      ...snapshot,
      classification: {
        ...snapshot.classification,
        primaryRegime: "inflation" as const,
        polarity: "positive" as const,
        riskDirection: "risk_off" as const,
        label: "Inflation-led risk-off",
      },
    };

    const driver = interpretSnapshot(forced);
    expect(driver.polarity).toBe("positive");
    expect(driver.interpretation.text.toLowerCase()).toMatch(/inflation/);
    expect(driver.interpretation.text).toContain("not a call on equities");
    expect(driver.interpretation.text.toLowerCase()).not.toMatch(
      /\b(bullish|bearish|buy|sell)\b/,
    );
    expect(driver.interpretation.text.toLowerCase()).not.toMatch(
      /stocks?\s+(should|will|rally|rise)/,
    );
  });
});

describe("uncalibrated confidence stays numeric", () => {
  it("mentions the score without high/medium/low labels", () => {
    const snapshot = snapshotFor("easing");
    const driver = interpretSnapshot(snapshot);
    expect(snapshot.classification.confidence.calibrated).toBe(false);
    expect(driver.interpretation.text).toMatch(
      /Signal confidence score: \d+\/100 \(uncalibrated\)/,
    );
    expect(driver.interpretation.text.toLowerCase()).not.toMatch(
      /(high|medium|low)\s+confidence/,
    );
    // Same posture as the frozen live summary.
    expect(summary.calibrated).toBe(false);
    expect(summary.confidenceScore).toBe(68);
  });
});

describe("guardrails", () => {
  it("rejects an invented numeral", () => {
    const snapshot = snapshotFor("easing");
    const evidence = buildEvidence(snapshot);
    expect(() =>
      assertInterpretationSafe(
        {
          text: "Yields fell 99 bps in a mystery print.",
          evidenceIds: [evidence[0]!.id],
          generator: "template",
        },
        evidence,
        { confidenceScore: snapshot.classification.confidence.score, calibrated: false },
      ),
    ).toThrow(InterpretationGuardrailError);
  });

  it("rejects band labels while uncalibrated", () => {
    const snapshot = snapshotFor("easing");
    const evidence = buildEvidence(snapshot);
    expect(() =>
      assertInterpretationSafe(
        {
          text: "This is high confidence in the rates read.",
          evidenceIds: [evidence[0]!.id],
          generator: "template",
        },
        evidence,
        { confidenceScore: 68, calibrated: false },
      ),
    ).toThrow(/band_label|high\/medium\/low/);
  });

  it("rejects equity-claim prose even if numbers are clean", () => {
    const snapshot = snapshotFor("inflation");
    const evidence = buildEvidence(snapshot);
    expect(() =>
      assertInterpretationSafe(
        {
          text: "Positive polarity is bullish for stocks.",
          evidenceIds: [evidence[0]!.id],
          generator: "template",
        },
        evidence,
        { confidenceScore: 68, calibrated: false },
      ),
    ).toThrow(/equity/);
  });
});

describe("template renderer is deterministic", () => {
  it("returns identical prose for identical evidence", () => {
    const snapshot = snapshotFor("easing");
    const evidence = buildEvidence(snapshot);
    const a = renderTemplateInterpretation(snapshot, evidence);
    const b = renderTemplateInterpretation(snapshot, evidence);
    expect(a).toEqual(b);
  });
});
