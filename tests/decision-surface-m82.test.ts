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
import {
  StudyEvidenceBundle,
} from "@/contracts";
import {
  buildDecisionEvidenceSummary,
  deriveEvidenceStrengthDisplay,
  formatStudyReturnPercent,
  loadDecisionSurface,
  memoProvenanceLabel,
  PUBLIC_DEMO_DRIVER,
} from "@/desk";
import { runStudyPipeline, studyEvidenceBundlePath } from "@/studies";
import { studyMemoPath } from "@/study-agent/memo-store";
import n1Bundle from "../fixtures/studies/eval/evidence-bundle.eval-supported-thin-n1.json";
import adequateBundle from "../fixtures/studies/eval/evidence-bundle.eval-supported-adequate.json";
import insufficientBundle from "../fixtures/studies/eval/evidence-bundle.eval-insufficient.json";
import notSupportedBundle from "../fixtures/studies/eval/evidence-bundle.eval-not-supported.json";
import partialHorizonBundle from "../fixtures/studies/eval/evidence-bundle.eval-partial-horizon-mfe.json";
import spyBoundedFixture from "../fixtures/gamma/providers/marketdata-app/spy-bounded-ui.json";

const SESSION = "2026-07-29";
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

function writeBundle(dataRoot: string, bundle: unknown, sessionDate = SESSION) {
  const path = studyEvidenceBundlePath(dataRoot, sessionDate, SYMBOL);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(bundle));
}

describe("M8-2 decision evidence display", () => {
  it("formats null metrics as unknown, not zero", () => {
    expect(formatStudyReturnPercent(null)).toBe("unknown");
    expect(formatStudyReturnPercent(undefined)).toBe("unknown");
    expect(formatStudyReturnPercent(0.0123)).toBe("+1.23%");
    expect(formatStudyReturnPercent(-0.05)).toBe("−5.00%");
  });

  it("labels n=1 supported cohort as preliminary", () => {
    const bundle = StudyEvidenceBundle.parse(n1Bundle);
    const { strength, strengthSummary } = deriveEvidenceStrengthDisplay(bundle);
    expect(strength).toBe("preliminary");
    expect(strengthSummary).toBe(
      "Preliminary positive evidence — single historical match (n=1).",
    );
  });

  it("labels adequate cohort with sparse MFE/MAE as limited display strength", () => {
    const bundle = StudyEvidenceBundle.parse(adequateBundle);
    expect(bundle.cohortQuality.status).toBe("adequate");
    expect(deriveEvidenceStrengthDisplay(bundle).strength).toBe("limited");
  });

  it("distinguishes not_supported from insufficient_evidence", () => {
    const notSupported = StudyEvidenceBundle.parse(notSupportedBundle);
    const insufficient = StudyEvidenceBundle.parse(insufficientBundle);
    const nsSummary = buildDecisionEvidenceSummary(notSupported);
    const insSummary = buildDecisionEvidenceSummary(insufficient);
    expect(nsSummary.evidenceStatus).toBe("not_supported");
    expect(insSummary.evidenceStatus).toBe("insufficient_evidence");
    expect(nsSummary.evidenceStatusNote).toMatch(/distinct from insufficient evidence/);
    expect(insSummary.evidenceStatusNote).toMatch(/not the same as a negative/);
  });

  it("preserves unknown for partial horizons and missing MFE/MAE", () => {
    const bundle = StudyEvidenceBundle.parse(partialHorizonBundle);
    const summary = buildDecisionEvidenceSummary(bundle);
    expect(summary.horizons.d20.meanReturn).toBe("unknown");
    expect(summary.horizons.d1.meanMfe).toBe("unknown");
  });

  it("labels memo provenance for OpenAI vs rule-based fallback", () => {
    expect(
      memoProvenanceLabel({
        memoStatus: "complete",
        provider: "openai",
        model: "gpt-test",
      }).sourceLabel,
    ).toBe("OpenAI");
    expect(
      memoProvenanceLabel({
        memoStatus: "unavailable",
        provider: "rule_based",
        model: "study_memo_v1",
        pipelineMemoSource: "rule_based_fallback",
      }).sourceLabel,
    ).toBe("Rule-based fallback");
    expect(
      memoProvenanceLabel({
        memoStatus: "abstained",
        provider: "openai",
        model: "gpt-test",
      }).sourceLabel,
    ).toBe("Deterministic abstain");
  });
});

describe("M8-2 exact-date artifact loading", () => {
  it("returns artifacts_missing when study artifacts absent", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "decide-m82-missing-"));
    writeDriver(dataRoot);
    writeBoundedGamma(dataRoot);
    const { view } = renderView(SESSION, { dataRoot });
    expect(view.status).toBe("artifacts_missing");
    expect(view.studyIntegrityOk).toBe(false);
    expect(view.stance).toBeUndefined();
    expect(view.artifactIssues.some((i) => i.artifact === "evidence_bundle")).toBe(
      true,
    );
  });

  it("loads ready view for exact-date aligned artifacts", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "decide-m82-ready-"));
    await seedStudyArtifacts(dataRoot);
    const { view, html } = renderView(SESSION, { dataRoot });
    expect(view.status).toBe("ready");
    expect(view.studyIntegrityOk).toBe(true);
    expect(view.research?.evidenceSummary.strengthDisplay).toBeDefined();
    expect(view.stance).toBeDefined();
    expect(html).toContain('data-testid="decision-evidence"');
    expect(html).toContain('data-testid="decision-stance"');
    expect(html).toContain("uncalibrated");
  });

  it("never falls back to fixtures in non-demo mode", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "decide-m82-nofallback-"));
    const view = loadDecisionSurface({
      sessionDate: "2026-07-30",
      publicDemo: false,
      dataRoot,
    });
    expect(view.isSynthetic).toBe(false);
    expect(view.status).toBe("artifacts_missing");
    expect(view.sourceLabel).not.toMatch(/fixture/i);
  });

  it("reports integrity_failed on bundle sessionDate mismatch", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "decide-m82-mismatch-"));
    await seedStudyArtifacts(dataRoot);
    const path = studyEvidenceBundlePath(dataRoot, SESSION, SYMBOL);
    const bundle = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    (bundle.queryContext as { sessionDate: string }).sessionDate = "2026-07-30";
    writeFileSync(path, JSON.stringify(bundle));
    const { view } = renderView(SESSION, { dataRoot });
    expect(view.status).toBe("integrity_failed");
    expect(view.studyIntegrityOk).toBe(false);
    expect(view.stance).toBeUndefined();
    expect(view.research?.evidenceSummary).toBeDefined();
  });

  it("reports invalid study memo and suppresses stance", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "decide-m82-invalid-memo-"));
    await seedStudyArtifacts(dataRoot);
    writeFileSync(studyMemoPath(dataRoot, SESSION), "{ not-json ");
    const { view, html } = renderView(SESSION, { dataRoot });
    expect(view.status).toBe("integrity_failed");
    expect(view.stance).toBeUndefined();
    expect(html).toContain('data-testid="stance-suppressed-note"');
  });

  it("reports missing memo with evidence panel and no stance", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "decide-m82-missing-memo-"));
    await seedStudyArtifacts(dataRoot);
    const memoPath = studyMemoPath(dataRoot, SESSION);
    if (existsSync(memoPath)) {
      unlinkSync(memoPath);
    }
    const { view, html } = renderView(SESSION, { dataRoot });
    expect(view.status).toBe("artifacts_missing");
    expect(view.research?.memoStatus).toBe("unavailable");
    expect(view.stance).toBeUndefined();
    expect(html).toContain('data-testid="decision-evidence"');
  });

  it("reports structure mismatch when gamma sessionDate differs", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "decide-m82-gamma-mismatch-"));
    await seedStudyArtifacts(dataRoot);
    writeBoundedGamma(dataRoot, "2026-07-30");
    const { view } = renderView(SESSION, { dataRoot });
    expect(view.status).toBe("partial");
    expect(view.artifactIssues.some((i) => i.artifact === "structure" && i.severity === "mismatched")).toBe(
      true,
    );
    expect(view.studyIntegrityOk).toBe(true);
    expect(view.stance).toBeDefined();
  });

  it("renders n=1 strength summary from eval fixture bundle", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "decide-m82-n1-"));
    await seedStudyArtifacts(dataRoot);
    writeBundle(dataRoot, n1Bundle);
    const { html } = renderView(SESSION, { dataRoot });
    expect(html).toContain("Preliminary positive evidence — single historical match (n=1)");
  });
});

describe("M8-2 demo isolation", () => {
  it("demo mode uses fixtures only and rejects unknown dates", () => {
    const view = loadDecisionSurface({
      sessionDate: "2026-07-30",
      publicDemo: true,
    });
    expect(view.status).toBe("date_unavailable");
    expect(view.isSynthetic).toBe(true);
  });

  it("demo mode never reads local data root", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "decide-m82-demo-isolated-"));
    const view = loadDecisionSurface({
      sessionDate: SESSION,
      publicDemo: true,
      dataRoot,
    });
    expect(view.status).toBe("ready");
    expect(view.isSynthetic).toBe(true);
    expect(view.artifactIssues).toHaveLength(0);
    expect(existsSync(join(dataRoot, "drivers", `${SESSION}.json`))).toBe(false);
  });
});

describe("M8-2 decision surface SSR labels", () => {
  it("renders evidence before memo with provenance label", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "decide-m82-ssr-"));
    await seedStudyArtifacts(dataRoot);
    const { html } = renderView(SESSION, { dataRoot });
    const evidenceIdx = html.indexOf('data-testid="decision-evidence"');
    const memoIdx = html.indexOf('data-testid="decision-memo"');
    expect(evidenceIdx).toBeGreaterThan(-1);
    expect(memoIdx).toBeGreaterThan(evidenceIdx);
    expect(html).toContain('data-testid="memo-provenance"');
    expect(html).toMatch(/rule_based|OpenAI|Deterministic abstain|fallback/i);
  });
});
