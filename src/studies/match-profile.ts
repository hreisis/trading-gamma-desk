import type {
  DailyResearchArchive,
  MatchFieldValue,
  StudyMatchFactorKey,
  StudyMatchProfile,
} from "@/contracts";
import {
  StudyMatchProfile as StudyMatchProfileSchema,
  type ReplayMacroArtifact,
  type ReplayStructureArtifact,
} from "@/contracts";

export class StudyMatchProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudyMatchProfileError";
  }
}

export interface StudyMatchEnrichment {
  /** Explicit gamma regime from MarketStructureState or bounded interpretation — PIT only. */
  readonly gammaRegime?: string | null;
}

function available(value: string): MatchFieldValue {
  return { status: "available", value };
}

function unavailable(reason: string): MatchFieldValue {
  return { status: "unavailable", reason };
}

function lookupMacro(
  archive: DailyResearchArchive,
  artifactId: string,
): ReplayMacroArtifact | null {
  return (
    archive.corpus.macro.find((a) => a.artifactId === artifactId) ?? null
  );
}

function lookupStructure(
  archive: DailyResearchArchive,
  snapshotId: string,
): ReplayStructureArtifact | null {
  return (
    archive.corpus.marketStructure.find((a) => a.snapshotId === snapshotId) ??
    null
  );
}

function catalystIds(archive: DailyResearchArchive): MatchFieldValue {
  const ids = archive.components.catalystEvidence
    .filter((c) => c.status === "available")
    .map((c) => c.catalystId!)
    .filter(Boolean)
    .sort();
  if (ids.length === 0) {
    return unavailable("no catalyst evidence components available");
  }
  return available(ids.join("|"));
}

/**
 * Extract explicit PIT match fields from archive components + corpus metadata.
 * Never reads forward outcomes.
 */
export function buildStudyMatchProfile(input: {
  readonly studyId: string;
  readonly sessionDate: string;
  readonly archive: DailyResearchArchive;
  readonly enrichment?: StudyMatchEnrichment;
}): StudyMatchProfile {
  const { archive } = input;
  const fields: Partial<Record<StudyMatchFactorKey, MatchFieldValue>> = {};

  const macro = archive.components.macro;
  if (macro.status === "available") {
    const artifact = lookupMacro(archive, macro.provenance.artifactId);
    fields.macro_regime = artifact
      ? available(artifact.status)
      : unavailable(
          `macro artifact ${macro.provenance.artifactId} not in embedded corpus`,
        );
  } else {
    fields.macro_regime = unavailable(macro.reason);
  }

  const structure = archive.components.marketStructure;
  if (structure.status === "available" && structure.snapshotId) {
    const artifact = lookupStructure(archive, structure.snapshotId);
    fields.structure_status = artifact
      ? available(artifact.status)
      : unavailable(
          `structure snapshot ${structure.snapshotId} not in embedded corpus`,
        );
  } else if (structure.status === "available") {
    fields.structure_status = unavailable("marketStructure snapshotId missing");
  } else {
    fields.structure_status = unavailable(structure.reason);
  }

  if (input.enrichment?.gammaRegime) {
    fields.gamma_regime = available(input.enrichment.gammaRegime);
  } else {
    fields.gamma_regime = unavailable(
      "gamma_regime requires explicit PIT enrichment (e.g. MarketStructureState.current.gammaRegime)",
    );
  }

  const bounded = archive.components.boundedStructure;
  if (bounded.status === "available") {
    fields.bounded_gamma_availability = bounded.gammaAvailability
      ? available(bounded.gammaAvailability)
      : unavailable("bounded gammaAvailability missing");
    fields.bounded_scope = bounded.scope
      ? available(bounded.scope)
      : unavailable("bounded scope missing");
  } else {
    fields.bounded_gamma_availability = unavailable(bounded.reason);
    fields.bounded_scope = unavailable(bounded.reason);
  }

  fields.catalyst_ids = catalystIds(archive);

  const profile: StudyMatchProfile = {
    kind: "StudyMatchProfile",
    schemaVersion: "0.1.0",
    studyId: input.studyId,
    sessionDate: input.sessionDate,
    fields: fields as Record<StudyMatchFactorKey, MatchFieldValue>,
  };

  return StudyMatchProfileSchema.parse(profile);
}

export function matchFieldEquals(
  query: MatchFieldValue,
  candidate: MatchFieldValue,
): { ok: true } | { ok: false; reason: string } {
  if (query.status === "unavailable") {
    return {
      ok: false,
      reason: `query field unavailable: ${query.reason}`,
    };
  }
  if (candidate.status === "unavailable") {
    return {
      ok: false,
      reason: `candidate field unavailable: ${candidate.reason}`,
    };
  }
  if (query.value !== candidate.value) {
    return {
      ok: false,
      reason: `value mismatch: query=${query.value} candidate=${candidate.value}`,
    };
  }
  return { ok: true };
}
