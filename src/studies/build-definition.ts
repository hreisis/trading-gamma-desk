import {
  StudyDefinition,
  buildStudyId,
  type DailyResearchArchive,
  type StudyDefinition as StudyDefinitionDto,
} from "@/contracts";

export class StudyDefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudyDefinitionError";
  }
}

export interface BuildStudyDefinitionInput {
  readonly archive: DailyResearchArchive;
  readonly symbol: string;
  readonly archiveRelativePath: string;
  readonly builtAt: string;
  readonly synthetic?: boolean;
  readonly limitations?: readonly string[];
}

/**
 * Pure: PIT study anchor from an exact DailyResearchArchive reference.
 * Never reads or embeds forward outcomes.
 */
export function buildStudyDefinition(
  input: BuildStudyDefinitionInput,
): StudyDefinitionDto {
  const archive = input.archive;
  if (!input.symbol || input.symbol.length === 0) {
    throw new StudyDefinitionError("symbol is required");
  }

  const result: StudyDefinitionDto = {
    kind: "StudyDefinition",
    schemaVersion: "0.1.0",
    studyId: buildStudyId(archive.archiveId, input.symbol),
    archiveId: archive.archiveId,
    sessionDate: archive.sessionDate,
    symbol: input.symbol,
    archiveRef: {
      relativePath: input.archiveRelativePath,
      schemaVersion: "0.1.0",
    },
    builtAt: input.builtAt,
    methodologyId: "study_definition_v1",
    methodologyVersion: "0.1.0",
    synthetic: input.synthetic ?? true,
    limitations: input.limitations
      ? [...input.limitations]
      : [
          "StudyDefinition is a PIT anchor only — forward outcomes are separate artifacts.",
          "Never merge StudyForwardOutcome into DailyResearchArchive or ReplayCorpus inputs.",
        ],
  };

  return StudyDefinition.parse(result);
}
