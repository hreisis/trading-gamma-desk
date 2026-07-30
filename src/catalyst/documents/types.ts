import type {
  DocumentReleaseFamily,
  OfficialDocument,
  OfficialDocumentProvider,
  OfficialDocumentType,
} from "@/contracts";

export type DocumentSourceStatus = "ok" | "error" | "skipped";

export interface DocumentProviderStatus {
  readonly id: OfficialDocumentProvider;
  readonly name: string;
  readonly url: string;
  readonly status: DocumentSourceStatus;
  readonly error?: string;
  readonly mappedDocumentCount?: number;
}

export interface DocumentRevisionRecord {
  readonly canonicalUrl: string;
  readonly documentId: string;
  readonly observedAt: string;
  readonly previousContentHash: string;
  readonly currentContentHash: string;
  readonly title: string;
}

export interface DocumentLinkingWarning {
  readonly error: string;
  readonly documentId?: string;
  readonly releaseFamily?: DocumentReleaseFamily;
  readonly referencePeriod?: string;
  readonly reason?:
    | "missing_reference_period"
    | "no_matching_catalyst"
    | "ambiguous_match";
}

export interface DocumentValidationError {
  readonly index: number;
  readonly error: string;
  readonly externalId?: string;
}

/** On-disk cache written by `npm run catalyst:documents:fetch` (gitignored). */
export interface CatalystDocumentsCache {
  readonly kind: "CatalystDocumentsCache";
  readonly schemaVersion: "0.1.0";
  readonly fetchedAt: string;
  readonly requestedWindow: {
    readonly now: string;
    /** Default feed materialization start (now − 30d). */
    readonly feedStart: string;
    readonly feedEnd: string;
  };
  readonly sources: readonly DocumentProviderStatus[];
  /** Full archive retained locally (may exceed the 30-day feed window). */
  readonly documents: OfficialDocument[];
  readonly revisions: DocumentRevisionRecord[];
  readonly validationErrors: DocumentValidationError[];
  readonly linkingWarnings: DocumentLinkingWarning[];
  readonly partialFailure: boolean;
}

export interface RawDocumentItem {
  readonly provider: OfficialDocumentProvider;
  readonly sourceName: string;
  readonly feedUrl: string;
  readonly title: string;
  readonly link: string;
  readonly publishedAtRaw: string;
  readonly summaryFromSource?: string;
  readonly guid?: string;
  readonly itemName?: string;
}

export interface DocumentTypeMapping {
  readonly documentType: OfficialDocumentType;
  readonly releaseFamily: DocumentReleaseFamily;
  readonly sourceName: string;
}
