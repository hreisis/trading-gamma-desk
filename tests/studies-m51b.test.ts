import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  BOUNDED_GAMMA_SCOPE,
  DailyResearchArchive,
  StudySourcesManifest,
  buildResearchArchiveId,
} from "@/contracts";
import {
  buildDailyResearchArchive,
  dailyResearchArchivePath,
  loadStudySourcesFromFile,
  loadStudySources,
  readDailyResearchArchive,
  verifyArchiveReplay,
  writeDailyResearchArchive,
  ResearchArchiveStoreError,
  assessStudyEligibility,
  CONSERVATIVE_ELIGIBILITY_RULES,
} from "@/studies";

const MANIFEST = "fixtures/studies/sources.m51b.json";

function buildFromManifest() {
  const loaded = loadStudySourcesFromFile(MANIFEST);
  return buildDailyResearchArchive({
    sessionDate: loaded.manifest.sessionDate,
    runId: loaded.manifest.runId,
    builtAt: loaded.manifest.builtAt,
    evaluationInstants: loaded.manifest.evaluationInstants,
    corpus: loaded.corpus,
    components: loaded.components,
  });
}

describe("M5-1B DailyResearchArchive build", () => {
  it("builds contract-valid archive from synthetic manifest", () => {
    const archive = buildFromManifest();
    expect(DailyResearchArchive.safeParse(archive).success).toBe(true);
    expect(archive.archiveId).toBe(buildResearchArchiveId("2026-07-29"));
    expect(archive.sessionDate).toBe("2026-07-29");
    expect(archive.evaluationInstants).toHaveLength(3);
    expect(archive.replayRun.frames).toHaveLength(3);
    expect(archive.components.macro.status).toBe("available");
    expect(archive.components.marketStructure.status).toBe("available");
    if (archive.components.marketStructure.status === "available") {
      expect(archive.components.marketStructure.sessionDate).toBe("2026-07-29");
      expect(archive.components.marketStructure.snapshotId).toBe(
        "SPX|2026-07-29|intraday|2026-07-29T15:00:00.000Z",
      );
    }
  });

  it("preserves bounded scope, DTE, and gamma availability", () => {
    const archive = buildFromManifest();
    const bounded = archive.components.boundedStructure;
    expect(bounded.status).toBe("available");
    if (bounded.status === "available") {
      expect(bounded.scope).toBe(BOUNDED_GAMMA_SCOPE);
      expect(bounded.dte).toBe(1);
      expect(bounded.expiration).toBe("2026-07-31");
      expect(bounded.gammaAvailability).toBe("incomplete");
      expect(bounded.limitations.join(" ")).toMatch(/BOUNDED/i);
    }
  });

  it("marks partial eligibility when bounded gamma is incomplete", () => {
    const archive = buildFromManifest();
    expect(archive.eligibility.status).toBe("partial");
    expect(archive.eligibility.satisfiedKinds).toContain("macro");
    expect(archive.eligibility.satisfiedKinds).toContain("market_structure");
    expect(archive.eligibility.conservativeRulesApplied).toEqual(
      CONSERVATIVE_ELIGIBILITY_RULES,
    );
  });

  it("is deterministic for identical manifest inputs", () => {
    const a = buildFromManifest();
    const b = buildFromManifest();
    expect(a).toEqual(b);
  });

  it("rejects wrong marketStructure snapshotId — no latest fallback", () => {
    const manifest = StudySourcesManifest.parse(
      JSON.parse(readFileSync(MANIFEST, "utf8")),
    );
    const bad = {
      ...manifest,
      marketStructureSnapshotId: "SPX|2026-07-29|open|2026-07-29T13:30:00.000Z",
    };
    const loaded = loadStudySourcesFromFile(MANIFEST);
    const archive = buildDailyResearchArchive({
      sessionDate: bad.sessionDate,
      runId: bad.runId,
      builtAt: bad.builtAt,
      evaluationInstants: bad.evaluationInstants,
      corpus: loaded.corpus,
      components: {
        ...loaded.components,
        marketStructure: {
          status: "unavailable",
          kind: "market_structure",
          reason: "marketStructure snapshotId SPX|2026-07-29|open|2026-07-29T13:30:00.000Z not found in corpus — no latest-fallback",
        },
      },
    });
    expect(archive.eligibility.status).toBe("ineligible");
    expect(archive.eligibility.missingKinds).toContain("market_structure");
  });

  it("rejects evaluation instants outside sessionDate", () => {
    const loaded = loadStudySourcesFromFile(MANIFEST);
    expect(() =>
      buildDailyResearchArchive({
        sessionDate: loaded.manifest.sessionDate,
        runId: loaded.manifest.runId,
        builtAt: loaded.manifest.builtAt,
        evaluationInstants: ["2026-07-30T12:00:00.000Z"],
        corpus: loaded.corpus,
        components: loaded.components,
      }),
    ).toThrow(/must fall on sessionDate/);
  });
});

describe("M5-1B archive store + offline replay", () => {
  it("writes atomically and refuses conflicting overwrite", () => {
    const archive = buildFromManifest();
    const dir = mkdtempSync(join(tmpdir(), "gammadesk-studies-"));
    const path = dailyResearchArchivePath(dir, archive.sessionDate);

    writeDailyResearchArchive(path, archive);
    const roundTrip = readDailyResearchArchive(path);
    expect(roundTrip.archiveId).toBe(archive.archiveId);

    writeDailyResearchArchive(path, archive);
    expect(() =>
      writeDailyResearchArchive(path, {
        ...archive,
        builtAt: "2026-07-30T13:00:00.000Z",
      }),
    ).toThrow(ResearchArchiveStoreError);
    expect(() =>
      writeDailyResearchArchive(path, {
        ...archive,
        builtAt: "2026-07-30T13:00:00.000Z",
      }),
    ).toThrow(/already exists with different payload/);

    rmSync(dir, { recursive: true, force: true });
  });

  it("verifyArchiveReplay confirms deterministic rebuild", () => {
    const archive = buildFromManifest();
    const run = verifyArchiveReplay(archive);
    expect(run.runId).toBe("research-2026-07-29");
    expect(run.frames).toHaveLength(3);
    expect(run.frames[0]!.marketStructure.status).toBe("unavailable");
    expect(run.frames[1]!.marketStructure.status).toBe("available");
  });
});

describe("M5-1B conservative eligibility", () => {
  it("eligible when required components satisfied and bounded available", () => {
    const loaded = loadStudySourcesFromFile(MANIFEST);
    const eligibility = assessStudyEligibility({
      sessionDate: "2026-07-29",
      components: {
        macro: loaded.components.macro,
        marketStructure: loaded.components.marketStructure,
        boundedStructure: {
          status: "available",
          kind: "bounded_structure",
          provenance: {
            sourceKind: "fixture",
            relativePath: "fixtures/gamma/providers/marketdata-app/spy-minimal.ok.json",
            artifactId: "bounded|SPY|2026-07-31|2026-07-30",
            schemaVersion: "0.1.0",
            availableAt: "2026-07-30T20:00:00.000Z",
            synthetic: true,
          },
          limitations: [],
          scope: BOUNDED_GAMMA_SCOPE,
          expiration: "2026-07-31",
          dte: 1,
          gammaAvailability: "available",
          symbol: "SPY",
          sessionDate: "2026-07-30",
        },
        catalystEvidence: loaded.components.catalystEvidence,
      },
    });
    expect(eligibility.status).toBe("eligible");
  });

  it("ineligible when macro unavailable", () => {
    const loaded = loadStudySourcesFromFile(MANIFEST);
    const eligibility = assessStudyEligibility({
      sessionDate: "2026-07-29",
      components: {
        macro: {
          status: "unavailable",
          kind: "macro",
          reason: "missing",
        },
        marketStructure: loaded.components.marketStructure,
        boundedStructure: loaded.components.boundedStructure,
        catalystEvidence: [],
      },
    });
    expect(eligibility.status).toBe("ineligible");
    expect(eligibility.missingKinds).toContain("macro");
  });
});

describe("M5-1B loadStudySources exact-id resolution", () => {
  it("resolves catalyst components by explicit artifactId", () => {
    const loaded = loadStudySourcesFromFile(MANIFEST);
    expect(loaded.components.catalystEvidence).toHaveLength(2);
    expect(
      loaded.components.catalystEvidence.every((c) => c.status === "available"),
    ).toBe(true);
  });

  it("matches golden DailyResearchArchive fixture", () => {
    const golden = DailyResearchArchive.parse(
      JSON.parse(
        readFileSync(
          "fixtures/studies/archive/2026-07-29/daily-research.json",
          "utf8",
        ),
      ),
    );
    const built = buildFromManifest();
    expect(built).toEqual(golden);
    verifyArchiveReplay(golden);
  });

  it("throws when manifest evaluation instant is off-session", () => {
    const manifest = StudySourcesManifest.parse(
      JSON.parse(readFileSync(MANIFEST, "utf8")),
    );
    expect(() =>
      loadStudySources({
        manifest: {
          ...manifest,
          evaluationInstants: ["2026-07-30T12:00:00.000Z"],
        },
      }),
    ).toThrow(/must fall on sessionDate/);
  });
});
