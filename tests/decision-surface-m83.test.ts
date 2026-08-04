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
import {
  buildDecisionEvidenceDrillDown,
  DECISION_SURFACE_EVIDENCE_BUNDLE,
  DECISION_SURFACE_FIXTURE_SESSION,
  DECISION_SURFACE_MEMO,
  DECISION_SURFACE_PEER_PROFILE,
  DECISION_SURFACE_PEER_SESSIONS,
  DECISION_SURFACE_SIMILAR_REGIME_STUDY,
  formatCitationFieldValue,
  loadDecisionSurface,
  loadDecisionStudyContext,
  PUBLIC_DEMO_DRIVER,
  resolveCitationPreviews,
} from "@/desk";
import { runStudyPipeline, studyEvidenceBundlePath } from "@/studies";
import { studyMemoPath } from "@/study-agent/memo-store";
import partialHorizonBundle from "../fixtures/studies/eval/evidence-bundle.eval-partial-horizon-mfe.json";
import insufficientBundle from "../fixtures/studies/eval/evidence-bundle.eval-insufficient.json";
import spyBoundedFixture from "../fixtures/gamma/providers/marketdata-app/spy-bounded-ui.json";

const SESSION = DECISION_SURFACE_FIXTURE_SESSION;
const SYMBOL = "SPY";
const MANIFEST = "fixtures/studies/pipeline.m64.json";

function renderView(sessionDate: string, options?: { publicDemo?: boolean; dataRoot?: string }) {
  const view = loadDecisionSurface({
    sessionDate,
    publicDemo: options?.publicDemo ?? false,
    dataRoot: options?.dataRoot,
  });
  const html = renderToStaticMarkup(createElement(DecisionSurface, { view }));
  return { view, html };
}

function writeDriver(dataRoot: string, sessionDate = SESSION) {
  const dir = join(dataRoot, "drivers");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${sessionDate}.json`), JSON.stringify(PUBLIC_DEMO_DRIVER));
}

function writeBoundedGamma(dataRoot: string, sessionDate = SESSION) {
  const dir = join(dataRoot, "gamma", "providers", "marketdata-app");
  mkdirSync(dir, { recursive: true });
  const snapshot = {
    ...spyBoundedFixture,
    sessionDate,
    zeroDte: {
      ...(spyBoundedFixture as { zeroDte: Record<string, unknown> }).zeroDte,
      sessionDate,
    },
  };
  writeFileSync(join(dir, "SPY-bounded-latest.json"), JSON.stringify(snapshot));
}

async function seedStudyArtifacts(dataRoot: string, sessionDate = SESSION) {
  writeDriver(dataRoot, sessionDate);
  writeBoundedGamma(dataRoot, sessionDate);
  await runStudyPipeline({
    sessionDate,
    manifestPath: MANIFEST,
    dataRoot,
    dryRun: false,
  });
}

describe("M8-3 evidence drill-down builder", () => {
  it("builds query match fields and similarity from bundle + similar regime study", () => {
    const drillDown = buildDecisionEvidenceDrillDown({
      bundle: DECISION_SURFACE_EVIDENCE_BUNDLE,
      memo: DECISION_SURFACE_MEMO,
      similarRegimeStudy: DECISION_SURFACE_SIMILAR_REGIME_STUDY,
      peerSessions: [...DECISION_SURFACE_PEER_SESSIONS],
    });
    expect(drillDown.queryMatchFields.length).toBeGreaterThan(0);
    expect(drillDown.similarity.matchedFactors.length).toBeGreaterThan(0);
    expect(drillDown.similarity.statusBasisRuleId).toBe(
      DECISION_SURFACE_EVIDENCE_BUNDLE.statusBasis.ruleId,
    );
  });

  it("includes matched session with date, match fields, and horizon outcomes", () => {
    const drillDown = buildDecisionEvidenceDrillDown({
      bundle: DECISION_SURFACE_EVIDENCE_BUNDLE,
      memo: DECISION_SURFACE_MEMO,
      peerSessions: [...DECISION_SURFACE_PEER_SESSIONS],
    });
    expect(drillDown.matchedSessions).toHaveLength(1);
    const session = drillDown.matchedSessions[0]!;
    expect(session.sessionDate).toBe(DECISION_SURFACE_PEER_PROFILE.sessionDate);
    expect(session.matchFields.length).toBeGreaterThan(0);
    expect(session.horizons.find((h) => h.horizon === "5D")?.return).toBe("+2.00%");
    expect(session.horizons.find((h) => h.horizon === "5D")?.mfe).toBe("unknown");
  });

  it("preserves unknown for partial horizons and missing MFE/MAE in drill-down", () => {
    const bundle = StudyEvidenceBundle.parse(partialHorizonBundle);
    const drillDown = buildDecisionEvidenceDrillDown({ bundle, memo: null });
    expect(drillDown.horizons.d20.meanReturn).toBe("unknown");
    expect(drillDown.horizons.d1.meanMfe).toBe("unknown");
    expect(drillDown.horizons.d1.medianMfe).toBe("unknown");
  });

  it("resolves memo citations to canonical bundle paths with display values", () => {
    const previews = resolveCitationPreviews(DECISION_SURFACE_EVIDENCE_BUNDLE, [
      "bundle.evidenceStatus",
      "bundle.horizonEvidence.d5.aggregate.meanReturn",
    ]);
    expect(previews[0]?.path).toBe("bundle.evidenceStatus");
    expect(previews[0]?.resolved).toBe(true);
    expect(previews[0]?.displayValue).toBe("supported");
    expect(previews[1]?.displayValue).toBe("+2.00%");
  });

  it("maps memo bullets into lane-tagged drill-down entries", () => {
    const drillDown = buildDecisionEvidenceDrillDown({
      bundle: DECISION_SURFACE_EVIDENCE_BUNDLE,
      memo: DECISION_SURFACE_MEMO,
    });
    expect(drillDown.memoBullets.some((b) => b.lane === "deterministic")).toBe(true);
    expect(drillDown.memoBullets.some((b) => b.lane === "inference")).toBe(true);
    expect(drillDown.memoBullets.every((b) => b.citations.length > 0)).toBe(true);
  });

  it("excludes sensitive filesystem paths from citation display values", () => {
    expect(formatCitationFieldValue("data/studies/evidence/secret.json")).toBe("unknown");
    expect(formatCitationFieldValue({ relativePath: "fixtures/studies/prices/spy.json" })).not.toMatch(
      /fixtures\//,
    );
    expect(formatCitationFieldValue({ provenance: { relativePath: "data/raw" } })).not.toMatch(
      /data\/raw/,
    );
  });

  it("marks missing peer profile/outcome with unknowns", () => {
    const bundle = StudyEvidenceBundle.parse(insufficientBundle);
    const drillDown = buildDecisionEvidenceDrillDown({ bundle, memo: null });
    expect(drillDown.matchedSessions.length).toBe(0);
  });
});

describe("M8-3 decision surface rendering", () => {
  it("renders expandable drill-down collapsed by default in demo mode", () => {
    const { view, html } = renderView(SESSION, { publicDemo: true });
    expect(view.schemaVersion).toBe("0.3.0");
    expect(view.research?.evidenceDrillDown).toBeDefined();
    expect(html).toContain('data-testid="decision-evidence-drilldown"');
    expect(html).toContain("<details");
    expect(html).toContain('data-testid="drilldown-matched-sessions"');
    expect(html).toContain('data-testid="drilldown-memo-citations"');
  });

  it("renders matched session drill-down for demo fixture peer", () => {
    const { html } = renderView(SESSION, { publicDemo: true });
    expect(html).toContain('data-testid="matched-session-2026-07-15"');
    expect(html).toContain("+2.00%");
  });

  it("renders citation value blocks for memo paths", () => {
    const { html } = renderView(SESSION, { publicDemo: true });
    expect(html).toContain("bundle.evidenceStatus");
    expect(html).toContain('data-testid="citation-value-bundle-evidenceStatus"');
  });

  it("visually lanes deterministic, inference, limitations, and unknowns", () => {
    const { html } = renderView(SESSION, { publicDemo: true });
    expect(html).toContain("decision-lane-deterministic");
    expect(html).toContain("decision-lane-inference");
    expect(html).toContain("decision-lane-limitations");
  });

  it("does not expose local artifact paths in integrity panel", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "decide-m83-paths-"));
    writeDriver(dataRoot);
    writeBoundedGamma(dataRoot);
    const { html } = renderView(SESSION, { dataRoot });
    expect(html).not.toMatch(/data\/drivers\//);
    expect(html).not.toMatch(/data\/studies\//);
  });

  it("suppresses stance on integrity failure while still building drill-down", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "decide-m83-integrity-"));
    await seedStudyArtifacts(dataRoot);
    writeFileSync(studyMemoPath(dataRoot, SESSION), "{ bad");
    const { view, html } = renderView(SESSION, { dataRoot });
    expect(view.studyIntegrityOk).toBe(false);
    expect(view.stance).toBeUndefined();
    expect(view.research?.evidenceDrillDown).toBeDefined();
    expect(html).toContain('data-testid="stance-suppressed-note"');
  });

  it("loads peer context from pipeline manifest in non-demo mode", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "decide-m83-peers-"));
    await seedStudyArtifacts(dataRoot);
    const bundlePath = studyEvidenceBundlePath(dataRoot, SESSION, SYMBOL);
    const bundle = StudyEvidenceBundle.parse(JSON.parse(readFileSync(bundlePath, "utf8")));
    const context = loadDecisionStudyContext({
      sessionDate: SESSION,
      dataRoot,
      matchedStudyIds: bundle.cohortQuality.matchedStudyIds,
      pipelineManifestPath: MANIFEST,
    });
    expect(context.similarRegimeStudy).not.toBeNull();
    expect(context.peerSessions.length).toBe(bundle.cohortQuality.matchedStudyCount);
    const { view } = renderView(SESSION, { dataRoot });
    expect(view.research?.evidenceDrillDown.matchedSessions.length).toBeGreaterThan(0);
  });

  it("keeps demo mode isolated from data/ peer loading", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "decide-m83-demo-iso-"));
    const { view } = renderView(SESSION, { publicDemo: true, dataRoot });
    expect(view.isPublicDemo).toBe(true);
    expect(view.isSynthetic).toBe(true);
    expect(view.research?.evidenceDrillDown.matchedSessions[0]?.sessionDate).toBe(
      "2026-07-15",
    );
  });

  it("never falls back to fixtures in non-demo for unknown dates", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "decide-m83-nofallback-"));
    const view = loadDecisionSurface({
      sessionDate: "2026-07-30",
      publicDemo: false,
      dataRoot,
    });
    expect(view.research).toBeUndefined();
    expect(view.status).toBe("artifacts_missing");
  });

  it("reports missing memo with drill-down from evidence bundle only", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "decide-m83-missing-memo-"));
    await seedStudyArtifacts(dataRoot);
    const memoPath = studyMemoPath(dataRoot, SESSION);
    if (existsSync(memoPath)) unlinkSync(memoPath);
    const { view } = renderView(SESSION, { dataRoot });
    expect(view.research?.evidenceDrillDown.memoBullets).toHaveLength(0);
    expect(view.research?.evidenceDrillDown.horizons.d5.meanReturn).toBeDefined();
  });
});
