import { describe, expect, it } from "vitest";
import {
  BREADTH_INTERNALS_MISSING_REASON,
  BREADTH_LEADERSHIP_CAPABILITY_AUDIT_VERSION,
  breadthLeadershipCapabilityBlocked,
  CONNECTED_PROVIDER_CAPABILITIES,
  LEADERSHIP_ROTATION_MISSING_REASON,
  UNIVERSE_REQUIREMENTS,
} from "@/desk/breadth-leadership/capability-audit";
import { buildMarketInputSnapshot, loadBoundedGammaDeskView } from "@/desk";

describe("V2-3B breadth/leadership capability audit", () => {
  it("documents connected providers without constituent universe APIs", () => {
    expect(BREADTH_LEADERSHIP_CAPABILITY_AUDIT_VERSION).toBe("0.1.0");
    expect(CONNECTED_PROVIDER_CAPABILITIES.length).toBeGreaterThanOrEqual(3);

    const alpacaSnap = CONNECTED_PROVIDER_CAPABILITIES.find(
      (row) => row.endpoint.includes("/snapshots"),
    );
    expect(alpacaSnap?.status).toBe("symbol_only");
    expect(alpacaSnap?.coverage).toMatch(/No index membership/i);

    const tiingo = CONNECTED_PROVIDER_CAPABILITIES.find(
      (row) => row.provider === "tiingo",
    );
    expect(tiingo?.status).toBe("symbol_only");
    expect(tiingo?.coverage).toMatch(/Single-ticker/i);
  });

  it("marks all required universes as not available on connected APIs", () => {
    expect(UNIVERSE_REQUIREMENTS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "spy_constituents" }),
        expect.objectContaining({ id: "ndx_constituents" }),
        expect.objectContaining({ id: "high_beta_universe" }),
        expect.objectContaining({ id: "semiconductor_universe" }),
        expect.objectContaining({ id: "constituent_daily_panels" }),
      ]),
    );
    expect(breadthLeadershipCapabilityBlocked()).toBe(true);
  });

  it("keeps MarketInputSnapshot breadth and leadership as missing with explicit audit reasons", () => {
    const snapshot = buildMarketInputSnapshot({
      targetMarketSessionDate: "2026-08-06",
      generatedAt: "2026-08-06T12:00:00-04:00",
      macro: null,
      alpacaPanel: null,
      catalystFeed: null,
      spyGamma: loadBoundedGammaDeskView({ forceFixture: true }),
      qqqGamma: loadBoundedGammaDeskView({ symbol: "QQQ", publicDemo: true }),
      publicDemo: false,
    });

    const breadth = snapshot.inputs.find((row) => row.key === "breadth_internals");
    const leadership = snapshot.inputs.find(
      (row) => row.key === "leadership_rotation",
    );

    expect(breadth).toMatchObject({
      status: "missing",
      value: null,
      asOf: null,
      marketSessionDate: null,
      stale: false,
      isProxy: false,
      missingReason: BREADTH_INTERNALS_MISSING_REASON,
      source: {
        provider: "none",
        artifact: "not_wired",
        fetchedAt: null,
      },
    });
    expect(leadership).toMatchObject({
      status: "missing",
      value: null,
      missingReason: LEADERSHIP_ROTATION_MISSING_REASON,
      isProxy: false,
    });
    expect(breadth?.missingReason).toMatch(/ETF ratio proxies.*disallowed/i);
    expect(leadership?.missingReason).toMatch(/ETF pairs/i);
  });
});
