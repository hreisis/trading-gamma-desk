import type { CatalystReleaseFamily } from "@/contracts";

export type BlsSeriesTransformation = "level" | "mom-change" | "yoy-change";

/**
 * Explicit BLS Public Data API series registry (M2-2C1).
 * Series IDs, units, SA flags, and transformations are reviewable here —
 * never inferred from headline keywords.
 */
export interface BlsSeriesSpec {
  readonly seriesId: string;
  readonly releaseFamily: CatalystReleaseFamily;
  readonly metric: string;
  readonly unit: string;
  readonly seasonalAdjustment: "SA" | "NSA";
  readonly transformation: BlsSeriesTransformation;
  /**
   * For mom-change / yoy-change: which level series to difference / ratio.
   * For level: same as seriesId.
   */
  readonly levelSeriesId: string;
  readonly description: string;
}

export const BLS_RESULTS_SOURCE_NAME = "BLS Public Data API";
export const BLS_RESULTS_API_URL =
  "https://api.bls.gov/publicAPI/v1/timeseries/data/";
export const BLS_RESULTS_PAGE_URL = "https://www.bls.gov/developers/";

export const BLS_RELEASE_PAGE_URL: Record<CatalystReleaseFamily, string> = {
  cpi: "https://www.bls.gov/cpi/",
  employment_situation: "https://www.bls.gov/news.release/empsit.toc.htm",
};

/** Headline CPI-U SA index (CUSR0000SA0). */
export const BLS_SERIES_CPI_HEADLINE_SA = "CUSR0000SA0";

/**
 * Core CPI-U SA — All items less food and energy.
 * Verified against BLS Public API catalog/data for CUSR0000SA0L1E.
 */
export const BLS_SERIES_CPI_CORE_SA = "CUSR0000SA0L1E";

/** Total nonfarm payrolls, CES SA, thousands. */
export const BLS_SERIES_PAYROLLS = "CES0000000001";

/** Civilian unemployment rate, SA, percent. */
export const BLS_SERIES_UNEMPLOYMENT_RATE = "LNS14000000";

export const BLS_SERIES_REGISTRY: readonly BlsSeriesSpec[] = [
  {
    seriesId: BLS_SERIES_CPI_HEADLINE_SA,
    releaseFamily: "cpi",
    metric: "headline_cpi_sa_mom",
    unit: "percent",
    seasonalAdjustment: "SA",
    transformation: "mom-change",
    levelSeriesId: BLS_SERIES_CPI_HEADLINE_SA,
    description: "CPI-U All items SA — month-over-month percent change",
  },
  {
    seriesId: BLS_SERIES_CPI_HEADLINE_SA,
    releaseFamily: "cpi",
    metric: "headline_cpi_sa_yoy",
    unit: "percent",
    seasonalAdjustment: "SA",
    transformation: "yoy-change",
    levelSeriesId: BLS_SERIES_CPI_HEADLINE_SA,
    description: "CPI-U All items SA — year-over-year percent change",
  },
  {
    seriesId: BLS_SERIES_CPI_CORE_SA,
    releaseFamily: "cpi",
    metric: "core_cpi_sa_mom",
    unit: "percent",
    seasonalAdjustment: "SA",
    transformation: "mom-change",
    levelSeriesId: BLS_SERIES_CPI_CORE_SA,
    description:
      "CPI-U All items less food and energy SA — month-over-month percent change",
  },
  {
    seriesId: BLS_SERIES_CPI_CORE_SA,
    releaseFamily: "cpi",
    metric: "core_cpi_sa_yoy",
    unit: "percent",
    seasonalAdjustment: "SA",
    transformation: "yoy-change",
    levelSeriesId: BLS_SERIES_CPI_CORE_SA,
    description:
      "CPI-U All items less food and energy SA — year-over-year percent change",
  },
  {
    seriesId: BLS_SERIES_PAYROLLS,
    releaseFamily: "employment_situation",
    metric: "total_nonfarm_payrolls_mom",
    unit: "thousands",
    seasonalAdjustment: "SA",
    transformation: "mom-change",
    levelSeriesId: BLS_SERIES_PAYROLLS,
    description:
      "Total nonfarm payroll employment SA — monthly change (thousands)",
  },
  {
    seriesId: BLS_SERIES_UNEMPLOYMENT_RATE,
    releaseFamily: "employment_situation",
    metric: "unemployment_rate",
    unit: "percent",
    seasonalAdjustment: "SA",
    transformation: "level",
    levelSeriesId: BLS_SERIES_UNEMPLOYMENT_RATE,
    description: "Civilian unemployment rate SA — official level (percent)",
  },
];

/** Unique series IDs to request from the BLS API. */
export function blsSeriesIdsToFetch(): string[] {
  return [...new Set(BLS_SERIES_REGISTRY.map((s) => s.levelSeriesId))];
}

export function seriesSpecsForFamily(
  family: CatalystReleaseFamily,
): readonly BlsSeriesSpec[] {
  return BLS_SERIES_REGISTRY.filter((s) => s.releaseFamily === family);
}
