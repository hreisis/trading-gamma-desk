import { resolvePriorCompletedMarketSessionDate } from '@/ai-study/session';
import { readJson, writeJson, type RuntimeJsonStore } from './runtime-store';
import { isRiskDecisionV1_1DailyRecordPublishable, type RiskDecisionV1_1Result } from './risk-decision-v1-1';

// Isolate the current bounded-sample methodology from older full-chain scores.
const VERSION = 'bounded-overview-v1';
const path = (session: string) => `risk-spread/${VERSION}/${session}.json`;
export async function loadPriorRiskSpread(store: RuntimeJsonStore, session: string, basis: string): Promise<number | null> {
 const previous = resolvePriorCompletedMarketSessionDate(session);
 if (!previous) return null;
 try {
  const row = await readJson(store, path(previous)) as {session?: string; basis?: string; divergence?: number} | null;
  return row?.session === previous && row.basis === basis && typeof row.divergence === 'number' && Number.isFinite(row.divergence) ? row.divergence : null;
 } catch { return null; }
}
export async function saveRiskSpread(store: RuntimeJsonStore, session: string, basis: string, result: RiskDecisionV1_1Result): Promise<void> {
 if (!isRiskDecisionV1_1DailyRecordPublishable(result)) return;
 // First complete observation of each input session. Repeated page loads cannot
 // replace its comparison baseline with a different event window or source.
 try { await writeJson(store, path(session), {session, basis, divergence: result.riskDivergence}); }
 catch { /* History failure must not block the current decision. */ }
}
