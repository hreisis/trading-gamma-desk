import type {
  Catalyst,
  CatalystCategory,
  CatalystDirection,
  CatalystImportance,
  CatalystMacroChannel,
  CatalystSourceType,
  CatalystStatus,
} from "@/contracts";

/**
 * Raw upstream-shaped event before canonicalization.
 * M2-1 only ingests synthetic fixtures of this shape.
 */
export interface CatalystRawEvent {
  readonly kind?: string;
  readonly synthetic?: boolean;
  readonly externalId?: string;
  readonly occurredAt?: string;
  readonly observedAt?: string;
  readonly sourceType?: string;
  readonly sourceName?: string;
  readonly sourceUrl?: string | null;
  readonly headline?: string;
  readonly summary?: string;
  readonly rawCategory?: string;
  readonly rawStatus?: string;
  readonly rawImportance?: string;
  readonly rawDirection?: string;
  readonly affectedAssets?: readonly string[];
  readonly macroChannels?: readonly string[];
  readonly evidenceStatements?: readonly string[];
  /** When set, replaces a prior event with the same dedupe/external identity. */
  readonly supersedesExternalId?: string;
}

export interface NormalizeOk {
  readonly ok: true;
  readonly catalyst: Catalyst;
}

export interface NormalizeErr {
  readonly ok: false;
  readonly error: string;
  readonly path?: string;
  readonly raw?: unknown;
}

export type NormalizeResult = NormalizeOk | NormalizeErr;

export interface CatalystQuery {
  readonly category?: CatalystCategory;
  readonly status?: CatalystStatus;
  readonly importance?: CatalystImportance;
  readonly affectedAsset?: string;
  readonly start?: string;
  readonly end?: string;
}

export interface CatalystFeedResponse {
  readonly kind: "CatalystFeed";
  readonly schemaVersion: "0.1.0";
  readonly generatedAt: string;
  readonly mode: "synthetic_demo";
  readonly isPublicDemo: boolean;
  readonly banner: string;
  readonly disclaimer: string;
  readonly source: {
    readonly type: "fixture";
    readonly name: string;
    readonly synthetic: true;
  };
  readonly count: number;
  readonly catalysts: Catalyst[];
  readonly validationErrors: Array<{
    readonly index: number;
    readonly error: string;
    readonly externalId?: string;
  }>;
}

export type {
  Catalyst,
  CatalystCategory,
  CatalystDirection,
  CatalystImportance,
  CatalystMacroChannel,
  CatalystSourceType,
  CatalystStatus,
};
