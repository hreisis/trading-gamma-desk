import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FIXTURE_DRIVER_PATH,
  deskSourceLabel,
  formatConfidenceScore,
  formatSignedChange,
  formatZScore,
  isFallbackRegime,
  loadMacroDesk,
  sessionBannerText,
} from "@/desk";

describe("loadMacroDesk", () => {
  it("falls back to the checked-in DominantDriver fixture", () => {
    const emptyRoot = mkdtempSync(join(tmpdir(), "gammadesk-desk-"));
    const payload = loadMacroDesk(emptyRoot, FIXTURE_DRIVER_PATH);
    expect(payload.source).toBe("fixture");
    expect(deskSourceLabel(payload.source)).toBe("fixture fallback");
    expect(payload.snapshotPresent).toBe(false);
    expect(payload.driver.schemaVersion).toBe("0.2.2");
    expect(payload.driver.confidence.calibrated).toBe(false);
    expect(payload.driver.interpretation.text.length).toBeGreaterThan(0);
  });

  it("prefers a local driver when data/drivers is present", () => {
    const payload = loadMacroDesk("data", FIXTURE_DRIVER_PATH);
    // Local workspace has data/drivers; CI without data/ uses fixture.
    if (payload.source === "local_driver") {
      expect(payload.driverPath).toMatch(/data\/drivers\//);
      expect(deskSourceLabel(payload.source)).toBe("live driver");
      expect(payload.driver.confidence.calibrated).toBe(false);
    } else {
      expect(payload.source).toBe("fixture");
      expect(deskSourceLabel(payload.source)).toBe("fixture fallback");
    }
  });
});

describe("desk confidence copy", () => {
  it("marks uncalibrated scores and never invents band labels", () => {
    const emptyRoot = mkdtempSync(join(tmpdir(), "gammadesk-desk-"));
    const { driver } = loadMacroDesk(emptyRoot, FIXTURE_DRIVER_PATH);
    const text = formatConfidenceScore(driver.confidence);
    expect(text).toBe("60/100 (uncalibrated)");
    expect(text.toLowerCase()).not.toMatch(/\b(high|medium|low)\b/);
  });

  it("formats moves and z-scores for display only", () => {
    expect(formatSignedChange(-8, "bps")).toBe("−8 bps");
    expect(formatSignedChange(2.4, "pct")).toBe("+2.40%");
    expect(formatZScore(-1.8)).toBe("−1.80");
    expect(formatZScore(null)).toBe("—");
  });

  it("uses the incomplete-session banner when alignment is not clean", () => {
    const emptyRoot = mkdtempSync(join(tmpdir(), "gammadesk-desk-"));
    const { driver } = loadMacroDesk(emptyRoot, FIXTURE_DRIVER_PATH);
    const incomplete = {
      ...driver,
      isCompleteSession: false,
      sessionAlignment: "partial" as const,
    };
    expect(sessionBannerText(incomplete)).toMatch(
      /^Latest complete macro snapshot/,
    );
    expect(isFallbackRegime("mixed_unresolved")).toBe(true);
    expect(isFallbackRegime("fed_rates")).toBe(false);
  });
});
