import { createHash } from "node:crypto";
import type {
  BriefFact,
  BriefFactType,
  BriefFactValue,
  OfficialBrief,
  OfficialDocument,
} from "@/contracts";
import { locateEvidence } from "./evidence";
import { BRIEF_EXTRACTOR_VERSION } from "./version";

export interface DraftFact {
  readonly key: string;
  readonly label: string;
  readonly text: string;
  readonly factType: BriefFactType;
  readonly excerpt: string;
  readonly values?: readonly BriefFactValue[];
}

export interface ExtractorResult {
  readonly facts: BriefFact[];
  readonly omissions: string[];
  readonly warnings: string[];
  readonly headlineParts: string[];
}

export function emptyExtractorResult(): ExtractorResult {
  return { facts: [], omissions: [], warnings: [], headlineParts: [] };
}

export function tryFact(
  doc: OfficialDocument,
  contentText: string,
  draft: DraftFact,
  seenMetrics: Set<string>,
): { fact: BriefFact } | { omission: string } {
  const evidence = locateEvidence(
    contentText,
    draft.excerpt,
    doc.id,
    doc.contentHash,
  );
  if (!evidence) {
    return {
      omission: `${draft.key}: excerpt not found in normalized contentText`,
    };
  }
  const metricKeys = (draft.values ?? []).map((v) => v.metric);
  for (const m of metricKeys) {
    if (seenMetrics.has(m)) {
      return { omission: `${draft.key}: duplicate metric ${m} skipped` };
    }
  }
  for (const m of metricKeys) seenMetrics.add(m);
  if (metricKeys.length === 0 && seenMetrics.has(draft.key)) {
    return { omission: `${draft.key}: duplicate fact key skipped` };
  }
  if (metricKeys.length === 0) seenMetrics.add(draft.key);

  const fact: BriefFact = {
    id: `${doc.id}_${draft.key}`,
    label: draft.label,
    text: draft.text,
    factType: draft.factType,
    evidence,
    ...(draft.values && draft.values.length > 0
      ? { values: [...draft.values] }
      : {}),
  };
  return { fact };
}

export function briefIdFor(
  documentId: string,
  contentHash: string,
  extractorVersion: string,
): string {
  const digest = createHash("sha256")
    .update(`${documentId}|${contentHash}|${extractorVersion}`, "utf8")
    .digest("hex")
    .slice(0, 16);
  return `obrief_${digest}`;
}

export function finalizeBrief(
  doc: OfficialDocument,
  generatedAt: string,
  extracted: ExtractorResult,
  expectedKeys: readonly string[],
): OfficialBrief {
  const foundKeys = new Set(
    extracted.facts.flatMap((f) => [
      f.id.replace(`${doc.id}_`, ""),
      ...(f.values ?? []).map((v) => v.metric),
    ]),
  );
  const omissions = [...extracted.omissions];
  for (const key of expectedKeys) {
    const present =
      foundKeys.has(key) ||
      extracted.facts.some((f) => f.id.endsWith(`_${key}`));
    if (!present && !omissions.some((o) => o.startsWith(`${key}:`))) {
      omissions.push(`${key}: not found with reliable evidence in source text`);
    }
  }

  let status: OfficialBrief["status"] = "complete";
  if (extracted.facts.length === 0) status = "unavailable";
  else if (omissions.length > 0) status = "partial";

  const headline =
    extracted.headlineParts.length > 0
      ? extracted.headlineParts.slice(0, 3).join(" · ")
      : extracted.facts.length > 0
        ? extracted.facts
            .slice(0, 3)
            .map((f) => f.label)
            .join(" · ")
        : `${doc.title} — no extractable facts`;

  return {
    schemaVersion: "0.1.0",
    id: briefIdFor(doc.id, doc.contentHash, BRIEF_EXTRACTOR_VERSION),
    documentId: doc.id,
    documentContentHash: doc.contentHash,
    extractorVersion: BRIEF_EXTRACTOR_VERSION,
    releaseFamily: doc.releaseFamily,
    ...(doc.referencePeriod ? { referencePeriod: doc.referencePeriod } : {}),
    generatedAt,
    status,
    headline,
    facts: extracted.facts,
    omissions,
    warnings: extracted.warnings,
    synthetic: doc.synthetic,
  };
}
