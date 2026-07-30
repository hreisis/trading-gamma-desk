import type { MacroSymbol } from "@/contracts";

/**
 * One session observation as stored after ingest. The value is already in the
 * unit the feature layer expects: percent yield for rates, adjClose for ETF
 * proxies, close for BTC. No forward-fill: absence is simply no row.
 */
export interface RawBar {
  readonly sessionDate: string;
  readonly value: number;
  readonly source: string;
  /** Vendor's raw date string, kept for audit of the slice rule. */
  readonly rawDate: string;
}

export interface SymbolSeries {
  readonly symbol: MacroSymbol;
  readonly instrument: string;
  readonly isProxy: boolean;
  readonly source: string;
  readonly bars: readonly RawBar[];
}

export interface ValidatedResponse {
  readonly status: number;
  readonly contentType: string;
  readonly body: string;
}

export class IngestError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "IngestError";
    this.code = code;
  }
}
