import {
  CONTRACT_SCHEMA_VERSION,
  DominantDriver,
  type DominantDriver as DominantDriverType,
} from "@/contracts";
import type { MacroSnapshot } from "@/ingest";
import {
  buildAssetObservations,
  buildEvidence,
  contradictionIds,
} from "./evidence";
import { renderTemplateInterpretation } from "./template";

/**
 * Lift a compute snapshot into a contract-valid DominantDriver.
 *
 * Hard rules for M1-8:
 * - Consume the snapshot only — no ingest, no re-scoring.
 * - Copy `confidence` verbatim from the classification.
 * - Generate prose with the template generator only (no LLM on this path).
 */
export function interpretSnapshot(
  snapshot: MacroSnapshot,
): DominantDriverType {
  if (snapshot.kind !== "MacroComputeSnapshot") {
    throw new Error("interpretSnapshot expects a MacroComputeSnapshot");
  }

  const { classification } = snapshot;
  const evidence = buildEvidence(snapshot);
  if (evidence.length === 0) {
    throw new Error(
      "cannot interpret a snapshot with no printable evidence rows",
    );
  }

  const interpretation = renderTemplateInterpretation(snapshot, evidence);
  const assets = buildAssetObservations(snapshot);
  const contradictions = contradictionIds(
    evidence,
    classification.contributions,
  );

  // Deep-clone confidence so later mutation of the driver cannot rewrite the
  // snapshot's score object by reference.
  const confidence = structuredClone(classification.confidence);

  const driver: DominantDriverType = {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    marketSessionDate: snapshot.marketSessionDate,
    generatedAt: snapshot.generatedAt,
    sessionAlignment: snapshot.sessionAlignment,
    isCompleteSession: snapshot.isCompleteSession,
    sourceDateByAsset: { ...snapshot.sourceDateByAsset },
    staleDaysByAsset: { ...snapshot.staleDaysByAsset },
    primaryRegime: classification.primaryRegime,
    polarity: classification.polarity,
    riskDirection: classification.riskDirection,
    label: classification.label,
    confidence,
    evidence,
    contradictions,
    assets,
    interpretation,
    methodology: {
      methodologyVersion: snapshot.methodology.methodologyVersion,
      signatureVersion: snapshot.methodology.signatureVersion,
      window: snapshot.methodology.window,
      excludesCurrentObservation: true,
      muAssumption: "zero",
      sigmaEstimator: "mad_about_zero_x1.4826",
      cosineRenormalizedOnObservedDims: true,
    },
  };

  return DominantDriver.parse(driver);
}
