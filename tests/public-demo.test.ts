import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FIXTURE_DRIVER_PATH,
  LIVE_DATA_UNAVAILABLE_MESSAGE,
  PUBLIC_DEMO_BANNER,
  PUBLIC_DEMO_DISCLAIMER,
  PUBLIC_DEMO_FIXTURE_PATH,
  PUBLIC_DEMO_SESSION,
  SITE_DESCRIPTION,
  SITE_TITLE,
  formatConfidenceScore,
  isPublicDemoMode,
  loadMacroDesk,
  resolveDeskRequest,
} from "@/desk";

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "gammadesk-m111-"));
}

function plantLiveDriver(root: string): void {
  const dir = join(root, "drivers");
  mkdirSync(dir, { recursive: true });
  const raw = JSON.parse(readFileSync(FIXTURE_DRIVER_PATH, "utf8")) as {
    marketSessionDate: string;
    label: string;
  };
  raw.marketSessionDate = "2026-07-28";
  raw.label = "LIVE_SHOULD_NOT_APPEAR";
  writeFileSync(join(dir, "2026-07-28.json"), JSON.stringify(raw, null, 2));
}

describe("isPublicDemoMode", () => {
  it("reads GAMMADESK_PUBLIC_DEMO explicitly", () => {
    expect(isPublicDemoMode({})).toBe(false);
    expect(isPublicDemoMode({ GAMMADESK_PUBLIC_DEMO: "1" })).toBe(true);
    expect(isPublicDemoMode({ GAMMADESK_PUBLIC_DEMO: "true" })).toBe(true);
    expect(isPublicDemoMode({ GAMMADESK_PUBLIC_DEMO: "0" })).toBe(false);
  });
});

describe("production public demo mode", () => {
  it("serves the synthetic fixture without live provenance or historical claims", () => {
    const root = tempRoot();
    plantLiveDriver(root);

    const view = resolveDeskRequest({
      publicDemo: true,
      dataRoot: root,
      fixturePath: PUBLIC_DEMO_FIXTURE_PATH,
    });

    expect(view.status).toBe("ready");
    expect(view.isPublicDemo).toBe(true);
    expect(view.isDemo).toBe(true);
    expect(view.isLiveDriver).toBe(false);
    expect(view.source).toBe("fixture");
    expect(view.sourceLabel).toBe(PUBLIC_DEMO_BANNER);
    expect(view.sourceLabel).toBe("Illustrative demo · synthetic scenario");
    expect(view.sourceLabel!.toLowerCase()).not.toContain("historical");
    expect(view.sourceLabel!).not.toContain(PUBLIC_DEMO_SESSION);
    expect(PUBLIC_DEMO_DISCLAIMER.toLowerCase()).toContain("synthetic");
    expect(view.driver?.marketSessionDate).toBe(PUBLIC_DEMO_SESSION);
    expect(view.driver?.label).not.toBe("LIVE_SHOULD_NOT_APPEAR");
    expect(view.driver?.confidence.calibrated).toBe(false);
    expect(formatConfidenceScore(view.driver!.confidence)).toBe(
      "60/100 (uncalibrated)",
    );
    expect(view.driverPath).toBe(PUBLIC_DEMO_FIXTURE_PATH);
  });

  it("returns live_unavailable for ?source=live without silent fixture or live disguise", () => {
    const root = tempRoot();
    plantLiveDriver(root);

    const view = resolveDeskRequest({
      publicDemo: true,
      source: "live",
      dataRoot: root,
      fixturePath: PUBLIC_DEMO_FIXTURE_PATH,
    });

    expect(view.status).toBe("live_unavailable");
    expect(view.isPublicDemo).toBe(true);
    expect(view.isLiveDriver).toBe(false);
    expect(view.driver).toBeNull();
    expect(view.source).toBeNull();
    expect(view.error?.code).toBe("live_unavailable");
    expect(view.error?.message).toBe(LIVE_DATA_UNAVAILABLE_MESSAGE);
    expect(view.error?.message).toBe("Live data unavailable in public demo");
  });

  it("does not imply live when source=fixture under public demo", () => {
    const view = resolveDeskRequest({
      publicDemo: true,
      source: "fixture",
      dataRoot: tempRoot(),
      fixturePath: PUBLIC_DEMO_FIXTURE_PATH,
    });
    expect(view.isLiveDriver).toBe(false);
    expect(view.sourceLabel).toBe(PUBLIC_DEMO_BANNER);
  });
});

describe("local mode unchanged without public demo", () => {
  it("still prefers live drivers when publicDemo is false", () => {
    const root = tempRoot();
    plantLiveDriver(root);
    const view = resolveDeskRequest({
      publicDemo: false,
      dataRoot: root,
      fixturePath: FIXTURE_DRIVER_PATH,
    });
    expect(view.isPublicDemo).toBe(false);
    expect(view.isLiveDriver).toBe(true);
    expect(view.driver?.label).toBe("LIVE_SHOULD_NOT_APPEAR");
  });

  it("still supports local live-only empty without public demo", () => {
    const view = resolveDeskRequest({
      publicDemo: false,
      source: "live",
      dataRoot: tempRoot(),
      fixturePath: FIXTURE_DRIVER_PATH,
    });
    expect(view.status).toBe("empty");
    expect(view.isPublicDemo).toBe(false);
  });

  it("loadMacroDesk alone keeps prior fixture-fallback behaviour", () => {
    const view = loadMacroDesk({
      dataRoot: tempRoot(),
      fixturePath: FIXTURE_DRIVER_PATH,
    });
    expect(view.isPublicDemo).toBe(false);
    expect(view.source).toBe("fixture");
    expect(view.sourceLabel).toBe("demo · fixture fallback");
  });
});

describe("portfolio metadata", () => {
  it("describes an illustrative synthetic demo, not a real session", () => {
    expect(SITE_TITLE).toMatch(/GammaDesk/);
    expect(SITE_TITLE).toMatch(/Illustrative Demo/i);
    expect(SITE_DESCRIPTION.toLowerCase()).toContain("synthetic");
    expect(SITE_DESCRIPTION.toLowerCase()).toContain("uncalibrated");
    expect(SITE_DESCRIPTION.toLowerCase()).not.toContain("historical fixture");
  });
});
