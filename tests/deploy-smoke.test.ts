import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  LIVE_DATA_UNAVAILABLE_MESSAGE,
  PUBLIC_DEMO_BANNER,
  PUBLIC_DEMO_DISCLAIMER,
  PUBLIC_DEMO_DRIVER,
  PUBLIC_DEMO_FIXTURE_PATH,
  PUBLIC_DEMO_SESSION,
  SITE_DESCRIPTION,
  SITE_TITLE,
  formatConfidenceScore,
  loadPublicDemoDeskView,
  resolveDeskRequest,
} from "@/desk";

/**
 * Deployment smoke checks for the public portfolio demo.
 * Does not call Tiingo or read generated data/.
 */
describe("deploy smoke (public synthetic demo)", () => {
  it("bundles a parseable synthetic public-demo DominantDriver", () => {
    // Source file remains in git for editors/review; runtime uses static import.
    expect(existsSync(PUBLIC_DEMO_FIXTURE_PATH)).toBe(true);
    expect(PUBLIC_DEMO_DRIVER.marketSessionDate).toBe(PUBLIC_DEMO_SESSION);
    expect(PUBLIC_DEMO_DRIVER.confidence.calibrated).toBe(false);
    expect(formatConfidenceScore(PUBLIC_DEMO_DRIVER.confidence)).toMatch(
      /^\d+\/100 \(uncalibrated\)$/,
    );
    expect(PUBLIC_DEMO_DRIVER.interpretation.text.length).toBeGreaterThan(0);
  });

  it("loads the public demo view without filesystem data/", () => {
    const view = loadPublicDemoDeskView();
    expect(view.status).toBe("ready");
    expect(view.isPublicDemo).toBe(true);
    expect(view.isLiveDriver).toBe(false);
    expect(view.sourceLabel).toBe(PUBLIC_DEMO_BANNER);
    expect(view.driver?.label).toBe(PUBLIC_DEMO_DRIVER.label);
  });

  it("resolves the public demo homepage as illustrative synthetic, not live/historical", () => {
    const view = resolveDeskRequest({
      publicDemo: true,
      dataRoot: "data-does-not-matter-in-public-demo",
    });
    expect(view.status).toBe("ready");
    expect(view.isPublicDemo).toBe(true);
    expect(view.isLiveDriver).toBe(false);
    expect(view.sourceLabel).toBe(PUBLIC_DEMO_BANNER);
    expect(view.sourceLabel).toContain("Illustrative demo");
    expect(view.sourceLabel).toContain("synthetic");
    expect(view.sourceLabel).not.toContain(PUBLIC_DEMO_SESSION);
    expect(PUBLIC_DEMO_DISCLAIMER).toMatch(/not actual market observations/i);
    expect(JSON.stringify(view).toLowerCase()).not.toContain('"live driver"');
  });

  it("blocks live query in public demo without serving a driver", () => {
    const view = resolveDeskRequest({
      publicDemo: true,
      source: "live",
    });
    expect(view.status).toBe("live_unavailable");
    expect(view.driver).toBeNull();
    expect(view.isLiveDriver).toBe(false);
    expect(view.error?.message).toBe(LIVE_DATA_UNAVAILABLE_MESSAGE);
  });

  it("keeps portfolio metadata suitable for a public host", () => {
    expect(SITE_TITLE.length).toBeGreaterThan(10);
    expect(SITE_DESCRIPTION.length).toBeGreaterThan(40);
    expect(SITE_DESCRIPTION.toLowerCase()).toContain("synthetic");
    expect(SITE_TITLE.toLowerCase()).not.toContain("historical");
  });

  it("does not require Tiingo token or data/ for the public path", () => {
    expect(process.env.TIINGO_TOKEN ?? "").toEqual(expect.any(String));
    const view = resolveDeskRequest({ publicDemo: true });
    expect(view.driver).not.toBeNull();
  });
});
