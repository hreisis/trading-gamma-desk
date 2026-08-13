import {
  ALL_SYMBOLS,
  ASSET_REGISTRY,
  type AssetObservation,
  type Evidence,
  type MacroFeature,
  type MacroSymbol,
} from "@/contracts";
import type { AssetContribution } from "@/macro";
import type { MacroSnapshot } from "@/ingest";
import { assetDisplayName, formatChange, formatZ } from "./format";

function evidenceId(symbol: MacroSymbol): string {
  return `ev_${symbol.toLowerCase()}`;
}

function featureBySymbol(
  features: readonly MacroFeature[],
): Map<MacroSymbol, MacroFeature> {
  return new Map(features.map((f) => [f.symbol, f]));
}

/**
 * Build evidence rows from the snapshot only. Statements are derived from the
 * feature numbers already on the snapshot — this layer does not recompute them.
 */
export function buildEvidence(snapshot: MacroSnapshot): Evidence[] {
  const features = featureBySymbol(snapshot.features);
  const byRole = new Map(
    snapshot.classification.contributions.map((c) => [c.symbol, c]),
  );

  const ranked = [...snapshot.classification.contributions]
    .filter((c) => c.role === "confirming" || c.role === "contradicting")
    .sort(
      (a, b) => Math.abs(b.rawContribution) - Math.abs(a.rawContribution),
    );

  const evidence: Evidence[] = [];
  for (const contribution of ranked) {
    const feature = features.get(contribution.symbol);
    if (!feature || feature.currentChange === null) continue;

    const def = ASSET_REGISTRY[contribution.symbol];
    const against =
      contribution.role === "contradicting"
        ? ", against the dominant pattern"
        : "";

    const sourceDate =
      snapshot.sourceDateByAsset[contribution.symbol] ??
      snapshot.marketSessionDate;
    const basisSuffix = ` · ${sourceDate} session close-to-close`;

    evidence.push({
      id: evidenceId(contribution.symbol),
      symbol: contribution.symbol,
      instrument: def.instrument,
      isProxy: def.isProxy,
      statement: `${assetDisplayName(contribution.symbol)} ${formatChange(
        feature.currentChange,
        feature.unit,
      )} (${formatZ(feature.zScore)})${basisSuffix}${against}`,
      value: feature.currentChange,
      unit: feature.unit,
      zScore: feature.zScore,
      sourceDate:
        snapshot.sourceDateByAsset[contribution.symbol] ??
        snapshot.marketSessionDate,
    });
  }

  // Fallbacks may have no confirming assets — still emit something auditable
  // from whatever printed, so interpretation.evidenceIds can be non-empty.
  if (evidence.length === 0) {
    for (const symbol of ALL_SYMBOLS) {
      const feature = features.get(symbol);
      if (!feature || feature.currentChange === null) continue;
      const def = ASSET_REGISTRY[symbol];
      const sourceDate =
        snapshot.sourceDateByAsset[symbol] ?? snapshot.marketSessionDate;
      const basisSuffix = ` · ${sourceDate} session close-to-close`;
      evidence.push({
        id: evidenceId(symbol),
        symbol,
        instrument: def.instrument,
        isProxy: def.isProxy,
        statement: `${assetDisplayName(symbol)} ${formatChange(
          feature.currentChange,
          feature.unit,
        )} (${formatZ(feature.zScore)})${basisSuffix}`,
        value: feature.currentChange,
        unit: feature.unit,
        zScore: feature.zScore,
        sourceDate:
          snapshot.sourceDateByAsset[symbol] ?? snapshot.marketSessionDate,
      });
      if (evidence.length >= 3) break;
    }
  }

  void byRole;
  return evidence;
}

export function buildAssetObservations(
  snapshot: MacroSnapshot,
): AssetObservation[] {
  const features = featureBySymbol(snapshot.features);
  return ALL_SYMBOLS.map((symbol) => {
    const feature = features.get(symbol)!;
    const contribution = snapshot.classification.contributions.find(
      (c) => c.symbol === symbol,
    )!;
    const def = ASSET_REGISTRY[symbol];
    return {
      symbol,
      instrument: def.instrument,
      isProxy: def.isProxy,
      value: feature.currentChange,
      unit: feature.unit,
      zScore: feature.zScore,
      role: contribution.role,
      contribution: contribution.contribution,
      sourceDate: snapshot.sourceDateByAsset[symbol] ?? null,
      staleDays: snapshot.staleDaysByAsset[symbol] ?? null,
    };
  });
}

export function contradictionIds(
  evidence: readonly Evidence[],
  contributions: readonly AssetContribution[],
): string[] {
  const contradicting = new Set(
    contributions.filter((c) => c.role === "contradicting").map((c) => c.symbol),
  );
  return evidence
    .filter((e) => contradicting.has(e.symbol))
    .map((e) => e.id);
}
