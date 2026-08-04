/**
 * M8 local acceptance (2026-07-29) — documents non-demo /decide loading data/ pipeline
 * artifacts. Does NOT validate real historical Study research (fixture archive,
 * peer corpus, SPY prices remain in pipeline.m64.json). See docs/tasks.md M8-5.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DecisionSurface } from "@/app/components/DecisionSurface";
import { StudyEvidenceBundle, StudyForwardOutcome, StudyMemo } from "@/contracts";
import {
  buildDecisionEvidenceSummary,
  formatStudyReturnPercent,
  loadDecisionSurface,
} from "@/desk";

const SESSION = "2026-07-29";
const SYMBOL = "SPY";
const DATA_ROOT = "data";

function readArtifact<T>(path: string, parser: (raw: unknown) => T): T {
  return parser(JSON.parse(readFileSync(path, "utf8")));
}

describe("M8 pipeline wiring acceptance (2026-07-29, not real historical Study)", () => {
  const bundlePath = join(
    DATA_ROOT,
    "studies/evidence",
    SESSION,
    SYMBOL,
    "evidence-bundle.json",
  );
  const memoPath = join(DATA_ROOT, "studies/memos", SESSION, "study-memo.json");
  const similarPath = join(
    DATA_ROOT,
    "studies/similar-regime",
    SESSION,
    SYMBOL,
    "similar-regime-study.json",
  );
  const runPath = join(DATA_ROOT, "studies/pipeline", SESSION, "run.json");
  const driverPath = join(DATA_ROOT, "drivers", `${SESSION}.json`);
  const peerOutcomePath = join(
    DATA_ROOT,
    "studies/outcomes/study__research__2026-07-22__0.1.0__SPY__0.1.0/2026-08-29/forward-outcome.json",
  );

  it("loads non-demo /decide from data/ artifacts (not bundled fixtures)", () => {
    const view = loadDecisionSurface({
      sessionDate: SESSION,
      publicDemo: false,
      dataRoot: DATA_ROOT,
    });

    expect(view.isPublicDemo).toBe(false);
    expect(view.isSynthetic).toBe(false);
    expect(view.sourceLabel).toMatch(/Local study artifacts/);
    expect(view.research).toBeDefined();
    expect(view.status).toBe("partial");
    expect(view.studyIntegrityOk).toBe(true);
  });

  it("aligns UI evidence summary with generated StudyEvidenceBundle", () => {
    const bundle = readArtifact(bundlePath, (raw) =>
      StudyEvidenceBundle.parse(raw),
    );
    const view = loadDecisionSurface({
      sessionDate: SESSION,
      publicDemo: false,
      dataRoot: DATA_ROOT,
    });
    const expected = buildDecisionEvidenceSummary(bundle);
    const summary = view.research!.evidenceSummary;

    expect(summary.evidenceStatus).toBe(bundle.evidenceStatus);
    expect(summary.cohortMatchedCount).toBe(bundle.cohortQuality.matchedStudyCount);
    expect(summary.cohortMatureCount).toBe(
      bundle.cohortQuality.primaryHorizonMatureCount,
    );
    expect(summary.horizons.d5.meanReturn).toBe(expected.horizons.d5.meanReturn);
    expect(summary.horizons.d5.meanMfe).toBe(expected.horizons.d5.meanMfe);
  });

  it("aligns memo and matched session drill-down with pipeline outputs", () => {
    const bundle = readArtifact(bundlePath, (raw) =>
      StudyEvidenceBundle.parse(raw),
    );
    const memo = readArtifact(memoPath, (raw) => StudyMemo.parse(raw));
    const peerOutcome = readArtifact(peerOutcomePath, (raw) =>
      StudyForwardOutcome.parse(raw),
    );
    const view = loadDecisionSurface({
      sessionDate: SESSION,
      publicDemo: false,
      dataRoot: DATA_ROOT,
    });

    expect(memo.bundleId).toBe(bundle.bundleId);
    expect(view.research!.memoHeadline).toBe(memo.headline);
    expect(view.research!.evidenceDrillDown.matchedSessions).toHaveLength(1);

    const session = view.research!.evidenceDrillDown.matchedSessions[0]!;
    expect(session.sessionDate).toBe("2026-07-22");
    expect(session.studyId).toBe("study|research|2026-07-22|0.1.0|SPY|0.1.0");
    expect(session.horizons.find((h) => h.horizon === "5D")?.return).toBe(
      formatStudyReturnPercent(peerOutcome.returns.d5.status === "available"
        ? peerOutcome.returns.d5.value
        : null),
    );
  });

  it("uses real DominantDriver from data/drivers for Observe", () => {
    const driver = JSON.parse(readFileSync(driverPath, "utf8")) as {
      label: string;
      marketSessionDate: string;
    };
    const view = loadDecisionSurface({
      sessionDate: SESSION,
      publicDemo: false,
      dataRoot: DATA_ROOT,
    });

    expect(driver.marketSessionDate).toBe(SESSION);
    expect(view.observe?.driverLabel).toBe(driver.label);
    expect(view.observe?.driverLabel).toBe("Inflation-led risk-off");
  });

  it("renders pipeline-backed values without leaking filesystem paths", () => {
    const view = loadDecisionSurface({
      sessionDate: SESSION,
      publicDemo: false,
      dataRoot: DATA_ROOT,
    });
    const html = renderToStaticMarkup(createElement(DecisionSurface, { view }));

    expect(html).toContain("Supported");
    expect(html).toContain('data-testid="matched-session-2026-07-22"');
    expect(html).not.toMatch(/fixtures\/studies/);
    expect(html).not.toMatch(/data\/studies/);
    expect(html).not.toContain("Synthetic Demo Data");
  });

  it("documents pipeline input provenance (honest blockers)", () => {
    const run = JSON.parse(readFileSync(runPath, "utf8")) as {
      manifestPath: string;
      artifactPaths: { archive: string };
    };
    const peerOutcome = readArtifact(peerOutcomePath, (raw) =>
      StudyForwardOutcome.parse(raw),
    );

    expect(run.manifestPath).toBe("fixtures/studies/pipeline.m64.json");
    expect(run.artifactPaths.archive).toMatch(/fixtures\/studies\/archive/);
    expect(peerOutcome.provenance.priceSourceKind).toBe("fixture");
    expect(peerOutcome.provenance.synthetic).toBe(true);
  });

  it("non-demo missing artifacts never falls back to bundled fixtures", () => {
    const view = loadDecisionSurface({
      sessionDate: "2026-08-01",
      publicDemo: false,
      dataRoot: DATA_ROOT,
    });
    expect(view.status).toBe("artifacts_missing");
    expect(view.research).toBeUndefined();
    expect(view.isSynthetic).toBe(false);
  });
});
