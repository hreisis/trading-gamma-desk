import { describe, expect, it } from "vitest";
import { isUsEquityRegularSessionOpen } from "@/desk/us-equity-session";

describe("isUsEquityRegularSessionOpen", () => {
  it("is open on a weekday from 09:30 through 16:00 ET", () => {
    expect(isUsEquityRegularSessionOpen(new Date("2026-08-24T13:30:00.000Z"))).toBe(
      true,
    );
    expect(isUsEquityRegularSessionOpen(new Date("2026-08-24T20:00:00.000Z"))).toBe(
      true,
    );
  });

  it("is closed before 09:30 ET, after 16:00 ET, and on weekends", () => {
    expect(isUsEquityRegularSessionOpen(new Date("2026-08-24T13:29:00.000Z"))).toBe(
      false,
    );
    expect(isUsEquityRegularSessionOpen(new Date("2026-08-24T20:01:00.000Z"))).toBe(
      false,
    );
    expect(isUsEquityRegularSessionOpen(new Date("2026-08-22T15:00:00.000Z"))).toBe(
      false,
    );
  });
});
