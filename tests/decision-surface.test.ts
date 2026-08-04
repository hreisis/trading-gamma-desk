import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DecisionSurface } from "@/app/components/DecisionSurface";
import {
  buildDeskStance,
  DECISION_SURFACE_FIXTURE_SESSION,
  DECISION_SURFACE_MEMO,
  loadDecisionSurface,
  parseDecisionSurfaceDateParam,
} from "@/desk";

const PROHIBITED =
  /\b(buy|sell|long|short|overweight|underweight|probability|go long|go short)\b/i;

function renderDecision(sessionDate?: string): string {
  const view = loadDecisionSurface({ sessionDate, publicDemo: true });
  return renderToStaticMarkup(createElement(DecisionSurface, { view }));
}

describe("M8-1 decision surface loader", () => {
  it("requires explicit session date", () => {
    const view = loadDecisionSurface({ sessionDate: undefined });
    expect(view.status).toBe("missing_date");
    expect(view.errorMessage).toMatch(/Exact session date is required/);
  });

  it("rejects unknown dates without latest fallback", () => {
    const view = loadDecisionSurface({ sessionDate: "2026-07-30" });
    expect(view.status).toBe("date_unavailable");
    expect(view.errorMessage).toMatch(/No bundled decision-surface fixtures/);
  });

  it("loads ready view for fixture session", () => {
    const view = loadDecisionSurface({
      sessionDate: DECISION_SURFACE_FIXTURE_SESSION,
    });
    expect(view.status).toBe("ready");
    expect(view.observe?.confidenceDisplay).toMatch(/uncalibrated/);
    expect(view.research?.evidence.length).toBeGreaterThan(0);
    expect(view.policy?.status).toBe("unavailable");
    expect(view.stance?.nonTrade).toBe(true);
    expect(view.stance?.evidenceStatus).toBe("supported");
  });

  it("parses date query param", () => {
    expect(parseDecisionSurfaceDateParam("2026-07-29")).toBe("2026-07-29");
    expect(parseDecisionSurfaceDateParam(["2026-07-29"])).toBe("2026-07-29");
    expect(parseDecisionSurfaceDateParam(undefined)).toBeUndefined();
  });
});

describe("M8-1 desk stance", () => {
  it("derives non-trade stance from evidence and structure", () => {
    const view = loadDecisionSurface({
      sessionDate: DECISION_SURFACE_FIXTURE_SESSION,
    });
    const stance = buildDeskStance({
      sessionDate: DECISION_SURFACE_FIXTURE_SESSION,
      evidenceStatus: "supported",
      structure: null,
    });
    expect(stance.nonTrade).toBe(true);
    expect(stance.summary).toMatch(/not a directional forecast/i);
    expect(PROHIBITED.test(stance.summary)).toBe(false);
    expect(view.stance?.summary).toMatch(/Historical similar-regime/);
  });
});

describe("M8-1 decision surface SSR", () => {
  it("renders hero column with observe, research, policy, and stance", () => {
    const html = renderDecision(DECISION_SURFACE_FIXTURE_SESSION);
    expect(html).toContain('data-testid="decision-surface"');
    expect(html).toContain('data-testid="decision-observe"');
    expect(html).toContain('data-testid="decision-research"');
    expect(html).toContain('data-testid="decision-policy"');
    expect(html).toContain('data-testid="decision-stance"');
    expect(html).toContain("uncalibrated");
    expect(html).toContain("Portfolio policy is unavailable");
    expect(PROHIBITED.test(html)).toBe(false);
  });

  it("shows citation paths on research bullets", () => {
    const html = renderDecision(DECISION_SURFACE_FIXTURE_SESSION);
    const firstPath = DECISION_SURFACE_MEMO.evidence[0]!.bundleFieldPaths[0]!;
    expect(html).toContain(firstPath);
    expect(html).toContain('data-testid="citation-');
  });

  it("renders missing-date error without observe sections", () => {
    const view = loadDecisionSurface({ sessionDate: undefined });
    const html = renderToStaticMarkup(
      createElement(DecisionSurface, { view }),
    );
    expect(html).toContain('data-testid="decision-error"');
    expect(html).not.toContain('data-testid="decision-observe"');
  });
});
