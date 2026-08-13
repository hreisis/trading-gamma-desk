import { describe, expect, it } from "vitest";
import { DominantDriver } from "@/contracts";
import fixtureDriver from "../fixtures/macro/dominant-driver.rates-led-easing.json";
import { easternWallToUtc } from "@/catalyst/market-context/session";
import {
  buildMacroDisplayInterpretation,
  patchMacroEvidenceForDisplay,
} from "@/desk/macro-display-returns";
import { summarizeMacroFromDriver } from "@/desk/v2-command-center";

const driver = DominantDriver.parse(fixtureDriver);

describe("macro display returns", () => {
  it("labels completed-session driver evidence with session close-to-close basis", () => {
    const duringSession = easternWallToUtc("2026-08-13", 11, 0, 0);
    const patched = patchMacroEvidenceForDisplay(driver, { now: duringSession });
    const gold = patched.find((row) => row.symbol === "GOLD");
    expect(gold?.statement).toContain("session close-to-close");
    expect(gold?.statement).toMatch(/fell 0\.90%/);
  });

  it("overlays intraday Alpaca ETF proxy returns since prior close", () => {
    const duringSession = easternWallToUtc("2026-08-13", 11, 0, 0);
    const patched = patchMacroEvidenceForDisplay(driver, {
      now: duringSession,
      marketQuotes: [
        {
          symbol: "GLD",
          latestPrice: 228.5,
          dailyChangePct: -0.42,
          timestamp: "2026-08-13T15:00:00.000Z",
          source: "alpaca",
          status: "available",
          error: undefined,
        },
      ],
    });
    const gold = patched.find((row) => row.symbol === "GOLD");
    expect(gold?.statement).toContain("fell 0.42%");
    expect(gold?.statement).toContain("since prior close (live)");
    expect(gold?.zScore).toBeNull();
  });

  it("rebuilds macro summary evidence with live ETF proxy during session", () => {
    const duringSession = easternWallToUtc("2026-08-13", 11, 0, 0);
    const summary = summarizeMacroFromDriver(driver, {
      now: duringSession,
      marketQuotes: [
        {
          symbol: "UUP",
          latestPrice: 28.5,
          dailyChangePct: 0.21,
          timestamp: "2026-08-13T15:00:00.000Z",
          source: "alpaca",
          status: "available",
          error: undefined,
        },
      ],
    });
    expect(summary?.evidence.some((line) => line.includes("since prior close (live)"))).toBe(true);
    expect(summary?.evidence.some((line) => line.includes("rose 0.21%"))).toBe(true);
  });

  it("prefixes intraday macro interpretation with completed-session note", () => {
    const duringSession = easternWallToUtc("2026-08-13", 11, 0, 0);
    const patched = patchMacroEvidenceForDisplay(driver, { now: duringSession });
    const text = buildMacroDisplayInterpretation(driver, patched, duringSession);
    expect(text).toContain("completed-session inputs");
  });
});
