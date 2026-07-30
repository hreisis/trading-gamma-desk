import { fetchValidated, type FetchLike } from "@/ingest/http";
import type { OfficialDocumentProvider } from "@/contracts";
import { extractOfficialContentText } from "./html-text";
import { validateCanonicalOfficialUrl } from "./url";

const DEFAULT_TIMEOUT_MS = 20_000;

const DEFAULT_HEADERS: Record<string, string> = {
  Accept: "text/html, application/xhtml+xml, */*",
  "User-Agent":
    "GammaDesk/0.0 (local official-document ingest; +https://github.com/hreisis/trading-gamma-desk)",
};

/**
 * Fetch an official HTML page and return normalized body text.
 * Returns undefined on failure (caller keeps RSS metadata).
 */
export async function fetchOfficialBodyText(
  url: string,
  provider: OfficialDocumentProvider,
  options: {
    readonly fetchImpl?: FetchLike;
    readonly timeoutMs?: number;
  } = {},
): Promise<string | undefined> {
  const check = validateCanonicalOfficialUrl(url, provider);
  if (!check.ok) return undefined;
  try {
    const validated = await fetchValidated(
      check.url,
      {
        label: `${provider} document body`,
        contentTypeIncludes: "html",
      },
      {
        fetchImpl: options.fetchImpl,
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        headers: DEFAULT_HEADERS,
      },
    );
    const text = extractOfficialContentText(validated.body);
    return text.length > 0 ? text : undefined;
  } catch {
    return undefined;
  }
}
