import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DailyResearchArchive, type DailyResearchArchive as ArchiveDto } from "@/contracts";
import { writeJsonAtomic } from "@/desk/atomic-write";
import { deepEqualJson } from "@/gamma/deep-equal";

export class ResearchArchiveStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResearchArchiveStoreError";
  }
}

export function dailyResearchArchiveRelPath(sessionDate: string): string {
  return join("studies", "archive", sessionDate, "daily-research.json");
}

export function dailyResearchArchivePath(
  dataRoot: string,
  sessionDate: string,
): string {
  return join(dataRoot, dailyResearchArchiveRelPath(sessionDate));
}

export function readDailyResearchArchive(path: string): ArchiveDto {
  if (!existsSync(path)) {
    throw new ResearchArchiveStoreError(`archive not found: ${path}`);
  }
  return DailyResearchArchive.parse(JSON.parse(readFileSync(path, "utf8")));
}

/**
 * Validated atomic write to data/studies/archive/{date}/daily-research.json.
 * Refuses overwrite when an existing archive differs (immutable publication).
 */
export function writeDailyResearchArchive(
  path: string,
  archive: ArchiveDto,
): ArchiveDto {
  const validated = DailyResearchArchive.parse(archive);

  if (existsSync(path)) {
    const existing = DailyResearchArchive.parse(
      JSON.parse(readFileSync(path, "utf8")),
    );
    if (!deepEqualJson(existing, validated)) {
      throw new ResearchArchiveStoreError(
        `archive already exists with different payload: ${path}`,
      );
    }
    return validated;
  }

  writeJsonAtomic(path, validated);
  return validated;
}
