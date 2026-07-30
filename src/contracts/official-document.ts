import { z } from "zod";
import { IsoDateTime, SemVer } from "./common";

export const OFFICIAL_DOCUMENT_SCHEMA_VERSION = "0.1.0";

export const OfficialDocumentProvider = z.enum([
  "federal_reserve",
  "bls",
  "bea",
]);

export const OfficialDocumentType = z.enum([
  "fomc_statement",
  "cpi_release",
  "employment_release",
  "gdp_release",
  "personal_income_outlays_release",
  "international_trade_release",
]);

/**
 * Release-family keys used for document↔catalyst linking.
 * Broader than CatalystReleaseFamily (results-only) — string identity only.
 */
export const DocumentReleaseFamily = z.enum([
  "cpi",
  "employment_situation",
  "fomc_policy",
  "gdp",
  "personal_income_outlays",
  "international_trade",
]);

/**
 * Canonical official release document (M2-3A). Stored separately from Catalyst;
 * linked by releaseFamily / referencePeriod / schedule date / official identity.
 * Never invents AI summaries, rates, vote splits, or market direction.
 */
export const OfficialDocument = z.object({
  schemaVersion: z.literal(OFFICIAL_DOCUMENT_SCHEMA_VERSION),
  id: z.string().min(1),
  provider: OfficialDocumentProvider,
  sourceName: z.string().min(1),
  canonicalUrl: z.string().url(),
  title: z.string().min(1),
  /** Official publication time from the source feed/page. */
  publishedAt: IsoDateTime,
  /** Wall-clock of this successful ingest observation. */
  observedAt: IsoDateTime,
  documentType: OfficialDocumentType,
  releaseFamily: DocumentReleaseFamily,
  /** YYYY-MM or YYYY-Qn when the official title/metadata states it. */
  referencePeriod: z.string().min(1).optional(),
  /**
   * Source-provided description/abstract only — never program-generated prose
   * labelled as a source summary.
   */
  summaryFromSource: z.string().min(1).optional(),
  /** Normalized body text after boilerplate stripping (optional). */
  contentText: z.string().min(1).optional(),
  contentHash: z.string().min(1),
  synthetic: z.boolean(),
});

/** Slim reference attached to a Catalyst for UI / evidence (no body text). */
export const OfficialDocumentRef = z.object({
  id: z.string().min(1),
  provider: OfficialDocumentProvider,
  documentType: OfficialDocumentType,
  releaseFamily: DocumentReleaseFamily,
  canonicalUrl: z.string().url(),
  title: z.string().min(1),
  publishedAt: IsoDateTime,
  contentHash: z.string().min(1),
  referencePeriod: z.string().min(1).optional(),
  summaryFromSource: z.string().min(1).optional(),
});

export type OfficialDocument = z.infer<typeof OfficialDocument>;
export type OfficialDocumentRef = z.infer<typeof OfficialDocumentRef>;
export type OfficialDocumentProvider = z.infer<typeof OfficialDocumentProvider>;
export type OfficialDocumentType = z.infer<typeof OfficialDocumentType>;
export type DocumentReleaseFamily = z.infer<typeof DocumentReleaseFamily>;
