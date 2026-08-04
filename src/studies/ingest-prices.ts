import { join } from "node:path";
import { StudyPriceSeries, type StudyPriceSeries as StudyPriceSeriesDto } from "@/contracts";
import { writeStudyArtifact } from "./pipeline-store";
import {
  buildStudyPriceSeriesFromSpyBars,
  StudyPriceIngestError,
  studyPriceSeriesPath,
  type BuildStudyPriceSeriesInput,
} from "./build-price-series";
import { readSpyBars } from "@/ingest/spy-bars";

export interface IngestStudyPricesOptions {
  readonly asOfSessionDate: string;
  readonly dataRoot?: string;
  readonly ingestedAt?: string;
}

export interface IngestStudyPricesResult {
  readonly series: StudyPriceSeriesDto;
  readonly artifactPath: string;
  readonly barsSourcePath: string;
}

export function ingestStudyPrices(
  options: IngestStudyPricesOptions,
): IngestStudyPricesResult {
  const dataRoot = options.dataRoot ?? "data";
  const ingestedAt = options.ingestedAt ?? new Date().toISOString();
  const barsFile = readSpyBars(dataRoot);

  const series = buildStudyPriceSeriesFromSpyBars({
    barsFile,
    asOfSessionDate: options.asOfSessionDate,
    ingestedAt,
    dataRoot,
  });

  const artifactPath = studyPriceSeriesPath(
    dataRoot,
    series.symbol,
    options.asOfSessionDate,
  );

  writeStudyArtifact(artifactPath, StudyPriceSeries, series);

  return {
    series,
    artifactPath,
    barsSourcePath: join(dataRoot, "bars", "SPY.json"),
  };
}

export function parseIngestStudyPricesArgs(argv: readonly string[]): {
  asOfSessionDate: string;
  dataRoot: string;
} {
  let asOfSessionDate: string | undefined;
  let dataRoot = "data";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith("--date=")) {
      asOfSessionDate = arg.slice("--date=".length);
      continue;
    }
    if (arg === "--date") {
      asOfSessionDate = argv[++i];
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
    throw new StudyPriceIngestError(`unknown argument: ${arg}`);
  }

  if (!asOfSessionDate) {
    throw new StudyPriceIngestError(
      "--date is required (exact asOfSessionDate — no latest fallback)",
    );
  }

  return { asOfSessionDate, dataRoot };
}

export type { BuildStudyPriceSeriesInput };
