import { afterEach, describe, expect, it } from "vitest";
import {
  isMarketDataCreditLimitExhausted,
  markMarketDataCreditsExhausted,
  nextMarketDataCreditResetAt,
  resetMarketDataCreditDeferral,
  shouldDeferMarketDataGammaRefresh,
} from "@/gamma/marketdata-app/credits";

describe("MarketData.app daily credit reset", () => {
  afterEach(() => {
    resetMarketDataCreditDeferral();
  });

  it("targets same-day 9:30 AM ET before reset", () => {
    const beforeReset = new Date("2026-08-10T12:00:00.000Z");
    expect(nextMarketDataCreditResetAt(beforeReset).toISOString()).toBe(
      "2026-08-10T13:30:00.000Z",
    );
  });

  it("targets next-day 9:30 AM ET after reset", () => {
    const afterReset = new Date("2026-08-10T20:00:00.000Z");
    expect(nextMarketDataCreditResetAt(afterReset).toISOString()).toBe(
      "2026-08-11T13:30:00.000Z",
    );
  });

  it("defers gamma refresh until the next reset", () => {
    const now = new Date("2026-08-10T15:00:00.000Z");
    markMarketDataCreditsExhausted(now);
    expect(shouldDeferMarketDataGammaRefresh(now)).toBe(true);
    const atReset = nextMarketDataCreditResetAt(now);
    expect(shouldDeferMarketDataGammaRefresh(atReset)).toBe(false);
  });

  it("detects HTTP 429 and vendor credit-limit errors", () => {
    expect(isMarketDataCreditLimitExhausted({ httpStatus: 429 })).toBe(true);
    expect(
      isMarketDataCreditLimitExhausted({
        body: { s: "error", errmsg: "You've reached your API credit limit" },
      }),
    ).toBe(true);
    expect(
      isMarketDataCreditLimitExhausted({ message: "network timeout" }),
    ).toBe(false);
  });
});
