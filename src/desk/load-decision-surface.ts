import type { CatalystFeed } from "@/contracts";
import {
  DecisionSurfaceView,
  type DecisionObserveSummary,
  type DecisionResearchSection,
  type PublicPolicySlot,
} from "@/contracts/decision-surface";
import { buildMarketStructureStateV2 } from "@/gamma/structure-state-v2";
import { loadCatalystFeed, toPublicCatalystFeed } from "@/catalyst";
import { formatConfidenceScore, regimeLabel } from "./format";
import { buildDeskStance } from "./build-desk-stance";
import {
  DECISION_SURFACE_DRIVER,
  DECISION_SURFACE_EVIDENCE_BUNDLE,
  DECISION_SURFACE_EVIDENCE_FIXTURE_PATH,
  DECISION_SURFACE_FIXTURE_SESSION,
  DECISION_SURFACE_MEMO,
  DECISION_SURFACE_SOURCE_LABEL,
  PUBLIC_POLICY_UNAVAILABLE_MESSAGE,
} from "./decision-surface-fixtures";
import { loadBoundedGammaDeskView } from "./load-bounded-gamma";
import { isPublicDemoMode } from "./public-demo";

export interface LoadDecisionSurfaceOptions {
  readonly sessionDate?: string | null;
  readonly publicDemo?: boolean;
  readonly env?: NodeJS.ProcessEnv;
}

function missingDateView(publicDemo: boolean): DecisionSurfaceView {
  return DecisionSurfaceView.parse({
    kind: "DecisionSurfaceView",
    schemaVersion: "0.1.0",
    status: "missing_date",
    sessionDate: null,
    isPublicDemo: publicDemo,
    isSynthetic: true,
    sourceLabel: DECISION_SURFACE_SOURCE_LABEL,
    errorMessage:
      "Exact session date is required (?date=YYYY-MM-DD). No latest-session fallback.",
  });
}

function dateUnavailableView(
  sessionDate: string,
  publicDemo: boolean,
): DecisionSurfaceView {
  return DecisionSurfaceView.parse({
    kind: "DecisionSurfaceView",
    schemaVersion: "0.1.0",
    status: "date_unavailable",
    sessionDate,
    isPublicDemo: publicDemo,
    isSynthetic: true,
    sourceLabel: DECISION_SURFACE_SOURCE_LABEL,
    errorMessage: `No bundled decision-surface fixtures for ${sessionDate}. Available fixture session: ${DECISION_SURFACE_FIXTURE_SESSION}.`,
  });
}

function buildCatalystHeadline(feed: CatalystFeed): {
  headline: string;
  detail?: string;
} {
  const events = [...feed.catalysts].sort((a, b) =>
    a.occurredAt.localeCompare(b.occurredAt),
  );
  if (events.length === 0) {
    return { headline: "No catalyst events in the synthetic feed window." };
  }
  const released = events.filter((e) => e.status === "released").length;
  const upcoming = events.filter((e) => e.status === "upcoming").length;
  const top = events.slice(0, 2).map((e) => e.headline);
  return {
    headline: `${events.length} catalyst events (${released} released, ${upcoming} upcoming).`,
    detail: top.join(" · "),
  };
}

function buildObserveSummary(
  sessionDate: string,
  catalystFeed: CatalystFeed,
  structureSummary: DecisionObserveSummary["structureSummary"],
  structureCondition: DecisionObserveSummary["structureCondition"],
  structureUnavailableReason: string | undefined,
): DecisionObserveSummary {
  const driver = DECISION_SURFACE_DRIVER;
  const catalyst = buildCatalystHeadline(catalystFeed);
  return {
    sessionDate,
    driverRegime: regimeLabel(driver.primaryRegime),
    driverLabel: driver.label,
    confidenceDisplay: formatConfidenceScore(driver.confidence),
    driverInterpretation: driver.interpretation.text,
    catalystHeadline: catalyst.headline,
    catalystDetail: catalyst.detail,
    structureSummary,
    structureCondition,
    structureUnavailableReason,
  };
}

function buildResearchSection(): DecisionResearchSection {
  const memo = DECISION_SURFACE_MEMO;
  return {
    memoHeadline: memo.headline,
    memoStatus: memo.status,
    memoProvider: `${memo.provider}/${memo.model}`,
    bundleId: memo.bundleId,
    evidence: memo.evidence,
    inference: memo.inference,
    limitations: memo.limitations,
    unknowns: memo.unknowns,
  };
}

function buildPolicySlot(sessionDate: string): PublicPolicySlot {
  return {
    kind: "PublicPolicySlot",
    schemaVersion: "0.1.0",
    status: "unavailable",
    sessionDate,
    message: PUBLIC_POLICY_UNAVAILABLE_MESSAGE,
    synthetic: true,
  };
}

/**
 * Fixture-driven decision surface loader (M8-1).
 * Requires explicit sessionDate — no latest fallback, no network, no data/ reads.
 */
export function loadDecisionSurface(
  options: LoadDecisionSurfaceOptions = {},
): DecisionSurfaceView {
  const publicDemo = options.publicDemo ?? isPublicDemoMode(options.env);
  const sessionDate = options.sessionDate?.trim() || null;

  if (!sessionDate) {
    return missingDateView(publicDemo);
  }

  if (sessionDate !== DECISION_SURFACE_FIXTURE_SESSION) {
    return dateUnavailableView(sessionDate, publicDemo);
  }

  const catalystFeed = toPublicCatalystFeed(
    loadCatalystFeed({}, { publicDemo: true }),
  );
  const gammaView = loadBoundedGammaDeskView({ forceFixture: true });

  let structureSummary: string | undefined;
  let structureCondition: DecisionObserveSummary["structureCondition"];
  let structureUnavailableReason: string | undefined;
  let structureForStance = null;

  if (gammaView.status === "ready" && gammaView.snapshot) {
    const structure = buildMarketStructureStateV2({
      bounded: gammaView.snapshot,
    });
    structureForStance = structure;
    structureSummary = structure.interpretation.summary;
    structureCondition = structure.condition;
  } else {
    structureUnavailableReason =
      gammaView.error?.message ?? "Bounded gamma fixture unavailable.";
  }

  const observe = buildObserveSummary(
    sessionDate,
    catalystFeed,
    structureSummary,
    structureCondition,
    structureUnavailableReason,
  );

  const research = buildResearchSection();
  const policy = buildPolicySlot(sessionDate);
  const stance = buildDeskStance({
    sessionDate,
    evidenceStatus: DECISION_SURFACE_EVIDENCE_BUNDLE.evidenceStatus,
    structure: structureForStance,
  });

  const status =
    gammaView.status === "ready" ? "ready" : ("partial" as const);

  return DecisionSurfaceView.parse({
    kind: "DecisionSurfaceView",
    schemaVersion: "0.1.0",
    status,
    sessionDate,
    isPublicDemo: publicDemo,
    isSynthetic: true,
    sourceLabel: publicDemo
      ? DECISION_SURFACE_SOURCE_LABEL
      : `Synthetic fixtures · ${DECISION_SURFACE_EVIDENCE_FIXTURE_PATH}`,
    observe,
    research,
    policy,
    stance,
  });
}

export function parseDecisionSurfaceDateParam(
  value: string | string[] | undefined,
): string | undefined {
  if (value === undefined) return undefined;
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.trim() || undefined;
}
