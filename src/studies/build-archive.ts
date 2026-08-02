import {
  DailyResearchArchive,
  buildResearchArchiveId,
  type ArchiveComponent,
  type DailyResearchArchive as DailyResearchArchiveDto,
  type ReplayCorpus as ReplayCorpusDto,
} from "@/contracts";
import { buildReplayRun, validateReplayCorpus } from "@/replay";
import { assessStudyEligibility } from "./eligibility";

export class DailyResearchArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DailyResearchArchiveError";
  }
}

export interface BuildDailyResearchArchiveInput {
  readonly sessionDate: string;
  readonly runId: string;
  readonly builtAt: string;
  readonly evaluationInstants: readonly string[];
  readonly corpus: ReplayCorpusDto;
  readonly components: {
    readonly macro: ArchiveComponent;
    readonly marketStructure: ArchiveComponent;
    readonly boundedStructure: ArchiveComponent;
    readonly catalystEvidence: readonly ArchiveComponent[];
  };
}

/**
 * Pure: assemble a contract-valid DailyResearchArchive with embedded ReplayRun.
 * Exact evaluation instants only — no latest-fallback clock.
 */
export function buildDailyResearchArchive(
  input: BuildDailyResearchArchiveInput,
): DailyResearchArchiveDto {
  const corpus = validateReplayCorpus(input.corpus);

  for (const instant of input.evaluationInstants) {
    if (!instant.startsWith(input.sessionDate)) {
      throw new DailyResearchArchiveError(
        `evaluationInstant ${instant} must fall on sessionDate ${input.sessionDate}`,
      );
    }
  }

  const eligibility = assessStudyEligibility({
    sessionDate: input.sessionDate,
    components: input.components,
  });

  const replayRun = buildReplayRun({
    corpus,
    evaluationAts: input.evaluationInstants,
    runId: input.runId,
  });

  const archive: DailyResearchArchiveDto = {
    kind: "DailyResearchArchive",
    schemaVersion: "0.1.0",
    archiveId: buildResearchArchiveId(input.sessionDate),
    sessionDate: input.sessionDate,
    builtAt: input.builtAt,
    methodologyId: "pit_research_archive_v1",
    methodologyVersion: "0.1.0",
    components: {
      macro: input.components.macro,
      marketStructure: input.components.marketStructure,
      boundedStructure: input.components.boundedStructure,
      catalystEvidence: [...input.components.catalystEvidence],
    },
    eligibility,
    evaluationInstants: [...input.evaluationInstants],
    corpus,
    replayRun,
  };

  return DailyResearchArchive.parse(archive);
}

/**
 * Deterministic offline replay verification: rebuild ReplayRun from archive corpus.
 * Returns the stored run when identical; throws on drift.
 */
export function verifyArchiveReplay(
  archive: DailyResearchArchiveDto,
): DailyResearchArchiveDto["replayRun"] {
  const parsed = DailyResearchArchive.parse(archive);
  const rebuilt = buildReplayRun({
    corpus: parsed.corpus,
    evaluationAts: parsed.evaluationInstants,
    runId: parsed.replayRun.runId,
  });
  const stored = JSON.stringify(parsed.replayRun);
  const fresh = JSON.stringify(rebuilt);
  if (stored !== fresh) {
    throw new DailyResearchArchiveError(
      "archive replayRun does not match deterministic rebuild from corpus",
    );
  }
  return parsed.replayRun;
}
