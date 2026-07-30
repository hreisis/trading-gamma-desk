import type { OfficialDocumentProvider } from "@/contracts";
import { OFFICIAL_DOCUMENT_HOSTS } from "./registry";

/**
 * Validate and canonicalize an official document URL.
 * Only https + allowlisted official hostnames; rejects search/aggregator hosts.
 */
export function validateCanonicalOfficialUrl(
  raw: string,
  provider: OfficialDocumentProvider,
): { ok: true; url: string } | { ok: false; error: string } {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return { ok: false, error: `invalid URL: ${raw}` };
  }
  if (parsed.protocol !== "https:") {
    return { ok: false, error: `non-https URL rejected: ${raw}` };
  }
  const host = parsed.hostname.toLowerCase();
  const allowed = OFFICIAL_DOCUMENT_HOSTS[provider];
  if (!allowed.includes(host)) {
    return {
      ok: false,
      error: `host ${host} not allowlisted for ${provider}`,
    };
  }
  // Strip fragments; keep path/query as published.
  parsed.hash = "";
  return { ok: true, url: parsed.toString() };
}
