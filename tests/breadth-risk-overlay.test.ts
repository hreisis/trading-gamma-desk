import { describe, expect, it } from "vitest";
import { computeBreadthRiskOverlay } from "@/desk/breadth/risk-overlay/compute";
import { legacyStoredSnapshotJson } from "./helpers/breadth-fixtures";
import {
  buildOverlayBreadthSnapshot,
  overlayEligibleSeries,
  partialOverlaySnapshot,
  staleOverlaySnapshot,
  unavailableMetricsOverlaySnapshot,
} from "./helpers/breadth-risk-overlay-fixtures";

describe("computeBreadthRiskOverlay", () => {
  it("returns unavailable when no eligible sessions", () => {
    const result = computeBreadthRiskOverlay({ snapshots: [] });
    expect(result.dataStatus).toBe("unavailable");
    expect(result.sessionCount).toBe(0);
    expect(result.asOf).toBeNull();
    expect(result.regime).toBeNull();
    expect(result.riskCap).toBeNull();
    expect(result.diagnostics.eligibleSessionCount).toBe(0);
  });

  it("returns insufficient_history for 1–4 eligible sessions", () => {
    const result = computeBreadthRiskOverlay({
      snapshots: overlayEligibleSeries(4),
    });
    expect(result.dataStatus).toBe("insufficient_history");
    expect(result.sessionCount).toBe(4);
    expect(result.regime).toBeNull();
    expect(result.riskCap).toBeNull();
    expect(result.diagnostics.eligibleSessionCount).toBe(4);
  });

  it("returns available for five or more eligible sessions", () => {
    const result = computeBreadthRiskOverlay({
      snapshots: overlayEligibleSeries(5),
    });
    expect(result.dataStatus).toBe("available");
    expect(result.sessionCount).toBe(5);
    expect(result.asOf).toBe("2026-08-10T16:00:00.000Z");
    expect(result.regime).toBeNull();
    expect(result.riskCap).toBeNull();
  });

  it("excludes legacy 0.1.0 from sessionCount and records diagnostics", () => {
    const legacyJson = legacyStoredSnapshotJson(
      buildOverlayBreadthSnapshot("2026-08-04"),
    );
    const legacy = JSON.parse(legacyJson);
    const result = computeBreadthRiskOverlay({
      snapshots: [...overlayEligibleSeries(3), legacy, legacy],
    });
    expect(result.dataStatus).toBe("insufficient_history");
    expect(result.sessionCount).toBe(3);
    expect(result.diagnostics.excludedLegacy).toBe(2);
    expect(result.regime).toBeNull();
    expect(result.riskCap).toBeNull();
  });

  it("returns unavailable when only legacy snapshots are supplied", () => {
    const legacyJson = legacyStoredSnapshotJson(
      buildOverlayBreadthSnapshot("2026-08-10"),
    );
    const legacy = JSON.parse(legacyJson);
    const result = computeBreadthRiskOverlay({ snapshots: [legacy] });
    expect(result.dataStatus).toBe("unavailable");
    expect(result.sessionCount).toBe(0);
    expect(result.diagnostics.excludedLegacy).toBe(1);
    expect(result.regime).toBeNull();
    expect(result.riskCap).toBeNull();
  });

  it("records partial, stale, and unavailable-metric exclusions", () => {
    const result = computeBreadthRiskOverlay({
      snapshots: [
        ...overlayEligibleSeries(3),
        partialOverlaySnapshot(),
        staleOverlaySnapshot(),
        unavailableMetricsOverlaySnapshot(),
      ],
    });
    expect(result.dataStatus).toBe("insufficient_history");
    expect(result.sessionCount).toBe(3);
    expect(result.diagnostics.excludedPartial).toBe(1);
    expect(result.diagnostics.excludedStaleSnapshot).toBe(1);
    expect(result.diagnostics.excludedUnavailableMetrics).toBe(1);
    expect(result.regime).toBeNull();
    expect(result.riskCap).toBeNull();
  });

  it("always returns null regime and riskCap", () => {
    const cases = [
      computeBreadthRiskOverlay({ snapshots: [] }),
      computeBreadthRiskOverlay({ snapshots: overlayEligibleSeries(2) }),
      computeBreadthRiskOverlay({ snapshots: overlayEligibleSeries(5) }),
      computeBreadthRiskOverlay({ snapshots: overlayEligibleSeries(7) }),
    ];
    for (const result of cases) {
      expect(result.regime).toBeNull();
      expect(result.riskCap).toBeNull();
    }
  });
});
