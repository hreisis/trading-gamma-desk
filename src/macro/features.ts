import {
  ASSET_REGISTRY,
  FeatureFlag,
  MacroFeature,
  MacroSymbol,
} from "@/contracts";
import { SessionCalendar, defaultSessionCalendar } from "./calendar";
import {
  changeKindFor,
  computeChange,
  isValidObservation,
  unitFor,
} from "./transforms";
import { applySigmaFloor, sigmaRawFromChanges, zScoreOf } from "./zscore";

export const DEFAULT_WINDOW_LENGTH = 20;

export interface DailyObservation {
  sessionDate: string;
  value: number;
}

export interface FeatureInput {
  symbol: MacroSymbol;
  /** Raw observations. Gaps are allowed; forward-filled input is not. */
  observations: readonly DailyObservation[];
  /** The session t being scored. */
  targetSession: string;
  sigmaFloor?: number;
  windowLength?: number;
}

interface HistoricalChange {
  endsAt: string;
  value: number;
}

/**
 * Builds the deterministic per-asset feature for one session.
 *
 * The current change spans t-1 -> t and the volatility window holds the
 * previous `windowLength` single-session changes ending at t-1, so the
 * observation being scored never contributes to the scale it is divided by.
 */
export function buildMacroFeature(
  input: FeatureInput,
  calendar: SessionCalendar = defaultSessionCalendar,
): MacroFeature {
  const { symbol, targetSession } = input;
  const windowLength = input.windowLength ?? DEFAULT_WINDOW_LENGTH;
  const definition = ASSET_REGISTRY[symbol];
  const kind = changeKindFor(symbol);

  if (!calendar.isSession(targetSession)) {
    throw new Error(`${targetSession} is not an expected session`);
  }
  const currentFrom = calendar.previousSession(targetSession);
  if (currentFrom === null) {
    throw new Error(`no expected session precedes ${targetSession}`);
  }

  const byDate = new Map<string, number>();
  let sawInvalid = false;
  for (const observation of input.observations) {
    if (isValidObservation(observation.value, kind)) {
      byDate.set(observation.sessionDate, observation.value);
    } else {
      sawInvalid = true;
    }
  }

  const flags = new Set<FeatureFlag>();
  if (sawInvalid) flags.add("invalidPrice");

  const previousValue = byDate.get(currentFrom);
  const currentValue = byDate.get(targetSession);

  const consecutiveSessions = previousValue !== undefined;
  if (!consecutiveSessions) flags.add("missingAdjacentSession");
  if (currentValue === undefined) flags.add("missing");

  const currentChange =
    previousValue !== undefined && currentValue !== undefined
      ? computeChange(kind, previousValue, currentValue)
      : null;

  // Walk back through expected sessions collecting single-session changes.
  // A missing session yields no change at all rather than a bridged one.
  //
  // The scan is bounded: the calendar can always name an earlier session, so a
  // short or sparse series has to terminate on the budget and be reported as
  // insufficient history rather than searching indefinitely.
  const maxSessionsScanned = windowLength * 3 + 10;
  const historical: HistoricalChange[] = [];
  let cursor: string | null = currentFrom;
  let scanned = 0;

  while (
    cursor !== null &&
    historical.length < windowLength &&
    scanned < maxSessionsScanned
  ) {
    const previousSession: string | null = calendar.previousSession(cursor);
    if (previousSession === null) break;

    const later = byDate.get(cursor);
    const earlier = byDate.get(previousSession);
    if (later !== undefined && earlier !== undefined) {
      historical.push({
        endsAt: cursor,
        value: computeChange(kind, earlier, later),
      });
    }
    cursor = previousSession;
    scanned += 1;
  }
  historical.reverse();

  const validCount = historical.length;
  if (validCount < windowLength) flags.add("insufficientHistory");

  let sigmaRaw: number | null = null;
  let sigmaUsed: number | null = null;
  let sigmaFloorApplied = false;
  let zScore: number | null = null;

  if (validCount === windowLength) {
    sigmaRaw = sigmaRawFromChanges(historical.map((h) => h.value));

    if (sigmaRaw === 0) {
      // Over half the window is identical. That is repeated or filled prints,
      // and the floor must not be used to manufacture a score from it.
      sigmaUsed = 0;
      flags.add("repeatedPrints");
      flags.add("volUnavailable");
    } else {
      const floored = applySigmaFloor(sigmaRaw, input.sigmaFloor);
      sigmaUsed = floored.sigmaUsed;
      sigmaFloorApplied = floored.floorApplied;
      if (sigmaFloorApplied) flags.add("sigmaFloorApplied");

      if (currentChange !== null) {
        zScore = zScoreOf(currentChange, sigmaUsed);
      }
    }
  } else {
    flags.add("volUnavailable");
  }

  return {
    symbol,
    instrument: definition.instrument,
    isProxy: definition.isProxy,
    unit: unitFor(symbol),
    currentChange,
    currentFrom,
    currentTo: targetSession,
    consecutiveSessions,
    window: {
      length: windowLength,
      endsAt: currentFrom,
      sessionDates: historical.map((h) => h.endsAt),
      validCount,
    },
    sigmaRaw,
    sigmaUsed,
    sigmaFloorApplied,
    zScore,
    flags: [...flags],
  };
}
