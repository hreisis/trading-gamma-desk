/**
 * Completed-session Daily Review example (deterministic critique path).
 * Usage: npx tsx scripts/run-daily-review-example.ts
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { easternWallToUtc } from "@/catalyst/market-context/session";
import {
  buildV2DailyReviewFallback,
  buildV2DailyReviewPayload,
} from "@/ai-study/v2-daily-review-interpret";
import {
  buildCommandCenterV1SnapshotFromView,
  buildDeterministicV2DailyReview,
  persistCommandCenterV1Daily,
} from "@/desk/command-center-v1";
import { buildV2CommandCenterView } from "@/desk/v2-command-center";
import { loadBoundedGammaDeskView } from "@/desk";

async function main(): Promise<void> {
  const dataRoot = mkdtempSync(join(tmpdir(), "cc-review-demo-"));
  const sessionDate = "2026-08-12";
  const afterClose = easternWallToUtc(sessionDate, 17, 0, 0);
  const spy = loadBoundedGammaDeskView({ forceFixture: true });
  const view = await buildV2CommandCenterView({
    driver: null,
    spyGamma: spy,
    qqqGamma: {
      status: "empty",
      snapshot: null,
      withheldSnapshot: null,
      sourceLabel: "QQQ unavailable",
      isFixture: false,
      error: { code: "empty", message: "unavailable" },
    },
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
  if (!snapshot) throw new Error("snapshot missing");
  const published = {
    ...snapshot,
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

  const { review, context } = await buildDeterministicV2DailyReview({
    now: afterClose,
    demo: false,
    dataRoot,
    equityBarsBySymbol: bars,
  });
  if (!context) throw new Error("review context missing");

  const payload = buildV2DailyReviewPayload(review, context, view);
  const interpreted = buildV2DailyReviewFallback(review, payload, context);

  console.log(JSON.stringify({
    morningStance: interpreted.morningStance,
    actualOutcome: interpreted.actualOutcome,
    whatWorked: interpreted.whatWorked,
    whatFailed: interpreted.whatFailed,
    errorSource: interpreted.errorSource,
    errorExplanation: interpreted.errorExplanation,
    tomorrowWatch: interpreted.tomorrowWatch,
    confidence: interpreted.confidence,
    dataLimitations: interpreted.dataLimitations,
  }, null, 2));

  rmSync(dataRoot, { recursive: true, force: true });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
