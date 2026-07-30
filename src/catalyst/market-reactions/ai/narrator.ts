import type { AiMarketReactionNarratorOutput } from "@/contracts";
import type { ReactionNarratorInputPacket } from "./evidence";

export interface ReactionNarratorUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
}

export type ReactionNarratorResult =
  | {
      readonly ok: true;
      readonly output: AiMarketReactionNarratorOutput;
      readonly provider: string;
      readonly model: string;
      readonly usage?: ReactionNarratorUsage;
    }
  | {
      readonly ok: false;
      readonly provider: string;
      readonly model: string;
      readonly error: string;
      readonly unavailable?: boolean;
    };

export interface MarketReactionNarrator {
  readonly providerId: string;
  narrate(packet: ReactionNarratorInputPacket): Promise<ReactionNarratorResult>;
}
