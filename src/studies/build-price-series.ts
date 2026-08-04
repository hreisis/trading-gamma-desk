import { join } from "node:path";
import {
  STUDY_PRICE_SERIES_SCHEMA_VERSION,
  StudyPriceSeries,
  type StudyPriceBar,
  type StudyPriceSeries as StudyPriceSeriesDto,
} from "@/contracts";
import {
  SPY_INSTRUMENT,
  SPY_SYMBOL,
  SPY_VENDOR_SOURCE,
  type SpyBarSeries,
  spyBarsRelPath,
} from "@/ingest/spy-bars";
import type { RawBar } from "@/ingest/types";

export class StudyPriceIngestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudyPriceIngestError";
  }
}

export function studyPriceSeriesRelPath(
  symbol: string,
  asOfSessionDate: string,
): string {
  return join(
    "studies",
    "prices",
    symbol,
    asOfSessionDate,
    "price-series.json",
  );
}

export function studyPriceSeriesPath(
  dataRoot: string,
  symbol: string,
  asOfSessionDate: string,
): string {
  return join(dataRoot, studyPriceSeriesRelPath(symbol, asOfSessionDate));
}

/** Validate and map raw SPY bars into StudyPriceBar rows. */
export function normalizeSpyBarsToStudyBars(
  bars: readonly RawBar[],
): StudyPriceBar[] {
  const seen = new Set<string>();
  const out: StudyPriceBar[] = [];

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i]!;
    if (seen.has(bar.sessionDate)) {
      throw new StudyPriceIngestError(
        `duplicate sessionDate ${bar.sessionDate} in SPY bars`,
      );
    }
    seen.add(bar.sessionDate);
    if (i > 0 && bars[i - 1]!.sessionDate >= bar.sessionDate) {
      throw new StudyPriceIngestError(
        "SPY bars must be strictly increasing by sessionDate",
      );
    }
    if (!Number.isFinite(bar.value) || bar.value <= 0) {
      throw new StudyPriceIngestError(
        `invalid adjClose at ${bar.sessionDate}: ${bar.value}`,
      );
    }
    out.push({ sessionDate: bar.sessionDate, adjClose: bar.value });
  }

  return out;
}

function truncateBarsAtAsOf(
  bars: readonly StudyPriceBar[],
  asOfSessionDate: string,
): StudyPriceBar[] {
  const idx = bars.findIndex((b) => b.sessionDate === asOfSessionDate);
  if (idx === -1) {
    throw new StudyPriceIngestError(
      `asOfSessionDate ${asOfSessionDate} not in SPY bars — no latest-fallback`,
    );
  }
  const truncated = bars.slice(0, idx + 1);
  const last = truncated[truncated.length - 1]!;
  if (last.sessionDate !== asOfSessionDate) {
    throw new StudyPriceIngestError(
      `truncation failed: last bar ${last.sessionDate} != asOf ${asOfSessionDate}`,
    );
  }
  return truncated;
}

export interface BuildStudyPriceSeriesInput {
  readonly barsFile: SpyBarSeries;
  readonly asOfSessionDate: string;
  readonly ingestedAt: string;
  readonly dataRoot?: string;
}

/**
 * Build a PIT-truncated StudyPriceSeries from cached SPY bars.
 * Rejects fixture/synthetic inputs, future bars, and missing exact-date coverage.
 */
export function buildStudyPriceSeriesFromSpyBars(
  input: BuildStudyPriceSeriesInput,
): StudyPriceSeriesDto {
  const { barsFile, asOfSessionDate, ingestedAt } = input;
  const dataRoot = input.dataRoot ?? "data";

  if (barsFile.symbol !== SPY_SYMBOL) {
    throw new StudyPriceIngestError(
      `expected SPY bars, got symbol ${barsFile.symbol}`,
    );
  }
  if (barsFile.source.startsWith("fixtures/")) {
    throw new StudyPriceIngestError(
      "fixture-backed SPY bars rejected for real price-series build",
    );
  }

  const eligible = barsFile.bars.filter(
    (b) => b.sessionDate <= asOfSessionDate,
  );
  if (eligible.length === 0) {
    throw new StudyPriceIngestError(
      `no SPY bars on or before asOfSessionDate ${asOfSessionDate}`,
    );
  }

  const normalized = normalizeSpyBarsToStudyBars(eligible);
  const truncated = truncateBarsAtAsOf(normalized, asOfSessionDate);
  const firstSessionDate = truncated[0]!.sessionDate;
  const lastSessionDate = truncated[truncated.length - 1]!.sessionDate;

  const artifact: StudyPriceSeriesDto = {
    kind: "StudyPriceSeries",
    schemaVersion: STUDY_PRICE_SERIES_SCHEMA_VERSION,
    symbol: SPY_SYMBOL,
    instrument: SPY_INSTRUMENT,
    source: SPY_VENDOR_SOURCE,
    synthetic: false,
    bars: truncated,
    provenance: {
      sourceKind: "local_store",
      asOfSessionDate,
      ingestedAt,
      firstSessionDate,
      lastSessionDate,
      barCount: truncated.length,
      sourceArtifactRef: {
        relativePath: spyBarsRelPath(),
        vendor: barsFile.source,
      },
    },
  };

  return StudyPriceSeries.parse(artifact);
}

export function resolvePriceSourceKind(
  series: StudyPriceSeriesDto,
  relativePath: string,
): "fixture" | "local_store" {
  if (series.synthetic) {
    if (series.provenance?.sourceKind === "local_store") {
      throw new StudyPriceIngestError(
        "synthetic price series cannot claim local_store provenance",
      );
    }
    return "fixture";
  }

  if (relativePath.startsWith("fixtures/")) {
    throw new StudyPriceIngestError(
      `non-synthetic price series cannot use fixture path: ${relativePath}`,
    );
  }

  if (series.provenance?.sourceKind !== "local_store") {
    throw new StudyPriceIngestError(
      "non-synthetic price series requires provenance.sourceKind local_store",
    );
  }

  return "local_store";
}

export function assertPriceSeriesAsOfMatch(
  series: StudyPriceSeriesDto,
  expectedAsOf: string,
): void {
  if (!series.synthetic && series.provenance?.asOfSessionDate !== expectedAsOf) {
    throw new StudyPriceIngestError(
      `price series provenance asOf ${series.provenance?.asOfSessionDate} != manifest asOf ${expectedAsOf}`,
    );
  }
}
