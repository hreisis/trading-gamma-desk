import type { EvidenceStatus } from "@/contracts";
import type {
  DecisionEvidenceSummary,
  DecisionSurfaceStatus,
  DecisionSurfaceView,
  EvidenceStrengthDisplay,
} from "@/contracts/decision-surface";

export type DecisionBadgeTone =
  | "positive"
  | "mixed"
  | "negative"
  | "neutral"
  | "warn"
  | "info";

export function evidenceStatusTone(status: EvidenceStatus): DecisionBadgeTone {
  switch (status) {
    case "supported":
      return "positive";
    case "mixed":
      return "mixed";
    case "not_supported":
      return "negative";
    case "insufficient_evidence":
      return "neutral";
  }
}

export function strengthTone(strength: EvidenceStrengthDisplay): DecisionBadgeTone {
  switch (strength) {
    case "adequate":
      return "positive";
    case "preliminary":
    case "limited":
      return "warn";
    case "insufficient":
      return "neutral";
  }
}

export function decisionBadgeClass(tone: DecisionBadgeTone): string {
  return `decision-badge decision-badge-${tone}`;
}

export function horizonCoverageSummary(
  horizons: DecisionEvidenceSummary["horizons"],
): { label: string; tone: DecisionBadgeTone } {
  const rows = [horizons.d1, horizons.d5, horizons.d20];
  const available = rows.filter((row) => row.dataStatus === "available").length;
  const matureTotal = rows.reduce((sum, row) => sum + row.matureCount, 0);
  if (available === 3) {
    return { label: `Horizons 3/3 · ${matureTotal} mature samples`, tone: "positive" };
  }
  if (available === 0) {
    return { label: "Horizons 0/3 · insufficient data", tone: "neutral" };
  }
  return {
    label: `Horizons ${available}/3 · ${matureTotal} mature samples`,
    tone: "warn",
  };
}

export function integritySummary(view: DecisionSurfaceView): {
  label: string;
  tone: DecisionBadgeTone;
} {
  if (view.artifactIssues.length === 0 && view.studyIntegrityOk) {
    return { label: "Artifacts aligned", tone: "positive" };
  }
  if (!view.studyIntegrityOk) {
    return { label: "Study integrity failed", tone: "negative" };
  }
  return { label: `${view.artifactIssues.length} artifact note(s)`, tone: "warn" };
}

export function pageStatusBanner(view: DecisionSurfaceView): {
  label: string;
  tone: DecisionBadgeTone;
  detail?: string;
} | null {
  switch (view.status) {
    case "ready":
      return null;
    case "partial":
      return {
        label: "Partial session",
        tone: "warn",
        detail: "Some observe inputs are unavailable for this date.",
      };
    case "missing_date":
      return {
        label: "Session date required",
        tone: "warn",
        detail: view.errorMessage,
      };
    case "date_unavailable":
      return {
        label: "Date unavailable",
        tone: "warn",
        detail: view.errorMessage,
      };
    case "artifacts_missing":
      return {
        label: "Study artifacts missing",
        tone: "negative",
        detail: view.errorMessage,
      };
    case "integrity_failed":
      return {
        label: "Artifact integrity failed",
        tone: "negative",
        detail: view.errorMessage,
      };
  }
}

export function memoSourceShortLabel(input: {
  readonly memoStatus: string;
  readonly memoSourceLabel: string;
}): string {
  if (input.memoStatus === "abstained") return "Abstained";
  if (input.memoStatus === "unavailable") return "Unavailable";
  return input.memoSourceLabel;
}

export function isDecisionErrorStatus(status: DecisionSurfaceStatus): boolean {
  return (
    status === "artifacts_missing" ||
    status === "integrity_failed" ||
    status === "missing_date" ||
    status === "date_unavailable"
  );
}
