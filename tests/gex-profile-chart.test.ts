import { describe, expect, it } from "vitest";
import { selectProfileStrikeRows } from "@/app/components/gamma/select-profile-strikes";
import type { BoundedGammaProviderSnapshot } from "@/contracts";
import spyBoundedUi from "../fixtures/gamma/providers/marketdata-app/spy-bounded-ui.json";

const fixture = spyBoundedUi as BoundedGammaProviderSnapshot;

describe("selectProfileStrikeRows", () => {
  it("includes spot, walls, and top concentrations without the full request range", () => {
    const rows = selectProfileStrikeRows(fixture);
    const strikes = rows.map((r) => r.strike);

    expect(strikes).toContain(fixture.boundedCallWall.strike);
    expect(strikes).toContain(fixture.boundedPutWall.strike);
    expect(strikes.length).toBeLessThan(fixture.byStrike.length);
    expect(strikes.length).toBeGreaterThan(10);

    const min = Math.min(...strikes);
    const max = Math.max(...strikes);
    expect(min).toBeGreaterThan(fixture.strikeRequest.min);
    expect(max).toBeLessThan(fixture.strikeRequest.max);
  });

  it("always includes call and put walls even when far from spot", () => {
    const farWalls: BoundedGammaProviderSnapshot = {
      ...fixture,
      spot: 741.63,
      boundedCallWall: { ...fixture.boundedCallWall, strike: 778 },
      boundedPutWall: { ...fixture.boundedPutWall, strike: 702 },
    };
    const strikes = selectProfileStrikeRows(farWalls).map((r) => r.strike);
    expect(strikes).toContain(778);
    expect(strikes).toContain(702);
  });
});
