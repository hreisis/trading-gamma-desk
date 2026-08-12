import { createElement } from "react";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GammaDesk } from "@/app/components/gamma/GammaDesk";
import {
  loadBoundedGammaDeskView,
  type BoundedGammaDeskView,
} from "@/desk/load-bounded-gamma";
import spyBoundedUi from "../fixtures/gamma/providers/marketdata-app/spy-bounded-ui.json";

function renderGamma(view: BoundedGammaDeskView): string {
  return renderToStaticMarkup(createElement(GammaDesk, { view }));
}

describe("bounded gamma desk loader", () => {
  it("loads the UI fixture in forceFixture / public-demo mode as incomplete", () => {
    const view = loadBoundedGammaDeskView({ forceFixture: true });
    expect(view.status).toBe("incomplete");
    expect(view.snapshot?.synthetic).toBe(true);
    expect(view.snapshot?.scope).toBe("bounded_single_expiry");
    expect(JSON.stringify(view.snapshot)).not.toContain("Bearer ");
    expect(view.snapshot).not.toHaveProperty("optionSymbol");
  });

  it("returns empty when local snapshot path is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "gamma-ui-empty-"));
    const view = loadBoundedGammaDeskView({
      publicDemo: false,
      forceFixture: false,
      dataRoot: root,
      symbol: "SPY",
    });
    expect(view.status).toBe("empty");
    expect(view.snapshot).toBeNull();
  });

  it("returns malformed for invalid JSON payloads", () => {
    const root = mkdtempSync(join(tmpdir(), "gamma-ui-bad-"));
    writeFileSync(join(root, "SPY-bounded-latest.json"), "{not-json");
    const view = loadBoundedGammaDeskView({
      publicDemo: false,
      forceFixture: false,
      dataRoot: root,
      symbol: "SPY",
    });
    expect(view.status).toBe("malformed");
  });
});

describe("GammaDesk SSR markup", () => {
  it("renders incomplete state with bounded wall labels", () => {
    const view = loadBoundedGammaDeskView({ forceFixture: true });
    const html = renderGamma(view);

    expect(html).toContain('data-testid="gamma-state-incomplete"');
    expect(html).toContain("BOUNDED · SINGLE EXPIRY");
    expect(html).toContain("Bounded Call Wall");
    expect(html).toContain("Bounded Put Wall");
    expect(html).not.toContain("full-market walls");
    expect(html).toContain("not a full-option-chain market estimate");
    expect(html).toContain('data-testid="bounded-call-wall"');
    expect(html).toContain('data-testid="bounded-put-wall"');
    expect(html).toContain('data-testid="gamma-availability"');
    expect(html).toContain("Incomplete");
    expect(html).toContain('data-testid="gex-profile-chart"');
    expect(html).toContain('data-testid="gex-strike-chart"');
    expect(html).toContain('data-testid="gex-strike-table"');
    expect(html).toContain("1 DTE");
    expect(html).toContain("MarketData.app");
    expect(html).toContain("suspect_vendor_greeks");
  });

  it("renders intentional empty state", () => {
    const html = renderGamma({
      status: "empty",
      snapshot: null,
      withheldSnapshot: null,
      sourceLabel: "none",
      isFixture: false,
      error: {
        code: "empty",
        message: "No bounded gamma snapshot yet.",
      },
    });
    expect(html).toContain('data-testid="gamma-state-empty"');
    expect(html).toContain("No bounded gamma snapshot yet.");
  });

  it("renders malformed state", () => {
    const html = renderGamma({
      status: "malformed",
      snapshot: null,
      withheldSnapshot: null,
      sourceLabel: "bad",
      isFixture: false,
      error: {
        code: "malformed",
        message: "Bounded gamma snapshot failed contract validation.",
      },
    });
    expect(html).toContain('data-testid="gamma-state-malformed"');
    expect(html).toContain("failed contract validation");
  });

  it("keeps fixture payload free of raw vendor arrays", () => {
    expect(spyBoundedUi).not.toHaveProperty("optionSymbol");
    expect(spyBoundedUi).not.toHaveProperty("gamma");
    expect(spyBoundedUi.kind).toBe("BoundedGammaProviderSnapshot");
    expect(spyBoundedUi.boundedCallWall.scope).toBe("bounded_single_expiry");
    expect(spyBoundedUi.boundedPutWall.scope).toBe("bounded_single_expiry");
  });
});
