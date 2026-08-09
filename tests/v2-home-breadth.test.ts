import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BreadthInternalsSnapshot } from "@/contracts/breadth-internals";
import { parseSpyHoldingsMatrix } from "@/desk/breadth/holdings/parse-spy-holdings";
import { computeSpyBreadthInternals } from "@/desk/breadth/compute/breadth";
import {
  buildV2CommandCenterView,
  summarizeSpyBreadthFromDurable,
  summarizeSpyBreadthFromSnapshot,
} from "@/desk/v2-command-center";
import { loadBoundedGammaDeskView } from "@/desk";

const {
  loadDurableSpyBreadthForMarketInput,
  loadSpyUniverse,
  loadAlpacaDailyBarPanel,
} = vi.hoisted(() => ({
  loadDurableSpyBreadthForMarketInput: vi.fn(),
  loadSpyUniverse: vi.fn(),
  loadAlpacaDailyBarPanel: vi.fn(),
}));

vi.mock("@/desk/breadth/read-durable-breadth", () => ({
  loadDurableSpyBreadthForMarketInput,
}));

vi.mock("@/desk/breadth/universe/load-spy-universe", () => ({
  loadSpyUniverse,
}));

vi.mock("@/desk/breadth/bars/alpaca-panel", () => ({
  loadAlpacaDailyBarPanel,
}));

function sampleRows(): string[][] {
  return [
    ["Fund Name:", "State Street® SPDR® S&P 500® ETF Trust"],
    ["Ticker Symbol:", "SPY"],
    ["Holdings:", "As of 05-Aug-2026"],
    ["Name", "Ticker", "Identifier", "Weight", "Sector", "Shares Held", "Local Currency"],
    ["NVIDIA CORP", "NVDA", "67066G104", "7.99", "-", "100", "USD"],
    ["BERKSHIRE HATHAWAY INC CL B", "BRK.B", "084670702", "1.44", "-", "10", "USD"],
    ["BROWN FORMAN CORP CL B", "BF.B", "115637209", "0.01", "-", "1", "USD"],
  ];
}

function dateOffset(base: string, daysBack: number): string {
  const d = new Date(`${base}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - daysBack);
  return d.toISOString().slice(0, 10);
}

function barsForSymbol(
  symbol: string,
  endDate: string,
  dayCount: number,
  asOf: string,
) {
  const bars = [];
  for (let i = dayCount - 1; i >= 0; i--) {
    const sessionDate = dateOffset(endDate, i);
    const close = symbol === "BRK.B" ? 50 - i * 0.1 : 100 + i;
    bars.push({
      sessionDate,
      open: close,
      high: close + 1,
      low: close - 1,
      close,
      volume: 1_000,
    });
  }
  return { symbol, updatedAt: asOf, bars };
}

function sampleBreadthSnapshot(
  marketSessionDate = "2026-08-06",
  asOf = "2026-08-06T16:00:00.000Z",
): BreadthInternalsSnapshot {
  const universe = parseSpyHoldingsMatrix({
    rows: sampleRows(),
    fetchedAt: asOf,
  });
  return computeSpyBreadthInternals({
    universe: { ...universe, sessionLag: 0, stale: false, status: "available" },
    targetMarketSessionDate: marketSessionDate,
    asOf,
    seriesBySymbol: new Map([
      ["NVDA", barsForSymbol("NVDA", marketSessionDate, 55, asOf)],
      ["BRK.B", barsForSymbol("BRK.B", marketSessionDate, 55, asOf)],
      ["BF.B", barsForSymbol("BF.B", marketSessionDate, 55, asOf)],
    ]),
    barsProvenance: {
      provider: "alpaca",
      priceFeed: "iex",
      isConsolidated: false,
      adjustment: "split",
      requestedSymbols: 3,
      returnedSymbols: 3,
      coverage: 1,
      pages: 1,
      fetchedAt: asOf,
      latestSessionDate: marketSessionDate,
      failedSymbols: [],
    },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  loadDurableSpyBreadthForMarketInput.mockReset();
});

describe("summarizeSpyBreadthFromDurable", () => {
  it("maps fresh available snapshot with real metrics", () => {
    const snapshot = sampleBreadthSnapshot();
    const summary = summarizeSpyBreadthFromDurable(
      {
        snapshot,
        sourceArtifact: "breadth/spy_etf_holdings/snapshots/test.json",
        missingReason: null,
      },
      false,
    );

    expect(summary.status).toBe("available");
    expect(summary.stale).toBe(false);
    expect(summary.marketSessionDate).toBe("2026-08-06");
    expect(summary.asOf).toBe(snapshot.asOf);
    expect(summary.advance).toBe(snapshot.advance);
    expect(summary.decline).toBe(snapshot.decline);
    expect(summary.unchanged).toBe(snapshot.unchanged);
    expect(summary.percentAboveMA20).not.toBeNull();
    expect(summary.sourceArtifact).toContain("breadth/");
  });

  it("retains metrics and marks stale when snapshot session lags", () => {
    const snapshot = {
      ...sampleBreadthSnapshot("2026-08-05"),
      stale: true,
      missingReason:
        "Durable breadth snapshot session 2026-08-05 lags target 2026-08-06 by 1 trading session(s).",
    } as BreadthInternalsSnapshot;

    const summary = summarizeSpyBreadthFromDurable(
      {
        snapshot,
        sourceArtifact: "breadth/spy_etf_holdings/latest.json",
        missingReason: null,
      },
      false,
    );

    expect(summary.stale).toBe(true);
    expect(summary.status).not.toBe("unavailable");
    expect(summary.advance).not.toBeNull();
    expect(summary.missingReason).toMatch(/lags target/);
  });

  it("shows unavailable without fabricated metrics", () => {
    const summary = summarizeSpyBreadthFromDurable(
      {
        snapshot: null,
        sourceArtifact: null,
        missingReason: "No durable breadth latest pointer published.",
      },
      false,
    );

    expect(summary.status).toBe("unavailable");
    expect(summary.advance).toBeNull();
    expect(summary.percentAboveMA20).toBeNull();
    expect(summary.missingReason).toMatch(/latest pointer/i);
  });
});

describe("buildV2CommandCenterView breadth missing list", () => {
  it("does not hardcode SPY breadth as a static missing input", () => {
    const view = buildV2CommandCenterView({
      driver: null,
      spyGamma: loadBoundedGammaDeskView({ forceFixture: true }),
      qqqGamma: loadBoundedGammaDeskView({ symbol: "QQQ", publicDemo: true }),
    });

    expect(view.missingInputs).toContain("Breadth: Nasdaq / high-beta / semis");
    expect(view.missingInputs.join(" ")).not.toMatch(/SPY\s*\/\s*Nasdaq/i);
  });
});

describe("MarketInputSnapshot durable breadth field", () => {
  it("wires available snapshot into breadth_internals", async () => {
    const { buildMarketInputSnapshot } = await import(
      "@/desk/build-market-input-snapshot"
    );
    const snapshot = sampleBreadthSnapshot();
    const marketInput = buildMarketInputSnapshot({
      targetMarketSessionDate: "2026-08-06",
      generatedAt: "2026-08-06T22:00:00.000Z",
      macro: null,
      alpacaPanel: null,
      catalystFeed: null,
      spyGamma: loadBoundedGammaDeskView({ forceFixture: true }),
      qqqGamma: loadBoundedGammaDeskView({ symbol: "QQQ", publicDemo: true }),
      publicDemo: false,
      breadthInternals: snapshot,
      breadthDurableMeta: {
        sourceArtifact: "breadth/spy_etf_holdings/snapshots/test.json",
      },
    });

    const breadth = marketInput.inputs.find((row) => row.key === "breadth_internals");
    expect(breadth?.status).toBe("available");
    expect(breadth?.value).not.toBeNull();
    expect(breadth?.marketSessionDate).toBe("2026-08-06");

    const commandSummary = summarizeSpyBreadthFromSnapshot(snapshot, {
      sourceArtifact: "breadth/spy_etf_holdings/snapshots/test.json",
    });
    expect(commandSummary.advance).toBe(snapshot.advance);
    expect(commandSummary.status).toBe("available");
  });
});

describe("loadV2HomePage durable breadth", () => {
  it("does not call universe or Alpaca bar producers on page load", async () => {
    loadDurableSpyBreadthForMarketInput.mockResolvedValue({
      snapshot: null,
      sourceArtifact: null,
      missingReason: "No durable breadth latest pointer published.",
    });

    const { loadV2HomePage } = await import("@/desk/load-v2-home");
    await loadV2HomePage({ demo: false, forceFixture: true });

    expect(loadDurableSpyBreadthForMarketInput).toHaveBeenCalledOnce();
    expect(loadSpyUniverse).not.toHaveBeenCalled();
    expect(loadAlpacaDailyBarPanel).not.toHaveBeenCalled();
  });

  it("degrades gracefully when durable read throws", async () => {
    loadDurableSpyBreadthForMarketInput.mockRejectedValue(
      new Error("blob auth failed secret-token"),
    );

    const { loadV2HomePage } = await import("@/desk/load-v2-home");
    const { view } = await loadV2HomePage({ demo: false, forceFixture: true });

    expect(view.spyBreadth.status).toBe("unavailable");
    expect(view.spyBreadth.missingReason).toMatch(/Durable breadth read failed/i);
    expect(view.gamma[0].status).toBe("ready");
  });

  it("surfaces published snapshot on the command center view", async () => {
    const snapshot = sampleBreadthSnapshot();
    loadDurableSpyBreadthForMarketInput.mockResolvedValue({
      snapshot,
      sourceArtifact: "breadth/spy_etf_holdings/snapshots/test.json",
      missingReason: null,
    });

    const { loadV2HomePage } = await import("@/desk/load-v2-home");
    const { view } = await loadV2HomePage({ demo: false, forceFixture: true });

    expect(view.spyBreadth.status).toBe("available");
    expect(view.spyBreadth.advance).toBe(snapshot.advance);
    expect(view.spyBreadth.sourceArtifact).toContain("breadth/");
  });
});

describe("client bundle safety", () => {
  it("keeps blob tokens out of the command center component", () => {
    const commandCenter = readFileSync(
      join(process.cwd(), "src/app/components/v2/CommandCenter.tsx"),
      "utf8",
    );
    expect(commandCenter).not.toContain("BLOB_READ_WRITE_TOKEN");
    expect(commandCenter).not.toContain("@vercel/blob");
    expect(commandCenter).not.toContain("loadDurableSpyBreadth");
  });
});
