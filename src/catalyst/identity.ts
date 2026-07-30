/**
 * Shared external-identity normalization for externalId, supersedesExternalId,
 * and ext: dedupe keys.
 */

function stripDiacritics(s: string): string {
  return s.normalize("NFKD").replace(/\p{M}/gu, "");
}

/**
 * Collapse case, whitespace, and punctuation so "Syn CPI-001!" and
 * "syn  cpi_001" map to the same identity token.
 */
export function normalizeExternalIdentity(
  raw: string | undefined | null,
): string | null {
  if (raw === undefined || raw === null) return null;
  const token = stripDiacritics(raw)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "-");
  return token.length > 0 ? token : null;
}

/** `ext:<normalized>` key, or null when identity is empty. */
export function externalIdentityKey(
  raw: string | undefined | null,
): string | null {
  const id = normalizeExternalIdentity(raw);
  return id ? `ext:${id}` : null;
}
