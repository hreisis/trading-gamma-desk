import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { easternWallToUtc } from "@/catalyst/market-context/session";
import {
  buildCommandCenterV1SnapshotFromView,
  buildV2DailyReview,
  isCommandCenterV1SnapshotEligibleNow,
  loadCommandCenterV1Daily,
  maybePersistCommandCenterV1Daily,
  persistCommandCenterV1Daily,
} from "@/desk/command-center-v1";
import { buildV2CommandCenterView } from "@/desk/v2-command-center";
import { loadBoundedGammaDeskView } from "@/desk";

describe("command center v1 daily snapshot", () => {
  it("persists immutable daily snapshots", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "cc-v1-"));
    try {
      const spy = loadBoundedGammaDeskView({ forceFixture: true });
      const view = buildV2CommandCenterView({
        driver: null,
        spyGamma: spy,
        qqqGamma: unavailable("QQQ"),
        now: easternWallToUtc("2026-08-12", 10, 0, 0),
      });
      const snapshot = buildCommandCenterV1SnapshotFromView(
        {
          ...view,
          decisionStatus: "ready",
          sessionDate: "2026-08-12",
          stance: "hold",
          riskScore: view.riskScore ?? 50,
        },
        "2026-08-12T20:00:00.000Z",
      );
      expect(snapshot).not.toBeNull();
      if (!snapshot) return;

      expect(persistCommandCenterV1Daily(dataRoot, snapshot)).toBe(true);
      expect(persistCommandCenterV1Daily(dataRoot, snapshot)).toBe(false);
      expect(loadCommandCenterV1Daily(dataRoot, snapshot.sessionDate)?.riskScore).toBe(
        snapshot.riskScore,
      );
    } finally {
      rmSync(dataRoot, { recursive: true, force: true });
    }
  });
});

describe("command center v1 snapshot timing", () => {
  const sessionDate = "2026-08-12";
  const openLoad = easternWallToUtc(sessionDate, 10, 0, 0);
  const laterLoad = easternWallToUtc(sessionDate, 14, 30, 0);
  const afterClose = easternWallToUtc(sessionDate, 17, 0, 0);

  it("first eligible regular-session load writes snapshot", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "cc-v1-timing-"));
    try {
      const view = readyView(openLoad, sessionDate, 47);
      expect(isCommandCenterV1SnapshotEligibleNow(openLoad)).toBe(true);
      expect(
        maybePersistCommandCenterV1Daily({
          dataRoot,
          view,
          generatedAt: openLoad.toISOString(),
          now: openLoad,
        }),
      ).toBe(true);
      expect(loadCommandCenterV1Daily(dataRoot, sessionDate)?.riskScore).toBe(47);
    } finally {
      rmSync(dataRoot, { recursive: true, force: true });
    }
  });

  it("later intraday load does not overwrite snapshot", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "cc-v1-nooverwrite-"));
    try {
      const firstView = readyView(openLoad, sessionDate, 47);
      maybePersistCommandCenterV1Daily({
        dataRoot,
        view: firstView,
        generatedAt: openLoad.toISOString(),
        now: openLoad,
      });

      const laterView = readyView(laterLoad, sessionDate, 62);
      expect(
        maybePersistCommandCenterV1Daily({
          dataRoot,
          view: laterView,
          generatedAt: laterLoad.toISOString(),
          now: laterLoad,
        }),
      ).toBe(false);
      expect(loadCommandCenterV1Daily(dataRoot, sessionDate)?.riskScore).toBe(47);
    } finally {
      rmSync(dataRoot, { recursive: true, force: true });
    }
  });

  it("after-close first load does not create snapshot", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "cc-v1-afterclose-"));
    try {
      const view = readyView(afterClose, sessionDate, 47);
      expect(isCommandCenterV1SnapshotEligibleNow(afterClose)).toBe(false);
      expect(
        maybePersistCommandCenterV1Daily({
          dataRoot,
          view,
          generatedAt: afterClose.toISOString(),
          now: afterClose,
        }),
      ).toBe(false);
      expect(loadCommandCenterV1Daily(dataRoot, sessionDate)).toBeNull();

      const review = buildV2DailyReview({
        now: afterClose,
        demo: false,
        dataRoot,
      });
      expect(review.status).toBe("unavailable");
      expect(review.missingReason).toContain("No intraday command center snapshot");
    } finally {
      rmSync(dataRoot, { recursive: true, force: true });
    }
  });

  it("force flag still overwrites snapshot for development", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "cc-v1-force-"));
    try {
      const firstView = readyView(openLoad, sessionDate, 47);
      maybePersistCommandCenterV1Daily({
        dataRoot,
        view: firstView,
        generatedAt: openLoad.toISOString(),
        now: openLoad,
      });

      const forcedView = readyView(afterClose, sessionDate, 72);
      expect(
        maybePersistCommandCenterV1Daily({
          dataRoot,
          view: forcedView,
          generatedAt: afterClose.toISOString(),
          now: afterClose,
          force: true,
        }),
      ).toBe(true);
      expect(loadCommandCenterV1Daily(dataRoot, sessionDate)?.riskScore).toBe(72);
    } finally {
      rmSync(dataRoot, { recursive: true, force: true });
    }
  });
});

describe("v2 daily review", () => {
  it("returns pending before regular session close", () => {
    const duringSession = easternWallToUtc("2026-08-12", 14, 0, 0);
    const review = buildV2DailyReview({
      now: duringSession,
      demo: false,
      dataRoot: "data",
    });
    expect(review.status).toBe("pending");
    expect(review.sessionDate).toBeTruthy();
  });

  it("evaluates session outcomes after close from snapshot and Alpaca bars", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "cc-review-"));
    const sessionDate = "2026-08-12";
    const afterClose = easternWallToUtc(sessionDate, 17, 0, 0);
    try {
      const spy = loadBoundedGammaDeskView({ forceFixture: true });
      const view = buildV2CommandCenterView({
        driver: null,
        spyGamma: spy,
        qqqGamma: unavailable("QQQ"),
        now: easternWallToUtc(sessionDate, 10, 0, 0),
      });
      const snapshot = buildCommandCenterV1SnapshotFromView(
        {
          ...view,
          decisionStatus: "ready",
          sessionDate,
          stance: "hold",
          riskScore: 47,
          exposure: { min: 60, max: 75 },
        },
        "2026-08-12T14:00:00.000Z",
      );
      expect(snapshot).not.toBeNull();
      if (!snapshot) return;

      const published = {
        ...snapshot,
        sessionDate,
        spy: {
          ...snapshot.spy,
          spot: 770,
          callWall: 775,
          putWall: 768,
          gammaFlip: 772,
          restOfDayRange: {
            status: "available" as const,
            lower: 765,
            upper: 778,
            confidencePct: 90,
          },
        },
      };
      persistCommandCenterV1Daily(dataRoot, published);

      const bars = new Map([
        [
          "SPY",
          [
            {
              sessionDate,
              open: 769,
              high: 776,
              low: 767,
              close: 771,
              volume: 1_000_000,
            },
          ],
        ],
        [
          "QQQ",
          [
            {
              sessionDate,
              open: 400,
              high: 405,
              low: 398,
              close: 401,
              volume: 500_000,
            },
          ],
        ],
      ]);

      const review = buildV2DailyReview({
        now: afterClose,
        demo: false,
        dataRoot,
        equityBarsBySymbol: bars,
      });

      expect(review.status).toBe("ready");
      expect(review.sessionDate).toBe(sessionDate);
      expect(review.morningStance).toContain("Hold");
      expect(review.actualOutcome).toContain("SPY closed 771");
      expect(review.whatFailed.some((line) => line.includes("call wall"))).toBe(true);
      expect(review.whatWorked.some((line) => line.includes("ROD 90%"))).toBe(true);
    } finally {
      rmSync(dataRoot, { recursive: true, force: true });
    }
  });
});

function unavailable(symbol: "SPY" | "QQQ") {
  return {
    status: "empty" as const,
    snapshot: null,
    withheldSnapshot: null,
    sourceLabel: `${symbol} unavailable`,
    isFixture: false,
    error: { code: "empty" as const, message: "unavailable" },
  };
}

function readyView(
  now: Date,
  sessionDate: string,
  riskScore: number,
): ReturnType<typeof buildV2CommandCenterView> {
  const spy = loadBoundedGammaDeskView({ forceFixture: true });
  const view = buildV2CommandCenterView({
    driver: null,
    spyGamma: spy,
    qqqGamma: unavailable("QQQ"),
    now,
  });
  return {
    ...view,
    decisionStatus: "ready",
    sessionDate,
    stance: "hold",
    riskScore,
    exposure: { min: 60, max: 75 },
  };
}
