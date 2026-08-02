import type {
  ArchiveComponent,
  ArchiveComponentKind,
  StudyEligibility,
} from "@/contracts";
import {
  RESEARCH_ARCHIVE_METHODOLOGY_ID,
  RESEARCH_ARCHIVE_METHODOLOGY_VERSION,
} from "@/contracts";

const REQUIRED_KINDS: readonly ArchiveComponentKind[] = [
  "macro",
  "market_structure",
];

export const CONSERVATIVE_ELIGIBILITY_RULES = [
  "exact sessionDate required for marketStructure — no cross-day fallback",
  "macro must be available; no latest-fallback across sessions",
  "boundedStructure when present must retain bounded_single_expiry scope",
  "bounded incomplete/partial gammaAvailability downgrades to partial eligibility",
  "catalyst evidence is optional; publication time must be explicit when present",
  "evaluationInstants must fall on sessionDate — no fabricated history",
  "no returns, outcomes, regime buckets, or similarity scores in archive",
] as const;

function componentKindSatisfied(
  component: ArchiveComponent,
  sessionDate: string,
): { ok: true } | { ok: false; reason: string } {
  if (component.status !== "available") {
    return {
      ok: false,
      reason: `${component.kind} unavailable: ${component.reason}`,
    };
  }

  if (component.kind === "market_structure") {
    if (component.sessionDate !== sessionDate) {
      return {
        ok: false,
        reason: `marketStructure sessionDate ${component.sessionDate ?? "missing"} != archive sessionDate ${sessionDate}`,
      };
    }
  }

  if (component.kind === "bounded_structure") {
    if (component.scope !== "bounded_single_expiry") {
      return {
        ok: false,
        reason: `boundedStructure scope ${component.scope ?? "missing"} is not bounded_single_expiry`,
      };
    }
  }

  return { ok: true };
}

/**
 * Conservative study eligibility from resolved archive components.
 * Required: macro + exact-session marketStructure. Optional: bounded + catalyst.
 */
export function assessStudyEligibility(input: {
  readonly sessionDate: string;
  readonly components: {
    readonly macro: ArchiveComponent;
    readonly marketStructure: ArchiveComponent;
    readonly boundedStructure: ArchiveComponent;
    readonly catalystEvidence: readonly ArchiveComponent[];
  };
}): StudyEligibility {
  const satisfiedKinds: ArchiveComponentKind[] = [];
  const missingKinds: ArchiveComponentKind[] = [];
  const reasons: string[] = [];

  for (const kind of REQUIRED_KINDS) {
    const component =
      kind === "macro"
        ? input.components.macro
        : input.components.marketStructure;
    const check = componentKindSatisfied(component, input.sessionDate);
    if (check.ok) {
      satisfiedKinds.push(kind);
    } else {
      missingKinds.push(kind);
      reasons.push(check.reason);
    }
  }

  let boundedPartial = false;
  if (input.components.boundedStructure.status === "available") {
    const boundedCheck = componentKindSatisfied(
      input.components.boundedStructure,
      input.sessionDate,
    );
    if (boundedCheck.ok) {
      satisfiedKinds.push("bounded_structure");
      const availability = input.components.boundedStructure.gammaAvailability;
      if (
        availability === "incomplete" ||
        availability === "partial" ||
        availability === "unavailable"
      ) {
        boundedPartial = true;
        reasons.push(
          `boundedStructure gammaAvailability=${availability} — study partial`,
        );
      }
    } else {
      missingKinds.push("bounded_structure");
      reasons.push(boundedCheck.reason);
    }
  } else if (input.components.boundedStructure.status === "unavailable") {
    reasons.push(
      `boundedStructure optional unavailable: ${input.components.boundedStructure.reason}`,
    );
  }

  const catalystAvailable = input.components.catalystEvidence.filter(
    (c) => c.status === "available",
  );
  if (catalystAvailable.length > 0) {
    satisfiedKinds.push("catalyst_evidence");
  } else if (input.components.catalystEvidence.length > 0) {
    reasons.push("no catalyst evidence components available");
  } else {
    reasons.push("catalyst evidence not supplied — optional for eligibility");
  }

  let status: StudyEligibility["status"];
  if (missingKinds.some((k) => REQUIRED_KINDS.includes(k))) {
    status = "ineligible";
  } else if (boundedPartial || input.components.boundedStructure.status === "unavailable") {
    status = "partial";
  } else {
    status = "eligible";
  }

  return {
    status,
    methodologyId: RESEARCH_ARCHIVE_METHODOLOGY_ID,
    methodologyVersion: RESEARCH_ARCHIVE_METHODOLOGY_VERSION,
    sessionDate: input.sessionDate,
    requiredKinds: [...REQUIRED_KINDS],
    satisfiedKinds,
    missingKinds,
    reasons,
    conservativeRulesApplied: [...CONSERVATIVE_ELIGIBILITY_RULES],
  };
}
