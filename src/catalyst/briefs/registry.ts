import type { OfficialDocumentType } from "@/contracts";

export type BriefMetricUnit =
  | "percent"
  | "percentage_point"
  | "billion_usd"
  | "thousands"
  | "persons";

export interface BriefMetricSpec {
  readonly metric: string;
  readonly unit: BriefMetricUnit;
  readonly label: string;
  /** Absolute tolerance when cross-checking structured results. */
  readonly crossCheckTolerance: number;
  /** Structured observation metric name when comparable (M2-2C1). */
  readonly structuredMetric?: string;
}

/** Explicit metrics / tolerances — never inferred from free keywords. */
export const BRIEF_METRIC_REGISTRY: Record<string, BriefMetricSpec> = {
  fomc_policy_action: {
    metric: "fomc_policy_action",
    unit: "percent",
    label: "Policy action",
    crossCheckTolerance: 0,
  },
  fomc_target_range_low: {
    metric: "fomc_target_range_low",
    unit: "percent",
    label: "Target range low",
    crossCheckTolerance: 0,
  },
  fomc_target_range_high: {
    metric: "fomc_target_range_high",
    unit: "percent",
    label: "Target range high",
    crossCheckTolerance: 0,
  },
  fomc_vote_for: {
    metric: "fomc_vote_for",
    unit: "persons",
    label: "Votes for",
    crossCheckTolerance: 0,
  },
  fomc_vote_against: {
    metric: "fomc_vote_against",
    unit: "persons",
    label: "Votes against",
    crossCheckTolerance: 0,
  },
  headline_cpi_sa_mom: {
    metric: "headline_cpi_sa_mom",
    unit: "percent",
    label: "Headline CPI monthly change (SA)",
    crossCheckTolerance: 0.05,
    structuredMetric: "headline_cpi_sa_mom",
  },
  headline_cpi_sa_yoy: {
    metric: "headline_cpi_sa_yoy",
    unit: "percent",
    label: "Headline CPI 12-month change",
    crossCheckTolerance: 0.05,
    structuredMetric: "headline_cpi_sa_yoy",
  },
  core_cpi_sa_mom: {
    metric: "core_cpi_sa_mom",
    unit: "percent",
    label: "Core CPI monthly change (SA)",
    crossCheckTolerance: 0.05,
    structuredMetric: "core_cpi_sa_mom",
  },
  core_cpi_sa_yoy: {
    metric: "core_cpi_sa_yoy",
    unit: "percent",
    label: "Core CPI 12-month change",
    crossCheckTolerance: 0.05,
    structuredMetric: "core_cpi_sa_yoy",
  },
  total_nonfarm_payrolls_mom: {
    metric: "total_nonfarm_payrolls_mom",
    unit: "thousands",
    label: "Total nonfarm payroll change",
    crossCheckTolerance: 1,
    structuredMetric: "total_nonfarm_payrolls_mom",
  },
  unemployment_rate: {
    metric: "unemployment_rate",
    unit: "percent",
    label: "Unemployment rate",
    crossCheckTolerance: 0.05,
    structuredMetric: "unemployment_rate",
  },
  payroll_prior_month_revision: {
    metric: "payroll_prior_month_revision",
    unit: "thousands",
    label: "Prior-month payroll revision",
    crossCheckTolerance: 1,
  },
  real_gdp_annualized: {
    metric: "real_gdp_annualized",
    unit: "percent",
    label: "Real GDP annualized change",
    crossCheckTolerance: 0.05,
  },
  personal_income_mom: {
    metric: "personal_income_mom",
    unit: "percent",
    label: "Personal income monthly change",
    crossCheckTolerance: 0.05,
  },
  disposable_personal_income_mom: {
    metric: "disposable_personal_income_mom",
    unit: "percent",
    label: "Disposable personal income monthly change",
    crossCheckTolerance: 0.05,
  },
  pce_spending_mom: {
    metric: "pce_spending_mom",
    unit: "percent",
    label: "Personal consumption expenditures monthly change",
    crossCheckTolerance: 0.05,
  },
  headline_pce_yoy: {
    metric: "headline_pce_yoy",
    unit: "percent",
    label: "Headline PCE 12-month change",
    crossCheckTolerance: 0.05,
  },
  core_pce_yoy: {
    metric: "core_pce_yoy",
    unit: "percent",
    label: "Core PCE 12-month change",
    crossCheckTolerance: 0.05,
  },
  trade_balance: {
    metric: "trade_balance",
    unit: "billion_usd",
    label: "Goods and services trade balance",
    crossCheckTolerance: 0.1,
  },
  exports: {
    metric: "exports",
    unit: "billion_usd",
    label: "Exports",
    crossCheckTolerance: 0.1,
  },
  imports: {
    metric: "imports",
    unit: "billion_usd",
    label: "Imports",
    crossCheckTolerance: 0.1,
  },
};

export const EXPECTED_FACT_KEYS: Record<
  OfficialDocumentType,
  readonly string[]
> = {
  fomc_statement: [
    "policy_action",
    "target_range",
    "vote_result",
    "dissenters",
  ],
  cpi_release: [
    "headline_cpi_sa_mom",
    "headline_cpi_sa_yoy",
    "core_cpi_sa_mom",
    "core_cpi_sa_yoy",
  ],
  employment_release: [
    "total_nonfarm_payrolls_mom",
    "unemployment_rate",
    "payroll_prior_month_revision",
    "reference_month",
  ],
  gdp_release: [
    "real_gdp_annualized",
    "estimate_type",
    "previous_estimate_comparison",
  ],
  personal_income_outlays_release: [
    "personal_income_mom",
    "disposable_personal_income_mom",
    "pce_spending_mom",
    "headline_pce_yoy",
    "core_pce_yoy",
  ],
  international_trade_release: [
    "trade_balance",
    "exports",
    "imports",
    "trade_balance_change",
  ],
};
