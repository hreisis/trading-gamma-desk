import type { ProduceDailySpyBreadthResult } from "./produce-daily-spy-breadth";

export const BREADTH_PRODUCER_UPSTREAM_FAILURE_REASONS = new Set([
  "upstream_universe_unavailable",
  "upstream_bars_unavailable",
]);

export function breadthProducerHttpStatus(
  result: ProduceDailySpyBreadthResult,
): number {
  if (result.status === "published" || result.status === "skipped") {
    return 200;
  }
  if (result.status === "failed") {
    return BREADTH_PRODUCER_UPSTREAM_FAILURE_REASONS.has(result.reason)
      ? 502
      : 500;
  }
  return 500;
}

export function logBreadthProducerResult(
  result: ProduceDailySpyBreadthResult,
): void {
  const payload: Record<string, string | null> = {
    status: result.status,
    marketSessionDate:
      result.status === "published"
        ? result.marketSessionDate
        : result.marketSessionDate ?? null,
  };

  if (result.status === "failed" || result.status === "skipped") {
    payload.reason = result.reason;
  }

  if (result.status === "published") {
    payload.snapshotIdentity = result.snapshotIdentity;
    payload.publishedAt = result.publishedAt;
  }

  console.info("[breadth-cron]", payload);
}
