import { fetchValidated, type FetchLike } from "@/ingest/http";
import type { OfficialDocument } from "@/contracts";
import { buildOfficialDocument } from "./build";
import { fetchOfficialBodyText } from "./fetch-body";
import {
  BEA_ITEM_NAME_REGISTRY,
  BEA_NEWS_RSS_URL,
  BEA_DOC_SOURCE_NAME,
  BLS_CPI_RSS_URL,
  BLS_EMPLOYMENT_RSS_URL,
  FED_MONETARY_RSS_URL,
  FED_DOC_SOURCE_NAME,
  FOMC_STATEMENT_TITLE_EXACT,
  blsFeedMapping,
  fomcStatementMapping,
} from "./registry";
import { parseRssOrAtom } from "./rss";
import type {
  DocumentProviderStatus,
  DocumentValidationError,
  RawDocumentItem,
} from "./types";

const DEFAULT_TIMEOUT_MS = 20_000;

const FEED_HEADERS: Record<string, string> = {
  Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
  "User-Agent":
    "GammaDesk/0.0 (local official-document ingest; +https://github.com/hreisis/trading-gamma-desk)",
};

export interface ProviderDocumentsResult {
  readonly source: DocumentProviderStatus;
  readonly documents: OfficialDocument[];
  readonly validationErrors: DocumentValidationError[];
}

async function fetchFeedBody(
  url: string,
  label: string,
  options: { readonly fetchImpl?: FetchLike; readonly timeoutMs?: number },
): Promise<string> {
  const validated = await fetchValidated(
    url,
    {
      label,
      // Official feeds may return text/xml, application/xml, or text/html wrappers.
      contentTypeIncludes: "xml",
    },
    {
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      headers: FEED_HEADERS,
    },
  );
  return validated.body;
}

async function materializeItems(
  items: RawDocumentItem[],
  mappingFor: (item: RawDocumentItem) => ReturnType<typeof fomcStatementMapping> | null,
  options: {
    readonly observedAt: string;
    readonly fetchImpl?: FetchLike;
    readonly timeoutMs?: number;
    readonly fetchBodies?: boolean;
    readonly requireReferencePeriod?: boolean;
  },
): Promise<{
  readonly documents: OfficialDocument[];
  readonly validationErrors: DocumentValidationError[];
}> {
  const documents: OfficialDocument[] = [];
  const validationErrors: DocumentValidationError[] = [];
  let index = 0;
  for (const item of items) {
    const mapping = mappingFor(item);
    if (!mapping) continue;
    let contentText: string | undefined;
    if (options.fetchBodies !== false) {
      contentText = await fetchOfficialBodyText(item.link, item.provider, {
        fetchImpl: options.fetchImpl,
        timeoutMs: options.timeoutMs,
      });
    }
    const built = buildOfficialDocument({
      mapping,
      item,
      observedAt: options.observedAt,
      contentText,
      requireReferencePeriod: options.requireReferencePeriod,
    });
    if (!built.ok) {
      validationErrors.push({
        index,
        error: built.error,
        externalId: built.externalId,
      });
    } else {
      documents.push(built.document);
    }
    index += 1;
  }
  return { documents, validationErrors };
}

export async function fetchFedDocuments(options: {
  readonly observedAt: string;
  readonly fetchImpl?: FetchLike;
  readonly timeoutMs?: number;
  readonly fetchBodies?: boolean;
}): Promise<ProviderDocumentsResult> {
  const url = FED_MONETARY_RSS_URL;
  try {
    const body = await fetchFeedBody(url, "Federal Reserve monetary RSS", options);
    const { items } = parseRssOrAtom(body);
    const raw: RawDocumentItem[] = items.map((it) => ({
      provider: "federal_reserve" as const,
      sourceName: FED_DOC_SOURCE_NAME,
      feedUrl: url,
      title: it.title,
      link: it.link,
      publishedAtRaw: it.publishedAtRaw,
      summaryFromSource: it.description,
      guid: it.guid,
    }));
    const exact = FOMC_STATEMENT_TITLE_EXACT.toLowerCase();
    const { documents, validationErrors } = await materializeItems(
      raw,
      (item) =>
        item.title.trim().toLowerCase() === exact
          ? fomcStatementMapping()
          : null,
      { ...options, requireReferencePeriod: false },
    );
    return {
      source: {
        id: "federal_reserve",
        name: FED_DOC_SOURCE_NAME,
        url,
        status: "ok",
        mappedDocumentCount: documents.length,
      },
      documents,
      validationErrors,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      source: {
        id: "federal_reserve",
        name: FED_DOC_SOURCE_NAME,
        url,
        status: "error",
        error: message,
        mappedDocumentCount: 0,
      },
      documents: [],
      validationErrors: [],
    };
  }
}

async function fetchBlsFeed(
  feedKey: "bls_cpi" | "bls_employment",
  options: {
    readonly observedAt: string;
    readonly fetchImpl?: FetchLike;
    readonly timeoutMs?: number;
    readonly fetchBodies?: boolean;
  },
): Promise<ProviderDocumentsResult> {
  const url =
    feedKey === "bls_cpi" ? BLS_CPI_RSS_URL : BLS_EMPLOYMENT_RSS_URL;
  const mapping = blsFeedMapping(feedKey);
  try {
    const body = await fetchFeedBody(url, `BLS ${feedKey} RSS`, options);
    const { items } = parseRssOrAtom(body);
    const raw: RawDocumentItem[] = items.map((it) => ({
      provider: "bls" as const,
      sourceName: mapping.sourceName,
      feedUrl: url,
      title: it.title,
      link: it.link,
      publishedAtRaw: it.publishedAtRaw,
      summaryFromSource: it.description,
      guid: it.guid,
    }));
    const { documents, validationErrors } = await materializeItems(
      raw,
      () => mapping,
      { ...options, requireReferencePeriod: false },
    );
    return {
      source: {
        id: "bls",
        name: mapping.sourceName,
        url,
        status: "ok",
        mappedDocumentCount: documents.length,
      },
      documents,
      validationErrors,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      source: {
        id: "bls",
        name: mapping.sourceName,
        url,
        status: "error",
        error: message,
        mappedDocumentCount: 0,
      },
      documents: [],
      validationErrors: [],
    };
  }
}

/**
 * Fetch CPI + Employment Situation RSS. Aggregates into one provider status
 * that is ok if either feed succeeds (partial failure surfaced via errors).
 */
export async function fetchBlsDocuments(options: {
  readonly observedAt: string;
  readonly fetchImpl?: FetchLike;
  readonly timeoutMs?: number;
  readonly fetchBodies?: boolean;
}): Promise<ProviderDocumentsResult> {
  const [cpi, emp] = await Promise.all([
    fetchBlsFeed("bls_cpi", options),
    fetchBlsFeed("bls_employment", options),
  ]);
  const documents = [...cpi.documents, ...emp.documents];
  const validationErrors = [
    ...cpi.validationErrors,
    ...emp.validationErrors,
  ];
  const bothFailed =
    cpi.source.status === "error" && emp.source.status === "error";
  const eitherOk =
    cpi.source.status === "ok" || emp.source.status === "ok";
  const errors = [cpi.source.error, emp.source.error].filter(Boolean);
  return {
    source: {
      id: "bls",
      name: "BLS CPI + Employment Situation RSS",
      url: `${BLS_CPI_RSS_URL} | ${BLS_EMPLOYMENT_RSS_URL}`,
      status: eitherOk ? "ok" : "error",
      error: bothFailed
        ? errors.join("; ")
        : errors.length > 0
          ? `partial: ${errors.join("; ")}`
          : undefined,
      mappedDocumentCount: documents.length,
    },
    documents,
    validationErrors,
  };
}

export async function fetchBeaDocuments(options: {
  readonly observedAt: string;
  readonly fetchImpl?: FetchLike;
  readonly timeoutMs?: number;
  readonly fetchBodies?: boolean;
}): Promise<ProviderDocumentsResult> {
  const url = BEA_NEWS_RSS_URL;
  try {
    const body = await fetchFeedBody(url, "BEA news RSS", options);
    const { items } = parseRssOrAtom(body);
    const raw: RawDocumentItem[] = [];
    for (const it of items) {
      const name = it.itemName?.trim();
      if (!name || !(name in BEA_ITEM_NAME_REGISTRY)) continue;
      raw.push({
        provider: "bea",
        sourceName: BEA_DOC_SOURCE_NAME,
        feedUrl: url,
        title: it.title,
        link: it.link,
        publishedAtRaw: it.publishedAtRaw,
        summaryFromSource: it.description,
        guid: it.guid,
        itemName: name,
      });
    }
    const { documents, validationErrors } = await materializeItems(
      raw,
      (item) => {
        const name = item.itemName?.trim();
        if (!name) return null;
        return BEA_ITEM_NAME_REGISTRY[name] ?? null;
      },
      { ...options, requireReferencePeriod: false },
    );
    return {
      source: {
        id: "bea",
        name: BEA_DOC_SOURCE_NAME,
        url,
        status: "ok",
        mappedDocumentCount: documents.length,
      },
      documents,
      validationErrors,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      source: {
        id: "bea",
        name: BEA_DOC_SOURCE_NAME,
        url,
        status: "error",
        error: message,
        mappedDocumentCount: 0,
      },
      documents: [],
      validationErrors: [],
    };
  }
}
