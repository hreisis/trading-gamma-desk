import { describe, expect, it } from "vitest";
import { easternWallToUtc } from "@/catalyst/market-context/session";
import {
  resolveCurrentMarketSessionDate,
  resolveLastCompletedMarketSessionDate,
} from "@/ai-study/session";

describe("resolveLastCompletedMarketSessionDate", () => {
  it("uses the prior session on a trading day before regular close ET", () => {
    const intraday = easternWallToUtc("2026-08-06", 14, 0, 0);
    expect(resolveCurrentMarketSessionDate(intraday)).toBe("2026-08-06");
    expect(resolveLastCompletedMarketSessionDate(intraday)).toBe("2026-08-05");
  });

  it("uses the same session after regular close ET", () => {
    const afterClose = easternWallToUtc("2026-08-06", 16, 30, 0);
    expect(resolveLastCompletedMarketSessionDate(afterClose)).toBe("2026-08-06");
  });

  it("uses the prior session on weekends", () => {
    const saturday = easternWallToUtc("2026-08-08", 12, 0, 0);
    expect(resolveLastCompletedMarketSessionDate(saturday)).toBe("2026-08-07");
  });
});
