import type {
  CatalystCategory,
  CatalystImportance,
  CatalystMacroChannel,
  CatalystReleaseFamily,
} from "@/contracts";

export type OfficialCalendarSourceId = "bls" | "bea" | "federal_reserve";

/**
 * Explicit, reviewable mapping from official calendar titles to Catalyst taxonomy.
 * Adapters must match registry entries — do not invent categories from fuzzy keywords.
 */
export interface OfficialEventMapping {
  readonly id: string;
  readonly source: OfficialCalendarSourceId;
  /** Exact title after ICS unescape / BEA object key / FOMC event type. */
  readonly titleExact: string;
  readonly category: CatalystCategory;
  readonly importance: CatalystImportance;
  readonly affectedAssets: readonly string[];
  readonly macroChannels: readonly CatalystMacroChannel[];
  readonly headline: string;
  readonly summary: string;
  /** When set, enables official series result linking (M2-2C1). */
  readonly releaseFamily?: CatalystReleaseFamily;
}

/** Shared FOMC asset / channel coverage (rates, USD, equities, gold, macro channels). */
const FOMC_AFFECTED_ASSETS = [
  "US2Y",
  "US10Y",
  "USD",
  "SPX",
  "GOLD",
] as const;

const FOMC_MACRO_CHANNELS: readonly CatalystMacroChannel[] = [
  "fed_rates",
  "liquidity",
  "growth",
  "inflation",
];

export const OFFICIAL_EVENT_REGISTRY: readonly OfficialEventMapping[] = [
  {
    id: "bls_cpi",
    source: "bls",
    titleExact: "Consumer Price Index",
    category: "inflation",
    importance: "high",
    affectedAssets: ["US2Y", "US10Y", "GOLD", "USD", "OIL"],
    macroChannels: ["inflation", "fed_rates"],
    headline: "Consumer Price Index (CPI) scheduled release",
    summary:
      "BLS Consumer Price Index release schedule entry. Scheduled time only — not an observed print.",
    releaseFamily: "cpi",
  },
  {
    id: "bls_employment_situation",
    source: "bls",
    titleExact: "Employment Situation",
    category: "labor",
    importance: "high",
    affectedAssets: ["US2Y", "US10Y", "USD", "GOLD"],
    macroChannels: ["growth", "fed_rates"],
    headline: "Employment Situation scheduled release",
    summary:
      "BLS Employment Situation (payrolls / unemployment) schedule entry. Scheduled time only — not an observed print.",
    releaseFamily: "employment_situation",
  },
  {
    id: "bls_ppi",
    source: "bls",
    titleExact: "Producer Price Index",
    category: "inflation",
    importance: "high",
    affectedAssets: ["US2Y", "US10Y", "USD", "OIL"],
    macroChannels: ["inflation"],
    headline: "Producer Price Index (PPI) scheduled release",
    summary:
      "BLS Producer Price Index release schedule entry. Scheduled time only — not an observed print.",
  },
  {
    id: "bls_jolts",
    source: "bls",
    titleExact: "Job Openings and Labor Turnover Survey",
    category: "labor",
    importance: "medium",
    affectedAssets: ["US2Y", "US10Y", "USD"],
    macroChannels: ["growth", "fed_rates"],
    headline: "JOLTS scheduled release",
    summary:
      "BLS Job Openings and Labor Turnover Survey schedule entry. Scheduled time only — not an observed print.",
  },
  {
    id: "bls_eci",
    source: "bls",
    titleExact: "Employment Cost Index",
    category: "labor",
    importance: "medium",
    affectedAssets: ["US2Y", "US10Y", "USD"],
    macroChannels: ["inflation", "growth", "fed_rates"],
    headline: "Employment Cost Index scheduled release",
    summary:
      "BLS Employment Cost Index schedule entry. Scheduled time only — not an observed print.",
  },
  {
    id: "bea_gdp",
    source: "bea",
    titleExact: "Gross Domestic Product",
    category: "growth",
    importance: "high",
    affectedAssets: ["US2Y", "US10Y", "USD", "COPPER", "BTC"],
    macroChannels: ["growth"],
    headline: "Gross Domestic Product (GDP) scheduled release",
    summary:
      "BEA GDP release schedule entry. Scheduled time only — not an observed print.",
  },
  {
    id: "bea_personal_income_outlays",
    source: "bea",
    titleExact: "Personal Income and Outlays",
    category: "growth",
    importance: "high",
    affectedAssets: ["US2Y", "US10Y", "USD", "GOLD"],
    // Single canonical category (growth); PCE inflation stress via channels.
    macroChannels: ["growth", "inflation", "fed_rates"],
    headline: "Personal Income and Outlays scheduled release",
    summary:
      "BEA Personal Income and Outlays schedule entry (includes PCE inflation data). Single growth category; inflation impact via macroChannels. Scheduled time only — not an observed print.",
  },
  {
    id: "bea_international_trade",
    source: "bea",
    titleExact: "U.S. International Trade in Goods and Services",
    category: "growth",
    importance: "medium",
    affectedAssets: ["USD", "US10Y", "COPPER"],
    macroChannels: ["growth", "risk_sentiment"],
    headline: "International Trade scheduled release",
    summary:
      "BEA U.S. International Trade in Goods and Services schedule entry. Scheduled time only — not an observed print.",
  },
  {
    id: "fomc_policy_decision",
    source: "federal_reserve",
    titleExact: "FOMC policy decision",
    category: "monetary-policy",
    importance: "critical",
    affectedAssets: [...FOMC_AFFECTED_ASSETS],
    macroChannels: [...FOMC_MACRO_CHANNELS],
    headline: "FOMC policy decision (scheduled)",
    summary:
      "Federal Reserve FOMC policy decision schedule entry. Scheduled release time only — not an observed decision, SEP content, or market direction.",
  },
  {
    id: "fomc_press_conference",
    source: "federal_reserve",
    titleExact: "Federal Reserve Chair press conference",
    category: "monetary-policy",
    importance: "high",
    affectedAssets: [...FOMC_AFFECTED_ASSETS],
    macroChannels: [...FOMC_MACRO_CHANNELS],
    headline: "Federal Reserve Chair press conference (scheduled)",
    summary:
      "Federal Reserve Chair press conference schedule entry (typically 2:30 p.m. Eastern). Scheduled time only — not transcript content or market direction.",
  },
];

function normalizeTitle(title: string): string {
  return title.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Resolve an explicit registry row for a provider title, or null if out of scope. */
export function matchOfficialEvent(
  source: OfficialCalendarSourceId,
  title: string,
): OfficialEventMapping | null {
  const needle = normalizeTitle(title);
  for (const row of OFFICIAL_EVENT_REGISTRY) {
    if (row.source !== source) continue;
    if (normalizeTitle(row.titleExact) === needle) return row;
  }
  // BLS sometimes shortens JOLTS in SUMMARY.
  if (source === "bls" && needle === "job openings and labor turnover") {
    return (
      OFFICIAL_EVENT_REGISTRY.find((r) => r.id === "bls_jolts") ?? null
    );
  }
  return null;
}

export function requireOfficialEvent(
  source: OfficialCalendarSourceId,
  title: string,
): OfficialEventMapping {
  const mapped = matchOfficialEvent(source, title);
  if (!mapped) {
    throw new Error(`No official registry mapping for ${source}: ${title}`);
  }
  return mapped;
}
