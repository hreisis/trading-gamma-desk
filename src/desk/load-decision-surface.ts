import type { CatalystFeed, DominantDriver, StudyEvidenceBundle, StudyMemo } from "@/contracts";
import { join } from "node:path";
import {
  DecisionSurfaceView,
  type ArtifactIntegrityIssue,
  type DecisionObserveSummary,
  type DecisionResearchSection,
  type DecisionSurfaceStatus,
  type PublicPolicySlot,
} from "@/contracts/decision-surface";
import { buildMarketStructureStateV2 } from "@/gamma/structure-state-v2";
import { loadCatalystFeed, toPublicCatalystFeed } from "@/catalyst";
import { formatConfidenceScore, regimeLabel } from "./format";
import { buildDeskStance } from "./build-desk-stance";
import {
  buildDecisionEvidenceSummary,
  memoProvenanceLabel,
} from "./decision-evidence-display";
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
import { loadDecisionArtifacts } from "./load-decision-artifacts";
import { loadSessionBoundedGamma } from "./load-session-bounded-gamma";
import { loadSessionDriver } from "./load-session-driver";
import { isPublicDemoMode } from "./public-demo";

export interface LoadDecisionSurfaceOptions {
  readonly sessionDate?: string | null;
  readonly publicDemo?: boolean;
  readonly env?: NodeJS.ProcessEnv;
  readonly dataRoot?: string;
  readonly symbol?: string;
}

function baseViewFields(publicDemo: boolean, isSynthetic: boolean) {
  return {
    kind: "DecisionSurfaceView" as const,
    schemaVersion: "0.2.0" as const,
    isPublicDemo: publicDemo,
    isSynthetic,
    artifactIssues: [] as ArtifactIntegrityIssue[],
    studyIntegrityOk: false,
  };
}

function missingDateView(publicDemo: boolean): DecisionSurfaceView {
  return DecisionSurfaceView.parse({
    ...baseViewFields(publicDemo, true),
    status: "missing_date",
    sessionDate: null,
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
    ...baseViewFields(publicDemo, true),
    status: "date_unavailable",
    sessionDate,
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
    return { headline: "No catalyst events in the feed window." };
  }
  const released = events.filter((e) => e.status === "released").length;
  const upcoming = events.filter((e) => e.status === "upcoming").length;
  const top = events.slice(0, 2).map((e) => e.headline);
  return {
    headline: `${events.length} catalyst events (${released} released, ${upcoming} upcoming).`,
    detail: top.join(" · "),
  };
}

function buildObserveSummary(input: {
  readonly sessionDate: string;
  readonly driver: DominantDriver;
  readonly catalystFeed: CatalystFeed;
  readonly structureSummary?: string;
  readonly structureCondition?: DecisionObserveSummary["structureCondition"];
  readonly structureUnavailableReason?: string;
}): DecisionObserveSummary {
  const catalyst = buildCatalystHeadline(input.catalystFeed);
  return {
    sessionDate: input.sessionDate,
    driverRegime: regimeLabel(input.driver.primaryRegime),
    driverLabel: input.driver.label,
    confidenceDisplay: formatConfidenceScore(input.driver.confidence),
    driverInterpretation: input.driver.interpretation.text,
    catalystHeadline: catalyst.headline,
    catalystDetail: catalyst.detail,
    structureSummary: input.structureSummary,
    structureCondition: input.structureCondition,
    structureUnavailableReason: input.structureUnavailableReason,
  };
}

function buildResearchSection(input: {
  readonly bundle: StudyEvidenceBundle;
  readonly memo: StudyMemo | null;
  readonly pipelineMemoSource?: string | null;
}): DecisionResearchSection {
  const evidenceSummary = buildDecisionEvidenceSummary(input.bundle);

  if (!input.memo) {
    return {
      evidenceSummary,
      memoHeadline: "Study memo unavailable",
      memoStatus: "unavailable",
      memoStatusLabel: "unavailable",
      memoSourceLabel: "Rule-based fallback",
      memoProvenanceLabel: "unavailable · Rule-based fallback · —/—",
      memoProvider: "—",
      memoModel: "—",
      bundleId: input.bundle.bundleId,
      evidence: [],
      inference: [],
      limitations: [],
      unknowns: [],
    };
  }

  const prov = memoProvenanceLabel({
    memoStatus: input.memo.status,
    provider: input.memo.provider,
    model: input.memo.model,
    pipelineMemoSource: input.pipelineMemoSource,
  });

  return {
    evidenceSummary,
    memoHeadline: input.memo.headline,
    memoStatus: input.memo.status,
    memoStatusLabel: prov.statusLabel,
    memoSourceLabel: prov.sourceLabel,
    memoProvenanceLabel: prov.combinedLabel,
    memoProvider: input.memo.provider,
    memoModel: input.memo.model,
    bundleId: input.memo.bundleId,
    evidence: input.memo.evidence,
    inference: input.memo.inference,
    limitations: input.memo.limitations,
    unknowns: input.memo.unknowns,
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

function hasStudyArtifactMissing(issues: readonly ArtifactIntegrityIssue[]): boolean {
  return issues.some(
    (i) =>
      (i.artifact === "evidence_bundle" || i.artifact === "study_memo") &&
      i.severity === "missing",
  );
}

function hasStudyArtifactIntegrityFailure(
  issues: readonly ArtifactIntegrityIssue[],
): boolean {
  const studyArtifacts = new Set(["evidence_bundle", "study_memo"]);
  return issues.some(
    (i) =>
      studyArtifacts.has(i.artifact) &&
      (i.severity === "invalid" || i.severity === "mismatched"),
  );
}

function resolveNonDemoStatus(input: {
  readonly issues: readonly ArtifactIntegrityIssue[];
  readonly studyIntegrityOk: boolean;
  readonly driverPresent: boolean;
  readonly structureReady: boolean;
}): DecisionSurfaceStatus {
  if (hasStudyArtifactMissing(input.issues)) return "artifacts_missing";
  if (
    hasStudyArtifactIntegrityFailure(input.issues) ||
    !input.studyIntegrityOk
  ) {
    return "integrity_failed";
  }
  if (!input.driverPresent || !input.structureReady) return "partial";
  return "ready";
}

function loadDemoDecisionSurface(
  sessionDate: string,
  publicDemo: boolean,
): DecisionSurfaceView {
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

  const observe = buildObserveSummary({
    sessionDate,
    driver: DECISION_SURFACE_DRIVER,
    catalystFeed,
    structureSummary,
    structureCondition,
    structureUnavailableReason,
  });

  const research = buildResearchSection({
    bundle: DECISION_SURFACE_EVIDENCE_BUNDLE,
    memo: DECISION_SURFACE_MEMO,
    pipelineMemoSource: "rule_based_fallback",
  });

  const policy = buildPolicySlot(sessionDate);
  const stance = buildDeskStance({
    sessionDate,
    evidenceStatus: DECISION_SURFACE_EVIDENCE_BUNDLE.evidenceStatus,
    structure: structureForStance,
  });

  const status: DecisionSurfaceStatus =
    gammaView.status === "ready" ? "ready" : "partial";

  return DecisionSurfaceView.parse({
    ...baseViewFields(publicDemo, true),
    status,
    sessionDate,
    sourceLabel: publicDemo
      ? DECISION_SURFACE_SOURCE_LABEL
      : `Synthetic fixtures · ${DECISION_SURFACE_EVIDENCE_FIXTURE_PATH}`,
    studyIntegrityOk: true,
    observe,
    research,
    policy,
    stance,
  });
}

function loadLiveDecisionSurface(input: {
  readonly sessionDate: string;
  readonly publicDemo: boolean;
  readonly dataRoot: string;
  readonly symbol: string;
}): DecisionSurfaceView {
  const { sessionDate, publicDemo, dataRoot, symbol } = input;
  const issues: ArtifactIntegrityIssue[] = [];

  const driverLoad = loadSessionDriver(sessionDate, dataRoot);
  issues.push(...driverLoad.issues);

  const artifacts = loadDecisionArtifacts({ sessionDate, symbol, dataRoot });
  issues.push(...artifacts.issues);

  const gammaLoad = loadSessionBoundedGamma({
    sessionDate,
    symbol,
    dataRoot: boundedGammaDataRoot(dataRoot),
  });
  issues.push(...gammaLoad.issues);

  const catalystFeed = toPublicCatalystFeed(
    loadCatalystFeed({}, { publicDemo: false, dataRoot }),
  );

  let structureSummary: string | undefined;
  let structureCondition: DecisionObserveSummary["structureCondition"];
  let structureUnavailableReason: string | undefined;
  let structureForStance = null;
  const structureReady =
    gammaLoad.snapshot !== null &&
    gammaLoad.snapshot.sessionDate === sessionDate &&
    gammaLoad.snapshot.status !== "unavailable";

  if (structureReady && gammaLoad.snapshot) {
    const structure = buildMarketStructureStateV2({
      bounded: gammaLoad.snapshot,
    });
    structureForStance = structure;
    structureSummary = structure.interpretation.summary;
    structureCondition = structure.condition;
  } else if (gammaLoad.snapshot) {
    structureUnavailableReason =
      "Bounded gamma snapshot does not align with requested session date.";
  } else {
    const structureIssue = issues.find((i) => i.artifact === "structure");
    structureUnavailableReason =
      structureIssue?.message ?? "Bounded structure unavailable for this session.";
  }

  const observe = driverLoad.driver
    ? buildObserveSummary({
        sessionDate,
        driver: driverLoad.driver,
        catalystFeed,
        structureSummary,
        structureCondition,
        structureUnavailableReason,
      })
    : undefined;

  const research = artifacts.bundle
    ? buildResearchSection({
        bundle: artifacts.bundle,
        memo: artifacts.memo,
        pipelineMemoSource: artifacts.pipelineRun?.memoSource,
      })
    : undefined;

  const policy = buildPolicySlot(sessionDate);

  const stance =
    artifacts.studyIntegrityOk && artifacts.bundle
      ? buildDeskStance({
          sessionDate,
          evidenceStatus: artifacts.bundle.evidenceStatus,
          structure: structureForStance,
        })
      : undefined;

  const status = resolveNonDemoStatus({
    issues,
    studyIntegrityOk: artifacts.studyIntegrityOk,
    driverPresent: driverLoad.driver !== null,
    structureReady,
  });

  const errorMessage =
    status === "artifacts_missing"
      ? `Study artifacts missing for ${sessionDate}. Exact-date alignment required — no latest or fixture fallback.`
      : status === "integrity_failed"
        ? `Study artifact integrity failed for ${sessionDate}. Review artifact issues below.`
        : undefined;

  return DecisionSurfaceView.parse({
    ...baseViewFields(publicDemo, false),
    status,
    sessionDate,
    sourceLabel: `Local study artifacts · ${dataRoot}`,
    errorMessage,
    artifactIssues: issues,
    studyIntegrityOk: artifacts.studyIntegrityOk,
    observe,
    research,
    policy,
    stance,
  });
}

function boundedGammaDataRoot(dataRoot: string): string {
  return join(dataRoot, "gamma", "providers", "marketdata-app");
}

/**
 * Decision surface loader (M8-1 demo fixtures · M8-2 exact-date study artifacts).
 * Requires explicit sessionDate — no latest fallback. Page render never calls OpenAI.
 */
export function loadDecisionSurface(
  options: LoadDecisionSurfaceOptions = {},
): DecisionSurfaceView {
  const publicDemo = options.publicDemo ?? isPublicDemoMode(options.env);
  const sessionDate = options.sessionDate?.trim() || null;

  if (!sessionDate) {
    return missingDateView(publicDemo);
  }

  if (publicDemo) {
    if (sessionDate !== DECISION_SURFACE_FIXTURE_SESSION) {
      return dateUnavailableView(sessionDate, publicDemo);
    }
    return loadDemoDecisionSurface(sessionDate, publicDemo);
  }

  const dataRoot = options.dataRoot ?? "data";
  const symbol = options.symbol ?? "SPY";
  return loadLiveDecisionSurface({
    sessionDate,
    publicDemo,
    dataRoot,
    symbol,
  });
}

export function parseDecisionSurfaceDateParam(
  value: string | string[] | undefined,
): string | undefined {
  if (value === undefined) return undefined;
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.trim() || undefined;
}
