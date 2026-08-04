import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { StudyEvidenceBundle, StudyMemoIntegrationSmokeReport } from "@/contracts";
import {
  assertMemoSummaryMatchesMemo,
  buildStudyMemoInputPacket,
  createFakeStudyMemoNarrator,
  formatStudyMemoSmokeSummary,
  memoSectionCounts,
  parseStudyMemoIntegrationSmokeArgs,
  readStudyEvidenceBundle,
  runStudyMemoIntegrationSmoke,
  runStudyMemoWorkflow,
  sanitizeStudyMemoSummary,
  validateStudyMemoOutput,
  verifyStudyMemoGrounding,
} from "@/study-agent";

const FIXTURE_BUNDLE = "fixtures/studies/evidence-bundle.m62.json";
const SESSION_DATE = "2026-07-29";

describe("M6-3 study memo integration smoke", () => {
  it("parses smoke CLI args with exact date and default bundle", () => {
    const args = parseStudyMemoIntegrationSmokeArgs([
      "--live",
      "--dry-run",
      "--date",
      SESSION_DATE,
    ]);
    expect(args.live).toBe(true);
    expect(args.dryRun).toBe(true);
    expect(args.date).toBe(SESSION_DATE);
    expect(args.bundlePath).toBe(FIXTURE_BUNDLE);
  });

  it("requires --date (no latest fallback)", () => {
    expect(() => parseStudyMemoIntegrationSmokeArgs(["--dry-run"])).toThrow(
      /--date is required/,
    );
  });

  it("offline smoke passes with rule-based fallback (no network)", async () => {
    const bundle = readStudyEvidenceBundle(FIXTURE_BUNDLE);
    const dataRoot = mkdtempSync(join(tmpdir(), "memo-smoke-m63-"));

    const result = await runStudyMemoIntegrationSmoke({
      live: false,
      dryRun: true,
      date: SESSION_DATE,
      bundlePath: FIXTURE_BUNDLE,
      dataRoot,
      publicDemo: false,
      env: { NODE_ENV: "test" },
      generatedAt: bundle.computedAt,
    });

    expect(result.exitCode).toBe(0);
    expect(result.report.overallStatus).toMatch(/passed|partial/);
    expect(result.report.memoSource).toBe("rule_based_fallback");
    expect(result.report.groundingChecks.citationsValid).toBe(true);
    expect(result.report.groundingChecks.numbersValid).toBe(true);
    expect(result.report.groundingChecks.noProhibitedLanguage).toBe(true);
    expect(result.report.memo.bullets.length).toBeGreaterThan(0);
    expect(
      result.report.memo.bullets.every((b) => b.bundleFieldPaths.length > 0),
    ).toBe(true);

    const parsed = StudyMemoIntegrationSmokeReport.parse(
      JSON.parse(readFileSync(result.reportPath!, "utf8")),
    );
    expect(parsed.bundleId).toBe(bundle.bundleId);
    expect(parsed.memo.sectionCounts).toEqual(
      memoSectionCounts(
        (await runStudyMemoWorkflow({
          bundle,
          forceFallback: true,
          generatedAt: bundle.computedAt,
          synthetic: true,
        })).memo,
      ),
    );
  });

  it("offline smoke uses injected fake narrator when provided", async () => {
    const bundle = readStudyEvidenceBundle(FIXTURE_BUNDLE);
    const dataRoot = mkdtempSync(join(tmpdir(), "memo-smoke-m63-fake-"));
    const narrator = createFakeStudyMemoNarrator("ok");

    const result = await runStudyMemoIntegrationSmoke({
      live: false,
      dryRun: true,
      date: SESSION_DATE,
      bundlePath: FIXTURE_BUNDLE,
      dataRoot,
      publicDemo: false,
      env: { NODE_ENV: "test" },
      narrator,
      generatedAt: bundle.computedAt,
    });

    expect(result.exitCode).toBe(0);
    expect(result.report.groundingChecks.citationsValid).toBe(true);
    expect(result.report.memo.provider).toBe("fake");
  });

  it("verifyStudyMemoGrounding rejects memo with bad citation paths", async () => {
    const bundle = readStudyEvidenceBundle(FIXTURE_BUNDLE);
    const { memo: baseMemo } = await runStudyMemoWorkflow({
      bundle,
      forceFallback: true,
      generatedAt: bundle.computedAt,
      synthetic: true,
    });

    const memo = {
      ...baseMemo,
      evidence: [
        {
          ...baseMemo.evidence[0]!,
          bundleFieldPaths: ["bundle.nonexistent.path"],
        },
      ],
    };

    const grounding = verifyStudyMemoGrounding({ bundle, memo });
    expect(grounding.ok).toBe(false);
    expect(grounding.checks.pathsResolve).toBe(false);
  });

  it("sanitizeStudyMemoSummary redacts secrets and truncates previews", async () => {
    const bundle = readStudyEvidenceBundle(FIXTURE_BUNDLE);
    const narrated = await createFakeStudyMemoNarrator("ok").narrate(
      buildStudyMemoInputPacket(bundle),
    );
    expect(narrated.ok).toBe(true);
    if (!narrated.ok) return;

    const memo = validateStudyMemoOutput({
      bundle,
      output: {
        ...narrated.output,
        headline: "sk-proj-abc123xyz headline",
      },
      provider: narrated.provider,
      model: narrated.model,
      generatedAt: bundle.computedAt,
      synthetic: true,
    });

    const summary = sanitizeStudyMemoSummary(memo);
    expect(summary.headline).not.toContain("sk-proj");
    expect(summary.bullets.every((b) => b.textPreview.length <= 240)).toBe(
      true,
    );
    expect(summary.sectionCounts).toEqual(memoSectionCounts(memo));
    assertMemoSummaryMatchesMemo(memo, summary);
  });

  it("formatStudyMemoSmokeSummary uses sectionCounts from validated memo", async () => {
    const bundle = readStudyEvidenceBundle(FIXTURE_BUNDLE);
    const dataRoot = mkdtempSync(join(tmpdir(), "memo-smoke-m63-counts-"));

    const result = await runStudyMemoIntegrationSmoke({
      live: false,
      dryRun: true,
      date: SESSION_DATE,
      bundlePath: FIXTURE_BUNDLE,
      dataRoot,
      publicDemo: false,
      env: { NODE_ENV: "test" },
      generatedAt: bundle.computedAt,
    });

    const summaryLine = formatStudyMemoSmokeSummary(result.report).find((line) =>
      line.startsWith("sections:"),
    );
    expect(summaryLine).toBe(
      `sections: evidence=${result.report.memo.sectionCounts.evidence} inference=${result.report.memo.sectionCounts.inference} limitations=${result.report.memo.sectionCounts.limitations} unknowns=${result.report.memo.sectionCounts.unknowns}`,
    );
    const evidenceInBullets = result.report.memo.bullets.filter(
      (b) => b.kind === "evidence",
    ).length;
    expect(evidenceInBullets).toBe(result.report.memo.sectionCounts.evidence);
  });
});
