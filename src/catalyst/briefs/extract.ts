import type { OfficialBrief, OfficialDocument } from "@/contracts";
import { briefIdFor, finalizeBrief } from "./extract-common";
import { extractCpiRelease } from "./extractors/cpi";
import { extractEmploymentRelease } from "./extractors/employment";
import { extractFomcStatement } from "./extractors/fomc";
import { extractGdpRelease } from "./extractors/gdp";
import { extractPersonalIncomeRelease } from "./extractors/personal-income";
import { extractTradeRelease } from "./extractors/trade";
import { EXPECTED_FACT_KEYS } from "./registry";
import { BRIEF_EXTRACTOR_VERSION } from "./version";

export function extractBriefFromDocument(
  doc: OfficialDocument,
  generatedAt: string,
): OfficialBrief {
  const contentText = doc.contentText?.trim() ?? "";
  if (!contentText) {
    return {
      schemaVersion: "0.1.0",
      id: briefIdFor(doc.id, doc.contentHash, BRIEF_EXTRACTOR_VERSION),
      documentId: doc.id,
      documentContentHash: doc.contentHash,
      extractorVersion: BRIEF_EXTRACTOR_VERSION,
      releaseFamily: doc.releaseFamily,
      ...(doc.referencePeriod ? { referencePeriod: doc.referencePeriod } : {}),
      generatedAt,
      status: "unavailable",
      headline: `${doc.title} — contentText unavailable`,
      facts: [],
      omissions: [
        "contentText: missing — cannot extract evidence-grounded facts",
      ],
      warnings: [],
      synthetic: doc.synthetic,
    };
  }

  let extracted;
  switch (doc.documentType) {
    case "fomc_statement":
      extracted = extractFomcStatement(doc, contentText);
      break;
    case "cpi_release":
      extracted = extractCpiRelease(doc, contentText);
      break;
    case "employment_release":
      extracted = extractEmploymentRelease(doc, contentText);
      break;
    case "gdp_release":
      extracted = extractGdpRelease(doc, contentText);
      break;
    case "personal_income_outlays_release":
      extracted = extractPersonalIncomeRelease(doc, contentText);
      break;
    case "international_trade_release":
      extracted = extractTradeRelease(doc, contentText);
      break;
    default: {
      const _exhaustive: never = doc.documentType;
      throw new Error(`No extractor for ${_exhaustive}`);
    }
  }

  return finalizeBrief(
    doc,
    generatedAt,
    extracted,
    EXPECTED_FACT_KEYS[doc.documentType],
  );
}
