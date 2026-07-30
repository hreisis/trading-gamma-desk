import type {
  EventMarketContext,
  EventMarketReaction,
  MarketContextWindowKind,
  ReactionWindowId,
} from "@/contracts";

export interface ReactionEvidenceItem {
  readonly evidenceId: string;
  readonly kind: string;
  readonly window?: string;
  readonly symbol?: string;
  readonly value: string | number | boolean | null;
  readonly classification?: string;
  readonly baselineTimestamp?: string;
  readonly windowTimestamp?: string;
  readonly sourceContextId: string;
  readonly sourceReactionId: string;
  readonly marketContextIdentity: string;
  readonly marketReactionIdentity: string;
}

export interface ReactionNarratorInputPacket {
  readonly catalystId: string;
  readonly marketContextId: string;
  readonly marketContextIdentity: string;
  readonly marketReactionId: string;
  readonly marketReactionIdentity: string;
  readonly reactionRulesVersion: string;
  readonly eventTimestamp: string;
  readonly provider: string;
  readonly feed: string;
  readonly contextStatus: string;
  readonly reactionStatus: string;
  readonly evidence: readonly ReactionEvidenceItem[];
  readonly limitations: readonly string[];
}

const WINDOW_TO_KIND: Record<ReactionWindowId, MarketContextWindowKind> = {
  "5m": "plus5m",
  "30m": "plus30m",
  "2h": "plus2h",
  session_close: "sessionClose",
};

export function marketReactionIdentity(reaction: EventMarketReaction): string {
  return [
    reaction.id,
    reaction.catalystId,
    reaction.marketContextId,
    reaction.marketContextIdentity,
    reaction.officialFactsIdentity,
    reaction.reactionRulesVersion,
    reaction.status,
  ].join("|");
}

/**
 * Stable evidence pack from M2-4A prices + M2-4B classifications.
 */
export function buildReactionEvidencePack(
  context: EventMarketContext,
  reaction: EventMarketReaction,
  contextIdentity: string,
  reactionIdentity: string,
): ReactionEvidenceItem[] {
  const out: ReactionEvidenceItem[] = [];
  const base = {
    sourceContextId: context.id,
    sourceReactionId: reaction.id,
    marketContextIdentity: contextIdentity,
    marketReactionIdentity: reactionIdentity,
  };

  for (const w of reaction.windows) {
    out.push({
      ...base,
      evidenceId: `reaction:${w.window}:equityBreadth`,
      kind: "equityBreadth",
      window: w.window,
      value: w.equityBreadth,
      classification: w.equityBreadth,
    });
    out.push({
      ...base,
      evidenceId: `reaction:${w.window}:leadership`,
      kind: "leadership",
      window: w.window,
      value: w.equityLeadership.status,
      classification: w.equityLeadership.status,
    });
    if (w.equityLeadership.qqqMinusSpyPct !== undefined) {
      out.push({
        ...base,
        evidenceId: `reaction:${w.window}:qqqMinusSpyPct`,
        kind: "leadershipSpread",
        window: w.window,
        symbol: "QQQ",
        value: w.equityLeadership.qqqMinusSpyPct,
      });
    }
    if (w.equityLeadership.iwmMinusSpyPct !== undefined) {
      out.push({
        ...base,
        evidenceId: `reaction:${w.window}:iwmMinusSpyPct`,
        kind: "leadershipSpread",
        window: w.window,
        symbol: "IWM",
        value: w.equityLeadership.iwmMinusSpyPct,
      });
    }
    out.push({
      ...base,
      evidenceId: `reaction:${w.window}:crossAsset:equities`,
      kind: "crossAsset",
      window: w.window,
      value: w.crossAssetSignature.equities,
      classification: w.crossAssetSignature.equities,
    });
    out.push({
      ...base,
      evidenceId: `reaction:${w.window}:crossAsset:longTreasuryEtf`,
      kind: "crossAsset",
      window: w.window,
      symbol: "TLT",
      value: w.crossAssetSignature.longTreasuryEtf,
      classification: w.crossAssetSignature.longTreasuryEtf,
    });
    out.push({
      ...base,
      evidenceId: `reaction:${w.window}:crossAsset:dollarEtf`,
      kind: "crossAsset",
      window: w.window,
      symbol: "UUP",
      value: w.crossAssetSignature.dollarEtf,
      classification: w.crossAssetSignature.dollarEtf,
    });
    out.push({
      ...base,
      evidenceId: `reaction:${w.window}:crossAsset:goldEtf`,
      kind: "crossAsset",
      window: w.window,
      symbol: "GLD",
      value: w.crossAssetSignature.goldEtf,
      classification: w.crossAssetSignature.goldEtf,
    });

    for (const inst of w.instruments) {
      if (inst.direction === "unavailable" || inst.changePct === undefined) {
        continue;
      }
      const ctxSym = context.symbols.find((s) => s.symbol === inst.symbol);
      const kind = WINDOW_TO_KIND[w.window];
      const ctxWin = ctxSym?.windows.find((x) => x.kind === kind);
      out.push({
        ...base,
        evidenceId: `context:${inst.symbol}:${w.window}:changePct`,
        kind: "changePct",
        window: w.window,
        symbol: inst.symbol,
        value: inst.changePct,
        classification: inst.direction,
        baselineTimestamp: inst.sourceBaselineTimestamp,
        windowTimestamp:
          inst.sourceWindowTimestamp ?? ctxWin?.barTimestamp,
      });
    }
  }

  out.push({
    ...base,
    evidenceId: "development:from5mTo30m",
    kind: "development",
    value: reaction.development.from5mTo30m,
    classification: reaction.development.from5mTo30m,
  });
  out.push({
    ...base,
    evidenceId: "development:from30mTo2h",
    kind: "development",
    value: reaction.development.from30mTo2h,
    classification: reaction.development.from30mTo2h,
  });
  out.push({
    ...base,
    evidenceId: "development:intoSessionClose",
    kind: "development",
    value: reaction.development.intoSessionClose,
    classification: reaction.development.intoSessionClose,
  });

  for (const [symbol, path] of Object.entries(reaction.development.bySymbol)) {
    out.push({
      ...base,
      evidenceId: `development:${symbol}:shortToMedium`,
      kind: "development",
      symbol,
      value: path.shortToMedium,
      classification: path.shortToMedium,
    });
    out.push({
      ...base,
      evidenceId: `development:${symbol}:mediumToClose`,
      kind: "development",
      symbol,
      value: path.mediumToClose,
      classification: path.mediumToClose,
    });
  }

  return out;
}

export function buildReactionNarratorPacket(
  context: EventMarketContext,
  reaction: EventMarketReaction,
  contextIdentity: string,
  reactionIdentity: string,
): ReactionNarratorInputPacket {
  return {
    catalystId: reaction.catalystId,
    marketContextId: context.id,
    marketContextIdentity: contextIdentity,
    marketReactionId: reaction.id,
    marketReactionIdentity: reactionIdentity,
    reactionRulesVersion: reaction.reactionRulesVersion,
    eventTimestamp: reaction.eventTimestamp,
    provider: reaction.provider,
    feed: reaction.feed,
    contextStatus: context.status,
    reactionStatus: reaction.status,
    evidence: buildReactionEvidencePack(
      context,
      reaction,
      contextIdentity,
      reactionIdentity,
    ),
    limitations: reaction.limitations,
  };
}
