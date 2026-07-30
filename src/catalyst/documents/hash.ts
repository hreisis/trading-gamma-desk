import { createHash } from "node:crypto";

/** Stable content hash over normalized title + body (+ optional source summary). */
export function documentContentHash(parts: {
  readonly title: string;
  readonly contentText?: string;
  readonly summaryFromSource?: string;
}): string {
  const payload = [
    parts.title.trim(),
    (parts.contentText ?? "").trim(),
    (parts.summaryFromSource ?? "").trim(),
  ].join("\n---\n");
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

export function documentIdFromUrl(canonicalUrl: string): string {
  const digest = createHash("sha256")
    .update(canonicalUrl, "utf8")
    .digest("hex")
    .slice(0, 16);
  return `odoc_${digest}`;
}
