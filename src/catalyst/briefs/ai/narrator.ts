import type { AiNarratorOutput } from "@/contracts";

export interface NarratorFactInput {
  readonly id: string;
  readonly label: string;
  readonly text: string;
  readonly factType: string;
  readonly values?: ReadonlyArray<{
    readonly metric: string;
    readonly value: number;
    readonly unit: string;
    readonly period?: string;
  }>;
  readonly evidenceExcerpt: string;
  readonly crossCheck?: {
    readonly status: "matched" | "mismatch";
    readonly structuredMetric: string;
    readonly structuredActual: number;
  };
}

export interface NarratorInputPacket {
  readonly briefId: string;
  readonly documentId: string;
  readonly documentContentHash: string;
  readonly extractorVersion: string;
  readonly releaseFamily: string;
  readonly referencePeriod?: string;
  readonly status: "complete" | "partial" | "unavailable";
  readonly provider: string;
  readonly sourceName: string;
  readonly publishedAt: string;
  readonly facts: readonly NarratorFactInput[];
  readonly omissions: readonly string[];
  readonly warnings: readonly string[];
}

export interface NarratorUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
}

export type NarratorResult =
  | {
      readonly ok: true;
      readonly output: AiNarratorOutput;
      readonly provider: string;
      readonly model: string;
      readonly usage?: NarratorUsage;
    }
  | {
      readonly ok: false;
      readonly provider: string;
      readonly model: string;
      readonly error: string;
      readonly unavailable?: boolean;
    };

export interface BriefNarrator {
  readonly providerId: string;
  narrate(packet: NarratorInputPacket): Promise<NarratorResult>;
}
