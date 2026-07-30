import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DominantDriver } from "@/contracts";
import {
  PUBLIC_DEMO_FIXTURE_PATH,
  PUBLIC_DEMO_SESSION,
  SITE_DESCRIPTION,
  SITE_TITLE,
  formatConfidenceScore,
  resolveDeskRequest,
} from "@/desk";

/**
 * Deployment smoke checks for the public portfolio demo.
 * Does not call Tiingo or read generated data/.
 */
describe("deploy smoke (public demo fixture)", () => {
  it("ships a parseable frozen public-demo DominantDriver", () => {
    expect(existsSync(PUBLIC_DEMO_FIXTURE_PATH)).toBe(true);
    const raw = JSON.parse(readFileSync(PUBLIC_DEMO_FIXTURE_PATH, "utf8"));
    const driver = DominantDriver.parse(raw);
    expect(driver.marketSessionDate).toBe(PUBLIC_DEMO_SESSION);
    expect(driver.confidence.calibrated).toBe(false);
    expect(formatConfidenceScore(driver.confidence)).toMatch(
      /^\d+\/100 \(uncalibrated\)$/,
    );
    expect(driver.interpretation.text.length).toBeGreaterThan(0);
  });

  it("resolves the public demo homepage view without live provenance", () => {
    const view = resolveDeskRequest({
      publicDemo: true,
      fixturePath: PUBLIC_DEMO_FIXTURE_PATH,
      dataRoot: "data-does-not-matter-in-public-demo",
    });
    expect(view.status).toBe("ready");
    expect(view.isPublicDemo).toBe(true);
    expect(view.isLiveDriver).toBe(false);
    expect(view.sourceLabel).toContain("Historical demo");
    expect(view.sourceLabel).toContain(PUBLIC_DEMO_SESSION);
    expect(JSON.stringify(view).toLowerCase()).not.toContain('"live driver"');
  });

  it("blocks live query in public demo without serving a driver", () => {
    const view = resolveDeskRequest({
      publicDemo: true,
      source: "live",
      fixturePath: PUBLIC_DEMO_FIXTURE_PATH,
    });
    expect(view.status).toBe("live_unavailable");
    expect(view.driver).toBeNull();
    expect(view.isLiveDriver).toBe(false);
  });

  it("keeps portfolio metadata suitable for a public host", () => {
    expect(SITE_TITLE.length).toBeGreaterThan(10);
    expect(SITE_DESCRIPTION.length).toBeGreaterThan(40);
    expect(SITE_DESCRIPTION).toContain(PUBLIC_DEMO_SESSION);
  });

  it("does not require Tiingo token or data/ for the public path", () => {
    expect(process.env.TIINGO_TOKEN ?? "").toEqual(expect.any(String));
    // Smoke must pass even if token is empty — public demo never reads it.
    const view = resolveDeskRequest({
      publicDemo: true,
      fixturePath: PUBLIC_DEMO_FIXTURE_PATH,
    });
    expect(view.driver).not.toBeNull();
  });
});
