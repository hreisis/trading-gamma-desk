import {
  RealArchiveInventoryReport,
  type RealArchiveInventoryReport as ReportDto,
} from "@/contracts/real-archive";
import {
  discoverDriverCandidates,
  filterCandidatesThrough,
} from "./discover-candidates";
import { EXCLUSION, exclusionMessage } from "./exclusion-reasons";
import { resolveRealArchiveSession, toInventoryEntry } from "./resolve-session";

export class RealArchiveInventoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RealArchiveInventoryError";
  }
}

function countReasons(entries: readonly { exclusionReasons: string[] }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of entries) {
    for (const reason of entry.exclusionReasons) {
      const code = reason.split(":")[0] ?? reason;
      counts[code] = (counts[code] ?? 0) + 1;
    }
  }
  return counts;
}

export function inventoryRealArchiveSessions(input: {
  readonly throughDate: string;
  readonly dataRoot?: string;
  readonly builtAt?: string;
}): ReportDto {
  const dataRoot = input.dataRoot ?? "data";
  const builtAt = input.builtAt ?? new Date().toISOString();
  const candidates = discoverDriverCandidates(dataRoot);
  const { included, future } = filterCandidatesThrough(candidates, input.throughDate);

  const entries = included.map((candidate) =>
    toInventoryEntry(
      resolveRealArchiveSession({
        candidate,
        dataRoot,
        builtAt,
      }),
    ),
  );

  for (const f of future) {
    entries.push({
      sessionDate: f.sessionDate,
      classification: "ineligible",
      exclusionReasons: [
        exclusionMessage(
          EXCLUSION.FUTURE_SESSION,
          `after cutoff ${input.throughDate}`,
        ),
      ],
    });
  }

  entries.sort((a, b) =>
    a.sessionDate < b.sessionDate ? -1 : a.sessionDate > b.sessionDate ? 1 : 0,
  );

  const summary = {
    candidateSessions: entries.length,
    eligible: entries.filter((e) => e.classification === "eligible").length,
    partial: entries.filter((e) => e.classification === "partial").length,
    ineligible: entries.filter((e) => e.classification === "ineligible").length,
    invalid: entries.filter((e) => e.classification === "invalid").length,
    exactDateStructureSessions: entries.filter(
      (e) =>
        e.sourcesManifest?.marketStructure.status === "resolved" &&
        e.sourcesManifest.marketStructure.resolution !== undefined,
    ).length,
    catalystPitSessions: entries.filter(
      (e) => (e.sourcesManifest?.catalystEvidence.refs.length ?? 0) > 0,
    ).length,
  };

  return RealArchiveInventoryReport.parse({
    kind: "RealArchiveInventoryReport",
    schemaVersion: "0.1.0",
    throughDate: input.throughDate,
    builtAt,
    dataRoot,
    entries,
    summary,
    exclusionReasonCounts: countReasons(entries),
  });
}

export function parseInventoryArgs(argv: readonly string[]): {
  throughDate: string;
  dataRoot: string;
} {
  let throughDate: string | undefined;
  let dataRoot = "data";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith("--through=")) {
      throughDate = arg.slice("--through=".length);
      continue;
    }
    if (arg === "--through") {
      throughDate = argv[++i];
      continue;
    }
    if (arg.startsWith("--data-root=")) {
      dataRoot = arg.slice("--data-root=".length);
      continue;
    }
    if (arg === "--data-root") {
      dataRoot = argv[++i]!;
      continue;
    }
    throw new RealArchiveInventoryError(`unknown argument: ${arg}`);
  }

  if (!throughDate) {
    throw new RealArchiveInventoryError(
      "--through is required (explicit PIT cutoff — no latest fallback)",
    );
  }

  return { throughDate, dataRoot };
}
