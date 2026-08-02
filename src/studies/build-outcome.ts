import {
  ForwardHorizon,
  HORIZON_SESSIONS,
  StudyForwardOutcome,
  StudyPriceSeries,
  buildOutcomeId,
  type HorizonMaturity,
  type MfeMaeOutcome,
  type OutcomeNumeric,
  type StudyDefinition,
  type StudyForwardOutcome as StudyForwardOutcomeDto,
  type StudyPriceSeries as StudyPriceSeriesDto,
} from "@/contracts";
import {
  StudySessionError,
  buildSessionCalendar,
  forwardSessionDate,
  forwardSessionsAvailable,
  sessionIndex,
} from "./sessions";

export class StudyOutcomeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudyOutcomeError";
  }
}

const HORIZONS: readonly ForwardHorizon[] = ["1D", "5D", "20D"];

function truncateCalendar(
  calendar: ReturnType<typeof buildSessionCalendar>,
  asOfSessionDate: string,
) {
  const asOfIdx = sessionIndex(calendar, asOfSessionDate);
  if (asOfIdx === null) {
    throw new StudyOutcomeError(
      `priceSeriesAsOfSessionDate ${asOfSessionDate} not in price series — no latest-fallback`,
    );
  }
  return {
    sessionDates: calendar.sessionDates.slice(0, asOfIdx + 1),
    adjCloseByDate: new Map(
      calendar.sessionDates
        .slice(0, asOfIdx + 1)
        .map((d) => [d, calendar.adjCloseByDate.get(d)!] as const),
    ),
  };
}

function computeMaturity(
  calendar: ReturnType<typeof buildSessionCalendar>,
  entrySessionDate: string,
  asOfSessionDate: string,
): HorizonMaturity[] {
  const available = forwardSessionsAvailable(
    calendar,
    entrySessionDate,
    asOfSessionDate,
  );
  const entryIdx = sessionIndex(calendar, entrySessionDate);

  return HORIZONS.map((horizon) => {
    const required = HORIZON_SESSIONS[horizon];
    if (entryIdx === null) {
      return {
        horizon,
        requiredSessions: required,
        sessionsAvailable: 0,
        status: "unavailable" as const,
        reason: `entry sessionDate ${entrySessionDate} not in truncated price series`,
      };
    }
    const exitDate = forwardSessionDate(
      calendar,
      entrySessionDate,
      required,
    );
    if (exitDate === null || available < required) {
      return {
        horizon,
        requiredSessions: required,
        sessionsAvailable: available,
        status: "immature" as const,
        reason: `need ${required} forward session(s); have ${available} through ${asOfSessionDate}`,
      };
    }
    return {
      horizon,
      requiredSessions: required,
      sessionsAvailable: available,
      status: "mature" as const,
      exitSessionDate: exitDate,
    };
  });
}

function computeReturn(
  calendar: ReturnType<typeof buildSessionCalendar>,
  entrySessionDate: string,
  horizonSessions: number,
  maturity: HorizonMaturity,
): OutcomeNumeric {
  if (maturity.status !== "mature" || !maturity.exitSessionDate) {
    return {
      status: "unavailable",
      reason: maturity.reason ?? `horizon ${horizonSessions}D immature`,
    };
  }
  const entryAdjClose = calendar.adjCloseByDate.get(entrySessionDate);
  const exitAdjClose = calendar.adjCloseByDate.get(maturity.exitSessionDate);
  if (entryAdjClose === undefined || exitAdjClose === undefined) {
    return {
      status: "unavailable",
      reason: "entry or exit adjClose missing in truncated series",
    };
  }
  return {
    status: "available",
    value: exitAdjClose / entryAdjClose - 1,
    entryPrice: entryAdjClose,
    exitPrice: exitAdjClose,
    entrySessionDate,
    exitSessionDate: maturity.exitSessionDate,
    horizonSessions,
  };
}

function computeExcursion(
  calendar: ReturnType<typeof buildSessionCalendar>,
  entrySessionDate: string,
  horizonSessions: number,
  maturity: HorizonMaturity,
): MfeMaeOutcome {
  if (maturity.status !== "mature" || !maturity.exitSessionDate) {
    return {
      status: "unavailable",
      reason: maturity.reason ?? `horizon ${horizonSessions}D immature`,
    };
  }
  const entryIdx = sessionIndex(calendar, entrySessionDate);
  const exitIdx = sessionIndex(calendar, maturity.exitSessionDate);
  if (entryIdx === null || exitIdx === null) {
    return {
      status: "unavailable",
      reason: "entry or exit session missing",
    };
  }
  const entryAdjClose = calendar.adjCloseByDate.get(entrySessionDate)!;
  let mfe = -Infinity;
  let mae = Infinity;
  let observed = 0;

  for (let i = entryIdx + 1; i <= exitIdx; i++) {
    const date = calendar.sessionDates[i]!;
    const adjClose = calendar.adjCloseByDate.get(date)!;
    const rel = adjClose / entryAdjClose - 1;
    if (rel > mfe) mfe = rel;
    if (rel < mae) mae = rel;
    observed++;
  }

  if (observed === 0) {
    return {
      status: "unavailable",
      reason: "no forward sessions in excursion window",
    };
  }

  return {
    status: "available",
    mfe,
    mae,
    entrySessionDate,
    windowEndSessionDate: maturity.exitSessionDate,
    sessionsObserved: observed,
  };
}

export interface BuildStudyForwardOutcomeInput {
  readonly definition: StudyDefinition;
  readonly priceSeries: StudyPriceSeriesDto;
  readonly priceSeriesAsOfSessionDate: string;
  readonly computedAt: string;
  readonly priceSourceKind?: "fixture" | "local_store";
  readonly priceRelativePath: string;
  readonly limitations?: readonly string[];
}

/**
 * Pure: forward outcomes from definition + truncated price series.
 * Never reads PIT archive payloads beyond the definition anchor.
 * Future data capped at priceSeriesAsOfSessionDate — no lookahead beyond explicit asOf.
 */
export function buildStudyForwardOutcome(
  input: BuildStudyForwardOutcomeInput,
): StudyForwardOutcomeDto {
  const definition = input.definition;
  const parsedSeries = StudyPriceSeries.parse(input.priceSeries);

  if (parsedSeries.symbol !== definition.symbol) {
    throw new StudyOutcomeError(
      `price series symbol ${parsedSeries.symbol} != definition symbol ${definition.symbol}`,
    );
  }

  if (definition.sessionDate > input.priceSeriesAsOfSessionDate) {
    throw new StudyOutcomeError(
      "entry sessionDate after priceSeriesAsOfSessionDate — lookahead/leakage rejected",
    );
  }

  const fullCalendar = buildSessionCalendar(parsedSeries.bars);
  const calendar = truncateCalendar(fullCalendar, input.priceSeriesAsOfSessionDate);

  const maturity = computeMaturity(
    calendar,
    definition.sessionDate,
    input.priceSeriesAsOfSessionDate,
  );

  const byHorizon = Object.fromEntries(
    maturity.map((m) => [m.horizon, m]),
  ) as Record<ForwardHorizon, HorizonMaturity>;

  const result: StudyForwardOutcomeDto = {
    kind: "StudyForwardOutcome",
    schemaVersion: "0.1.0",
    outcomeId: buildOutcomeId(
      definition.studyId,
      input.priceSeriesAsOfSessionDate,
    ),
    studyId: definition.studyId,
    archiveId: definition.archiveId,
    sessionDate: definition.sessionDate,
    symbol: definition.symbol,
    priceSeriesAsOfSessionDate: input.priceSeriesAsOfSessionDate,
    methodologyId: "forward_outcome_v1",
    methodologyVersion: "0.1.0",
    computedAt: input.computedAt,
    provenance: {
      priceSourceKind: input.priceSourceKind ?? "fixture",
      relativePath: input.priceRelativePath,
      instrument: parsedSeries.instrument,
      synthetic: parsedSeries.synthetic,
    },
    maturity,
    returns: {
      d1: computeReturn(
        calendar,
        definition.sessionDate,
        HORIZON_SESSIONS["1D"],
        byHorizon["1D"],
      ),
      d5: computeReturn(
        calendar,
        definition.sessionDate,
        HORIZON_SESSIONS["5D"],
        byHorizon["5D"],
      ),
      d20: computeReturn(
        calendar,
        definition.sessionDate,
        HORIZON_SESSIONS["20D"],
        byHorizon["20D"],
      ),
    },
    excursion: {
      d1: computeExcursion(
        calendar,
        definition.sessionDate,
        HORIZON_SESSIONS["1D"],
        byHorizon["1D"],
      ),
      d5: computeExcursion(
        calendar,
        definition.sessionDate,
        HORIZON_SESSIONS["5D"],
        byHorizon["5D"],
      ),
      d20: computeExcursion(
        calendar,
        definition.sessionDate,
        HORIZON_SESSIONS["20D"],
        byHorizon["20D"],
      ),
    },
    limitations: input.limitations
      ? [...input.limitations]
      : [
          "Forward outcomes are separate from PIT archives — never merge into replay inputs.",
          "Returns and MFE/MAE use adjClose throughout; sparse session calendar skips weekends/holidays.",
          "Immature horizons remain explicit unavailable — never fabricated.",
        ],
    pitIsolation: true,
  };

  return StudyForwardOutcome.parse(result);
}

/** Guard: reject calendars that would leak future data relative to archive session. */
export function assertNoForwardLeakage(input: {
  readonly archiveSessionDate: string;
  readonly priceSeriesAsOfSessionDate: string;
  readonly computedAt: string;
}): void {
  if (input.archiveSessionDate > input.priceSeriesAsOfSessionDate) {
    throw new StudySessionError(
      "archive sessionDate after price asOf — invalid outcome build",
    );
  }
}
