import type { CatalystRawEvent } from "../types";
import type { OfficialCalendarSourceId } from "../registry";

export type ProviderFetchStatus = "ok" | "error";

export interface ProviderSourceMeta {
  readonly id: OfficialCalendarSourceId;
  readonly name: string;
  readonly url: string;
  readonly status: ProviderFetchStatus;
  readonly error?: string;
  readonly rawEventCount?: number;
  readonly mappedEventCount?: number;
}

export interface ProviderParseResult {
  readonly source: ProviderSourceMeta;
  readonly rawEvents: CatalystRawEvent[];
}

export type FetchLike = (
  url: string,
  init?: RequestInit,
) => Promise<Response>;
