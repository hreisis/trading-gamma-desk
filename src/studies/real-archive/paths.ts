import { join } from "node:path";
import { realArchivePeerCorpusRelPath } from "@/contracts/real-archive";
import { dailyResearchArchiveRelPath } from "../archive-store";

export function realArchivePeerCorpusPath(
  dataRoot: string,
  throughDate: string,
): string {
  return join(dataRoot, realArchivePeerCorpusRelPath(throughDate));
}

export function driverRelPath(sessionDate: string): string {
  return join("drivers", `${sessionDate}.json`);
}

export function boundedGammaRelPath(symbol: string): string {
  return join(
    "gamma",
    "providers",
    "marketdata-app",
    `${symbol.toUpperCase()}-bounded-latest.json`,
  );
}

export function catalystCalendarRelPath(): string {
  return join("catalyst", "calendar-latest.json");
}

export function catalystResultsRelPath(): string {
  return join("catalyst", "results-latest.json");
}

export { dailyResearchArchiveRelPath };
