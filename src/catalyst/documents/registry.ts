import type {
  DocumentReleaseFamily,
  OfficialDocumentProvider,
  OfficialDocumentType,
} from "@/contracts";
import type { DocumentTypeMapping } from "./types";

export const FED_MONETARY_RSS_URL =
  "https://www.federalreserve.gov/feeds/press_monetary.xml";

export const BLS_CPI_RSS_URL = "https://www.bls.gov/feed/cpi.rss";
export const BLS_EMPLOYMENT_RSS_URL = "https://www.bls.gov/feed/empsit.rss";

export const BEA_NEWS_RSS_URL = "https://apps.bea.gov/rss/rss.xml";

export const FED_DOC_SOURCE_NAME =
  "Federal Reserve Monetary Policy Press Releases";
export const BLS_CPI_DOC_SOURCE_NAME = "BLS Consumer Price Index News Release";
export const BLS_EMPLOYMENT_DOC_SOURCE_NAME =
  "BLS Employment Situation News Release";
export const BEA_DOC_SOURCE_NAME = "BEA News Release Feed";

export const OFFICIAL_DOCUMENT_HOSTS: Record<
  OfficialDocumentProvider,
  readonly string[]
> = {
  federal_reserve: ["www.federalreserve.gov", "federalreserve.gov"],
  bls: ["www.bls.gov", "bls.gov"],
  bea: ["www.bea.gov", "bea.gov", "apps.bea.gov"],
};

export interface DocumentProviderSpec {
  readonly id: OfficialDocumentProvider;
  readonly name: string;
  readonly feedUrl: string;
  /** Secondary BLS employment feed shares provider id via parallel fetch. */
  readonly feedKey: string;
}

export const DOCUMENT_PROVIDER_SPECS: readonly DocumentProviderSpec[] = [
  {
    id: "federal_reserve",
    name: FED_DOC_SOURCE_NAME,
    feedUrl: FED_MONETARY_RSS_URL,
    feedKey: "federal_reserve",
  },
  {
    id: "bls",
    name: BLS_CPI_DOC_SOURCE_NAME,
    feedUrl: BLS_CPI_RSS_URL,
    feedKey: "bls_cpi",
  },
  {
    id: "bls",
    name: BLS_EMPLOYMENT_DOC_SOURCE_NAME,
    feedUrl: BLS_EMPLOYMENT_RSS_URL,
    feedKey: "bls_employment",
  },
  {
    id: "bea",
    name: BEA_DOC_SOURCE_NAME,
    feedUrl: BEA_NEWS_RSS_URL,
    feedKey: "bea",
  },
];

/** Exact FOMC statement title from the monetary-policy press RSS. */
export const FOMC_STATEMENT_TITLE_EXACT =
  "Federal Reserve issues FOMC statement";

export const BEA_ITEM_NAME_REGISTRY: Readonly<
  Record<string, DocumentTypeMapping>
> = {
  "Gross Domestic Product": {
    documentType: "gdp_release",
    releaseFamily: "gdp",
    sourceName: BEA_DOC_SOURCE_NAME,
  },
  "Personal Income and Outlays": {
    documentType: "personal_income_outlays_release",
    releaseFamily: "personal_income_outlays",
    sourceName: BEA_DOC_SOURCE_NAME,
  },
  "U.S. International Trade in Goods and Services": {
    documentType: "international_trade_release",
    releaseFamily: "international_trade",
    sourceName: BEA_DOC_SOURCE_NAME,
  },
};

export function blsFeedMapping(
  feedKey: "bls_cpi" | "bls_employment",
): DocumentTypeMapping {
  if (feedKey === "bls_cpi") {
    return {
      documentType: "cpi_release",
      releaseFamily: "cpi",
      sourceName: BLS_CPI_DOC_SOURCE_NAME,
    };
  }
  return {
    documentType: "employment_release",
    releaseFamily: "employment_situation",
    sourceName: BLS_EMPLOYMENT_DOC_SOURCE_NAME,
  };
}

export function fomcStatementMapping(): DocumentTypeMapping {
  return {
    documentType: "fomc_statement",
    releaseFamily: "fomc_policy",
    sourceName: FED_DOC_SOURCE_NAME,
  };
}

/** Catalyst schedule identity tokens used for date-based linking. */
export const DOCUMENT_FAMILY_TO_SCHEDULE_HINTS: Record<
  DocumentReleaseFamily,
  {
    readonly provider: OfficialDocumentProvider;
    readonly documentType: OfficialDocumentType;
    readonly titleIncludes: readonly string[];
    readonly releaseFamilyExact?: "cpi" | "employment_situation";
  }
> = {
  cpi: {
    provider: "bls",
    documentType: "cpi_release",
    titleIncludes: ["consumer price index", "cpi"],
    releaseFamilyExact: "cpi",
  },
  employment_situation: {
    provider: "bls",
    documentType: "employment_release",
    titleIncludes: ["employment situation", "payroll"],
    releaseFamilyExact: "employment_situation",
  },
  fomc_policy: {
    provider: "federal_reserve",
    documentType: "fomc_statement",
    titleIncludes: ["fomc policy decision"],
  },
  gdp: {
    provider: "bea",
    documentType: "gdp_release",
    titleIncludes: ["gross domestic product", "gdp"],
  },
  personal_income_outlays: {
    provider: "bea",
    documentType: "personal_income_outlays_release",
    titleIncludes: ["personal income and outlays"],
  },
  international_trade: {
    provider: "bea",
    documentType: "international_trade_release",
    titleIncludes: ["international trade"],
  },
};
