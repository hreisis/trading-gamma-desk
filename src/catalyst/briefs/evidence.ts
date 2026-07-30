import type { BriefFactEvidence } from "@/contracts";

/**
 * Locate an exact excerpt in normalized contentText and build evidence.
 * Returns null when the excerpt is not an exact substring (no fuzzy match).
 */
export function locateEvidence(
  contentText: string,
  excerpt: string,
  documentId: string,
  contentHash: string,
): BriefFactEvidence | null {
  if (!excerpt || !contentText) return null;
  const startOffset = contentText.indexOf(excerpt);
  if (startOffset < 0) return null;
  const endOffset = startOffset + excerpt.length;
  if (contentText.slice(startOffset, endOffset) !== excerpt) return null;
  return {
    documentId,
    contentHash,
    excerpt,
    startOffset,
    endOffset,
  };
}

/** Round-trip validation used by tests and build-time asserts. */
export function evidenceResolves(
  contentText: string,
  evidence: BriefFactEvidence,
): boolean {
  if (evidence.contentHash.length === 0) return false;
  if (evidence.endOffset <= evidence.startOffset) return false;
  if (evidence.endOffset > contentText.length) return false;
  return (
    contentText.slice(evidence.startOffset, evidence.endOffset) ===
    evidence.excerpt
  );
}
