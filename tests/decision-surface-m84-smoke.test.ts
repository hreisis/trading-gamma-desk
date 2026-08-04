import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { DecisionSurface } from "@/app/components/DecisionSurface";
import { StudyEvidenceBundle } from "@/contracts";
import { DecisionSurfaceView } from "@/contracts/decision-surface";
import {
  buildDecisionEvidenceDrillDown,
  buildDecisionEvidenceSummary,
  DECISION_SURFACE_FIXTURE_SESSION,
  DECISION_SURFACE_MEMO,
  horizonCoverageSummary,
  loadDecisionSurface,
  memoProvenanceLabel,
  PUBLIC_DEMO_DRIVER,
} from "@/desk";
import {
  buildRuleBasedMemoOutput,
  RULE_BASED_MEMO_MODEL,
  RULE_BASED_MEMO_PROVIDER,
  validateStudyMemoOutput,
} from "@/study-agent";
import { runStudyPipeline, studyEvidenceBundlePath } from "@/studies";
import { studyMemoPath } from "@/study-agent/memo-store";
import adequateBundle from "../fixtures/studies/eval/evidence-bundle.eval-supported-adequate.json";
import insufficientBundle from "../fixtures/studies/eval/evidence-bundle.eval-insufficient.json";
import mixedBundle from "../fixtures/studies/eval/evidence-bundle.eval-mixed.json";
import n1Bundle from "../fixtures/studies/eval/evidence-bundle.eval-supported-thin-n1.json";
import notSupportedBundle from "../fixtures/studies/eval/evidence-bundle.eval-not-supported.json";
import partialHorizonBundle from "../fixtures/studies/eval/evidence-bundle.eval-partial-horizon-mfe.json";
import spyBoundedFixture from "../fixtures/gamma/providers/marketdata-app/spy-bounded-ui.json";

const SESSION = DECISION_SURFACE_FIXTURE_SESSION;
const SYMBOL = "SPY";
const MANIFEST = "fixtures/studies/pipeline.m64.json";

function researchFromBundle(
  bundle: StudyEvidenceBundle,
  memoStatus?: "complete" | "abstained" | "unavailable",
) {
  const memo =
    memoStatus === "unavailable"
      ? null
      : validateStudyMemoOutput({
          bundle,
          output: buildRuleBasedMemoOutput(bundle),
          provider: RULE_BASED_MEMO_PROVIDER,
          model: RULE_BASED_MEMO_MODEL,
          generatedAt: bundle.computedAt,
          synthetic: true,
        });
  const resolvedMemo =
    memo && memoStatus && memoStatus !== "complete"
      ? { ...memo, status: memoStatus, headline: `Memo ${memoStatus}` }
      : memo;
  const prov = resolvedMemo
    ? memoProvenanceLabel({
        memoStatus: resolvedMemo.status,
        provider: resolvedMemo.provider,
        model: resolvedMemo.model,
      })
    : {
        statusLabel: "unavailable",
        sourceLabel: "Rule-based fallback",
        combinedLabel: "unavailable · Rule-based fallback · —/—",
      };

  return {
    evidenceSummary: buildDecisionEvidenceSummary(bundle),
    evidenceDrillDown: buildDecisionEvidenceDrillDown({
      bundle,
      memo: resolvedMemo,
    }),
    memoHeadline: resolvedMemo?.headline ?? "Study memo unavailable",
    memoStatus: resolvedMemo?.status ?? "unavailable",
    memoStatusLabel: prov.statusLabel,
    memoSourceLabel: prov.sourceLabel,
    memoProvenanceLabel: prov.combinedLabel,
    memoProvider: resolvedMemo?.provider ?? "—",
    memoModel: resolvedMemo?.model ?? "—",
    bundleId: bundle.bundleId,
    evidence: resolvedMemo?.evidence ?? [],
    inference: resolvedMemo?.inference ?? [],
    limitations: resolvedMemo?.limitations ?? [],
    unknowns: resolvedMemo?.unknowns ?? [],
  };
}

function smokeView(
  bundle: StudyEvidenceBundle,
  overrides: Partial<DecisionSurfaceView> = {},
): DecisionSurfaceView {
  return DecisionSurfaceView.parse({
    kind: "DecisionSurfaceView",
    schemaVersion: "0.3.0",
    status: "ready",
    sessionDate: bundle.queryContext.sessionDate,
    isPublicDemo: true,
    isSynthetic: true,
    sourceLabel: "M8-4 smoke fixture",
    artifactIssues: [],
    studyIntegrityOk: true,
    research: researchFromBundle(bundle),
    ...overrides,
  });
}

function renderView(view: DecisionSurfaceView): string {
  return renderToStaticMarkup(createElement(DecisionSurface, { view }));
}

function writeDriver(dataRoot: string, sessionDate = SESSION) {
  mkdirSync(join(dataRoot, "drivers"), { recursive: true });
  writeFileSync(join(dataRoot, "drivers", `${sessionDate}.json`), JSON.stringify(PUBLIC_DEMO_DRIVER));
}

function writeBoundedGamma(dataRoot: string, sessionDate = SESSION) {
  const dir = join(dataRoot, "gamma", "providers", "marketdata-app");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "SPY-bounded-latest.json"),
    JSON.stringify({
      ...spyBoundedFixture,
      sessionDate,
      zeroDte: {
        ...(spyBoundedFixture as { zeroDte: Record<string, unknown> }).zeroDte,
        sessionDate,
      },
    }),
  );
}

async function seedStudyArtifacts(dataRoot: string) {
  writeDriver(dataRoot);
  writeBoundedGamma(dataRoot);
  await runStudyPipeline({
    sessionDate: SESSION,
    manifestPath: MANIFEST,
    dataRoot,
    dryRun: false,
  });
}

describe("M8-4 decision surface UI polish", () => {
  it("renders research ribbon badges for scannable status", () => {
    const html = renderView(smokeView(StudyEvidenceBundle.parse(adequateBundle)));
    expect(html).toContain('data-testid="decision-research-ribbon"');
    expect(html).toContain('data-testid="ribbon-evidence-status"');
    expect(html).toContain('data-testid="ribbon-cohort-n"');
    expect(html).toContain('data-testid="ribbon-horizon-coverage"');
    expect(html).toContain('data-testid="ribbon-memo-source"');
  });

  it("renders primary navigation with Decide link", () => {
    const html = renderView(smokeView(StudyEvidenceBundle.parse(adequateBundle)));
    expect(html).toContain('aria-label="Primary"');
    expect(html).toContain('href="/decide?date=');
    expect(html).toContain("Decide");
  });

  it("includes semantic labels on expandable drill-down sections", () => {
    const html = renderView(smokeView(StudyEvidenceBundle.parse(adequateBundle)));
    expect(html).toContain('aria-label="Expand study evidence drill-down"');
    expect(html).toContain('aria-label="Memo citation paths"');
  });

  it("shows demo session link on missing date", () => {
    const view = loadDecisionSurface({ sessionDate: undefined, publicDemo: true });
    const html = renderToStaticMarkup(createElement(DecisionSurface, { view }));
    expect(html).toContain('data-testid="decision-page-status"');
    expect(html).toContain(`/decide?date=${SESSION}`);
  });
});

describe("M8-4 evidence state smoke coverage", () => {
  const cases = [
    {
      name: "adequate supported",
      bundle: adequateBundle,
      expectStatus: "Supported",
      expectStrength: "limited",
    },
    {
      name: "mixed",
      bundle: mixedBundle,
      expectStatus: "Mixed",
      expectStrength: "limited",
    },
    {
      name: "not supported",
      bundle: notSupportedBundle,
      expectStatus: "Not supported",
      expectStrength: "limited",
    },
    {
      name: "n=1 preliminary",
      bundle: n1Bundle,
      expectStatus: "Supported",
      expectStrength: "preliminary",
    },
    {
      name: "insufficient",
      bundle: insufficientBundle,
      expectStatus: "Insufficient evidence",
      expectStrength: "insufficient",
    },
    {
      name: "partial horizons",
      bundle: partialHorizonBundle,
      expectStatus: "Supported",
      expectStrength: "limited",
    },
  ] as const;

  it.each(cases)(
    "renders $name state with expected badges",
    ({ bundle, expectStatus, expectStrength }) => {
      const parsed = StudyEvidenceBundle.parse(bundle);
      const view = smokeView(parsed);
      const html = renderView(view);
      expect(view.research?.evidenceSummary.evidenceStatusLabel).toBe(expectStatus);
      expect(view.research?.evidenceSummary.strengthDisplay).toBe(expectStrength);
      expect(html).toContain(expectStatus);
      expect(html).toContain(`data-testid="ribbon-strength"`);
      expect(html).toContain("decision-lane-deterministic");
      expect(html).toContain("decision-lane-inference");
    },
  );

  it("renders abstained memo badge", () => {
    const parsed = StudyEvidenceBundle.parse(insufficientBundle);
    const view = smokeView(parsed, {
      research: researchFromBundle(parsed, "abstained"),
    });
    const html = renderView(view);
    expect(html).toContain('data-testid="memo-source-badge"');
    expect(html).toContain("Abstained");
  });

  it("labels partial horizon coverage in ribbon", () => {
    const parsed = StudyEvidenceBundle.parse(partialHorizonBundle);
    const coverage = horizonCoverageSummary(
      buildDecisionEvidenceSummary(parsed).horizons,
    );
    expect(coverage.label).toMatch(/Horizons 2\/3/);
  });
});

describe("M8-4 integrity and artifact smoke", () => {
  it("shows integrity ribbon and suppresses stance on integrity failure", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "decide-m84-integrity-"));
    await seedStudyArtifacts(dataRoot);
    writeFileSync(studyMemoPath(dataRoot, SESSION), "{ invalid");
    const view = loadDecisionSurface({ sessionDate: SESSION, dataRoot });
    const html = renderToStaticMarkup(createElement(DecisionSurface, { view }));
    expect(view.studyIntegrityOk).toBe(false);
    expect(view.stance).toBeUndefined();
    expect(html).toContain('data-testid="decision-integrity-ribbon"');
    expect(html).toContain('data-testid="stance-suppressed-note"');
    expect(html).not.toMatch(/data\/studies\//);
  });

  it("shows artifacts missing state without path leakage", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "decide-m84-missing-"));
    writeDriver(dataRoot);
    writeBoundedGamma(dataRoot);
    const view = loadDecisionSurface({ sessionDate: SESSION, dataRoot });
    const html = renderToStaticMarkup(createElement(DecisionSurface, { view }));
    expect(view.status).toBe("artifacts_missing");
    expect(html).toContain('data-testid="decision-page-status"');
    expect(html).not.toMatch(/data\/drivers\//);
  });

  it("preserves demo fixture isolation", () => {
    const view = loadDecisionSurface({
      sessionDate: SESSION,
      publicDemo: true,
      dataRoot: mkdtempSync(join(tmpdir(), "decide-m84-demo-")),
    });
    expect(view.isPublicDemo).toBe(true);
    expect(view.status).toBe("ready");
    expect(view.research?.evidenceDrillDown.matchedSessions.length).toBe(1);
  });

  it("end-to-end demo fixture flow renders complete M8 sections", () => {
    const view = loadDecisionSurface({
      sessionDate: SESSION,
      publicDemo: true,
    });
    const html = renderToStaticMarkup(createElement(DecisionSurface, { view }));
    expect(view.status).toBe("ready");
    expect(html).toContain('data-testid="decision-observe"');
    expect(html).toContain('data-testid="decision-research"');
    expect(html).toContain('data-testid="decision-evidence-drilldown"');
    expect(html).toContain('data-testid="decision-policy"');
    expect(html).toContain('data-testid="decision-stance"');
  });
});

describe("M8-4 loader regression", () => {
  it("loads pipeline-backed non-demo view with drill-down", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "decide-m84-live-"));
    await seedStudyArtifacts(dataRoot);
    const view = loadDecisionSurface({ sessionDate: SESSION, dataRoot });
    expect(view.status).toBe("ready");
    expect(view.research?.evidenceDrillDown).toBeDefined();
  });

  it("reports invalid bundle without fixture fallback", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "decide-m84-mismatch-"));
    await seedStudyArtifacts(dataRoot);
    const path = studyEvidenceBundlePath(dataRoot, SESSION, SYMBOL);
    const bundle = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    (bundle.queryContext as { sessionDate: string }).sessionDate = "2026-07-30";
    writeFileSync(path, JSON.stringify(bundle));
    const view = loadDecisionSurface({ sessionDate: SESSION, dataRoot });
    expect(view.status).toBe("integrity_failed");
    expect(view.stance).toBeUndefined();
  });

  it("handles missing memo with evidence drill-down only", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "decide-m84-no-memo-"));
    await seedStudyArtifacts(dataRoot);
    const memoPath = studyMemoPath(dataRoot, SESSION);
    if (existsSync(memoPath)) unlinkSync(memoPath);
    const view = loadDecisionSurface({ sessionDate: SESSION, dataRoot });
    expect(view.status).toBe("artifacts_missing");
    expect(view.research?.memoStatus).toBe("unavailable");
    expect(view.research?.evidenceDrillDown.memoBullets).toHaveLength(0);
  });
});
