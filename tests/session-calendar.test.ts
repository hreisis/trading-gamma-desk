import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { defaultSessionCalendar } from "@/macro";

/**
 * Reconciles the hand-maintained holiday set against sessions actually
 * returned by Tiingo, recorded by `npm run verify:tiingo`.
 *
 * The holiday set decides which observations count as adjacent, so an error in
 * it silently changes every daily change the pipeline computes. Treasury's
 * sparse file is one witness; this fixture is a second, independent one.
 */

interface ObservedSessions {
  source: string;
  retrievedAt: string;
  range: { startDate: string; endDate: string };
  symbols: string[];
  sessions: string[];
}

const observed: ObservedSessions = JSON.parse(
  readFileSync("fixtures/macro/observed-sessions.tiingo.json", "utf8"),
);

/** Every expected session in the inclusive range, ascending. */
function expectedSessionsBetween(first: string, last: string): string[] {
  const out: string[] = [];
  let cursor = last;
  while (cursor >= first) {
    out.unshift(cursor);
    const previous = defaultSessionCalendar.previousSession(cursor);
    if (previous === null) break;
    cursor = previous;
  }
  return out;
}

describe("holiday set agrees with a second independent source", () => {
  const first = observed.sessions[0]!;
  const last = observed.sessions.at(-1)!;

  it("recorded a usable sample", () => {
    expect(observed.sessions.length).toBeGreaterThan(30);
    expect(defaultSessionCalendar.isSession(first)).toBe(true);
    expect(defaultSessionCalendar.isSession(last)).toBe(true);
  });

  it("returns exactly the sessions the calendar expects", () => {
    const expected = expectedSessionsBetween(first, last);

    const missingFromVendor = expected.filter(
      (d) => !observed.sessions.includes(d),
    );
    const unexpectedFromVendor = observed.sessions.filter(
      (d) => !expected.includes(d),
    );

    // A date the calendar expects but the vendor never traded is a holiday we
    // failed to record; the reverse means we invented one.
    expect(
      missingFromVendor,
      `calendar expects sessions the vendor did not return: ${missingFromVendor.join(", ")}`,
    ).toEqual([]);
    expect(
      unexpectedFromVendor,
      `vendor traded on dates the calendar calls non-sessions: ${unexpectedFromVendor.join(", ")}`,
    ).toEqual([]);
  });

  it("confirms the holidays that fall inside the sampled range", () => {
    const holidaysInRange = ["2026-05-25", "2026-06-19", "2026-07-03"].filter(
      (d) => d >= first && d <= last,
    );
    for (const holiday of holidaysInRange) {
      expect(observed.sessions).not.toContain(holiday);
      expect(defaultSessionCalendar.isSession(holiday)).toBe(false);
    }
    expect(holidaysInRange.length).toBeGreaterThan(0);
  });

  it("contains no weekend dates", () => {
    const weekends = observed.sessions.filter((d) => {
      const day = new Date(`${d}T00:00:00Z`).getUTCDay();
      return day === 0 || day === 6;
    });
    expect(weekends).toEqual([]);
  });
});
