import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DominantDriver,
  MarketStructureState,
  ReplayCorpus,
  ReplayRun,
  type ReplayCorpus as ReplayCorpusDto,
  type ReplayMacroArtifact,
} from "@/contracts";
import {
  ReplayCorpusError,
  buildReplayRun,
  catalystArtifactFromCatalyst,
  macroArtifactFromDominantDriver,
  structureArtifactFromMarketStructureState,
  validateReplayCorpus,
} from "@/replay";
import { compareIsoInstants } from "@/gamma/instant";

const FIXTURE_ROOT = join(process.cwd(), "fixtures");

function loadCorpus(): ReplayCorpusDto {
  return ReplayCorpus.parse(
    JSON.parse(
      readFileSync(join(FIXTURE_ROOT, "replay", "corpus.m51a.json"), "utf8"),
    ),
  );
}

const EVALUATION_ATS = [
  "2026-07-29T12:30:00.000Z",
  "2026-07-29T14:00:00.000Z",
  "2026-07-29T16:00:00.000Z",
  "2026-07-30T20:00:00.000Z",
] as const;

describe("M5-1A point-in-time replay foundation", () => {
  it("builds ordered frames with no lookahead", () => {
    const corpus = loadCorpus();
    const run = buildReplayRun({
      corpus,
      evaluationAts: EVALUATION_ATS,
      runId: "m51a-fixture",
    });

    expect(run.frames).toHaveLength(4);
    for (let i = 1; i < run.frames.length; i++) {
      expect(
        compareIsoInstants(
          run.frames[i - 1]!.evaluationAt,
          run.frames[i]!.evaluationAt,
        ),
      ).toBeLessThan(0);
    }

    const preOpen = run.frames[0]!;
    expect(preOpen.evaluationAt).toBe("2026-07-29T12:30:00.000Z");
    expect(preOpen.macro.status).toBe("available");
    if (preOpen.macro.status === "available") {
      expect(preOpen.macro.artifactId).toBe(
        "macro|2026-07-28|2026-07-29T08:15:00-04:00",
      );
      expect(
        compareIsoInstants(preOpen.macro.availableAt, preOpen.evaluationAt),
      ).toBeLessThanOrEqual(0);
    }
    expect(preOpen.marketStructure.status).toBe("unavailable");
    expect(preOpen.catalystEvidence.status).toBe("available");
    if (preOpen.catalystEvidence.status === "available") {
      expect(preOpen.catalystEvidence.catalystId).toBe("syn-cpi-2026-07-15");
    }

    const afterOpen = run.frames[1]!;
    expect(afterOpen.marketStructure.status).toBe("available");
    if (afterOpen.marketStructure.status === "available") {
      expect(afterOpen.marketStructure.snapshotId).toBe(
        "SPX|2026-07-29|open|2026-07-29T13:30:00.000Z",
      );
    }

    const afterIntraday = run.frames[2]!;
    if (afterIntraday.marketStructure.status === "available") {
      expect(afterIntraday.marketStructure.snapshotId).toBe(
        "SPX|2026-07-29|intraday|2026-07-29T15:00:00.000Z",
      );
    }
    expect(afterIntraday.catalystEvidence.status).toBe("available");
    if (afterIntraday.catalystEvidence.status === "available") {
      expect(afterIntraday.catalystEvidence.catalystId).toBe(
        "syn-cpi-2026-07-15",
      );
    }

    const afterFomc = run.frames[3]!;
    if (afterFomc.macro.status === "available") {
      expect(afterFomc.macro.artifactId).toBe(
        "macro|2026-07-29|2026-07-30T08:15:00-04:00",
      );
    }
    if (afterFomc.catalystEvidence.status === "available") {
      expect(afterFomc.catalystEvidence.catalystId).toBe(
        "syn-fomc-2026-07-30",
      );
    }
  });

  it("excludes future catalyst evidence before publication", () => {
    const corpus = loadCorpus();
    const run = buildReplayRun({
      corpus,
      evaluationAts: ["2026-07-30T13:59:00-04:00"],
      runId: "m51a-catalyst-gate",
    });
    const frame = run.frames[0]!;
    expect(frame.catalystEvidence.status).toBe("available");
    if (frame.catalystEvidence.status === "available") {
      expect(frame.catalystEvidence.catalystId).toBe("syn-cpi-2026-07-15");
    }

    const beforeAny = buildReplayRun({
      corpus,
      evaluationAts: ["2026-07-01T00:00:00.000Z"],
      runId: "m51a-pre-catalyst",
    });
    expect(beforeAny.frames[0]!.catalystEvidence).toMatchObject({
      status: "unavailable",
      reason: expect.stringMatching(/only after evaluationAt|no catalyst/i),
    });
  });

  it("compares timezone offsets by parsed instant for eligibility", () => {
    const corpus = loadCorpus();
    // 2026-07-29T08:15:00-04:00 == 2026-07-29T12:15:00.000Z
    const atExact = buildReplayRun({
      corpus,
      evaluationAts: ["2026-07-29T12:15:00.000Z"],
      runId: "m51a-tz",
    });
    expect(atExact.frames[0]!.macro.status).toBe("available");

    const justBefore = buildReplayRun({
      corpus,
      evaluationAts: ["2026-07-29T12:14:59.000Z"],
      runId: "m51a-tz-before",
    });
    expect(justBefore.frames[0]!.macro.status).toBe("unavailable");
  });

  it("returns explicit unavailable for missing and incompatible sources", () => {
    const corpus = loadCorpus();
    const emptyish: ReplayCorpusDto = {
      ...corpus,
      macro: [],
      marketStructure: corpus.marketStructure.map((s) => ({
        ...s,
        underlying: "QQQ",
      })),
    };
    const run = buildReplayRun({
      corpus: emptyish,
      evaluationAts: ["2026-07-30T20:00:00.000Z"],
      runId: "m51a-missing",
    });
    expect(run.frames[0]!.macro).toMatchObject({
      status: "unavailable",
      reason: expect.stringMatching(/no compatible macro/i),
    });
    expect(run.frames[0]!.marketStructure).toMatchObject({
      status: "unavailable",
      reason: expect.stringMatching(/no compatible market structure/i),
    });
  });

  it("rejects duplicate identities with conflicting payloads", () => {
    const corpus = loadCorpus();
    const conflicting: ReplayMacroArtifact = {
      ...corpus.macro[0]!,
      status: "growth",
    };
    expect(() =>
      validateReplayCorpus({
        ...corpus,
        macro: [...corpus.macro, conflicting],
      }),
    ).toThrow(ReplayCorpusError);

    expect(() =>
      validateReplayCorpus({
        ...corpus,
        macro: [...corpus.macro, { ...corpus.macro[0]! }],
      }),
    ).not.toThrow();
  });

  it("is deterministic and does not mutate inputs", () => {
    const corpus = loadCorpus();
    const corpusCopy = structuredClone(corpus);
    const ats = [...EVALUATION_ATS];
    const atsCopy = [...ats];
    const a = buildReplayRun({
      corpus,
      evaluationAts: ats,
      runId: "m51a-det",
    });
    const b = buildReplayRun({
      corpus,
      evaluationAts: ats,
      runId: "m51a-det",
    });
    expect(a).toEqual(b);
    expect(corpus).toEqual(corpusCopy);
    expect(ats).toEqual(atsCopy);
  });

  it("orders evaluationAts chronologically regardless of input order", () => {
    const corpus = loadCorpus();
    const run = buildReplayRun({
      corpus,
      evaluationAts: [
        "2026-07-30T20:00:00.000Z",
        "2026-07-29T12:30:00.000Z",
        "2026-07-29T16:00:00.000Z",
      ],
      runId: "m51a-order",
    });
    expect(run.frames.map((f) => f.evaluationAt)).toEqual([
      "2026-07-29T12:30:00.000Z",
      "2026-07-29T16:00:00.000Z",
      "2026-07-30T20:00:00.000Z",
    ]);
  });

  it("adapts stored DominantDriver and MarketStructureState without revision", () => {
    const driver = DominantDriver.parse(
      JSON.parse(
        readFileSync(
          join(FIXTURE_ROOT, "macro", "dominant-driver.rates-led-easing.json"),
          "utf8",
        ),
      ),
    );
    const structure = MarketStructureState.parse(
      JSON.parse(
        readFileSync(
          join(
            FIXTURE_ROOT,
            "gamma",
            "structure",
            "spx.2026-07-29.intraday.market-structure-state.json",
          ),
          "utf8",
        ),
      ),
    );
    const macro = macroArtifactFromDominantDriver(driver, { synthetic: true });
    const struct = structureArtifactFromMarketStructureState(structure);
    expect(macro.availableAt).toBe(driver.generatedAt);
    expect(macro.schemaVersion).toBe(driver.schemaVersion);
    expect(struct.availableAt).toBe(structure.asOf);
    expect(struct.snapshotId).toBe(structure.snapshotId);
    expect(struct.limitations).toEqual(structure.current.limitations);
  });

  it("matches the checked-in ReplayRun fixture", () => {
    const corpus = loadCorpus();
    const run = buildReplayRun({
      corpus,
      evaluationAts: EVALUATION_ATS,
      runId: "m51a-fixture",
    });
    expect(ReplayRun.safeParse(run).success).toBe(true);

    const outPath = join(FIXTURE_ROOT, "replay", "run.m51a.json");
    const reloaded = ReplayRun.parse(JSON.parse(readFileSync(outPath, "utf8")));
    expect(reloaded).toEqual(run);
  });
});

describe("M5-1A catalyst adapter publication time", () => {
  it("uses releaseResult.observedAt when present", () => {
    const artifact = catalystArtifactFromCatalyst({
      schemaVersion: "0.1.0",
      id: "c1",
      occurredAt: "2026-07-15T08:30:00-04:00",
      observedAt: "2026-07-15T08:31:00-04:00",
      sourceType: "calendar",
      sourceName: "test",
      sourceUrl: null,
      headline: "h",
      summary: "s",
      category: "inflation",
      importance: "high",
      status: "released",
      affectedAssets: ["US10Y"],
      macroChannels: ["inflation"],
      direction: "unclear",
      confidence: {
        score: 50,
        calibrated: false,
        note: "classification clarity only — not a market direction probability",
      },
      evidence: [{ id: "e1", statement: "st", basis: "b" }],
      dedupeKey: "d1",
      synthetic: true,
      releaseResult: {
        referencePeriod: "2026-06",
        observedAt: "2026-07-15T12:30:00.000Z",
        sourceName: "BLS",
        sourceUrl: "https://example.invalid/cpi",
        observations: [
          {
            metric: "cpi",
            actual: 0.1,
            unit: "pct",
            sourceSeriesId: "CUUR0000SA0",
            sourcePeriod: "2026-M06",
            transformation: "mom-change",
          },
        ],
        consensus: null,
        surprise: null,
        surpriseStatus: "unavailable",
      },
    });
    expect(artifact.publishedAt).toBe("2026-07-15T12:30:00.000Z");
  });
});
