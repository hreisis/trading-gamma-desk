import { z } from "zod";
import { readJson, writeJson, type RuntimeJsonStore } from "./runtime-store";
import { summarizeVolMispricing, type VolMispricingSummary } from "./format-gamma";
import type { V2GammaSummary } from "./v2-command-center";

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const IsoDateTime = z.string().datetime({ offset: true });

export const ManualGammaSymbolInput = z.object({
  spot: z.number().finite().positive(),
  netGexBillions: z.number().finite(),
  gammaFlip: z.number().finite().positive(),
  callWall: z.number().finite().positive(),
  putWall: z.number().finite().positive(),
  iv30Pct: z.number().finite().positive(),
});

export const ManualGammaSnapshot = z.object({
  kind: z.literal("ManualGammaSnapshot"),
  schemaVersion: z.literal("0.1.0"),
  marketSessionDate: IsoDate,
  savedAt: IsoDateTime,
  source: z.string().min(1),
  priceAsOf: IsoDateTime,
  oiAsOf: IsoDate,
  notes: z.string(),
  symbols: z.object({
    SPY: ManualGammaSymbolInput,
    QQQ: ManualGammaSymbolInput,
  }),
});

export type ManualGammaSnapshot = z.infer<typeof ManualGammaSnapshot>;
export type ManualGammaSymbolInput = z.infer<typeof ManualGammaSymbolInput>;

export function manualGammaRelativePath(marketSessionDate: string): string {
  return `manual-gamma/${marketSessionDate}.json`;
}

export async function loadManualGammaSnapshot(
  store: RuntimeJsonStore,
  marketSessionDate: string,
): Promise<ManualGammaSnapshot | null> {
  const raw = await readJson(store, manualGammaRelativePath(marketSessionDate));
  if (raw === null) return null;
  const parsed = ManualGammaSnapshot.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export async function saveManualGammaSnapshot(
  store: RuntimeJsonStore,
  snapshot: ManualGammaSnapshot,
): Promise<boolean> {
  return writeJson(
    store,
    manualGammaRelativePath(snapshot.marketSessionDate),
    snapshot,
    { allowOverwrite: true },
  );
}

export async function listManualGammaSnapshots(
  store: RuntimeJsonStore,
): Promise<readonly ManualGammaSnapshot[]> {
  const paths = await store.list("manual-gamma");
  const rows: ManualGammaSnapshot[] = [];
  for (const path of paths) {
    if (!path.endsWith(".json")) continue;
    const raw = await readJson(store, path);
    const parsed = ManualGammaSnapshot.safeParse(raw);
    if (parsed.success) rows.push(parsed.data);
  }
  return rows.sort((a, b) => b.marketSessionDate.localeCompare(a.marketSessionDate));
}

function regimeFromNetGex(netGexBillions: number): "positive" | "negative" | "near_zero" {
  if (netGexBillions > 0) return "positive";
  if (netGexBillions < 0) return "negative";
  return "near_zero";
}

function dealerFlowLabel(regime: "positive" | "negative" | "near_zero"): string {
  if (regime === "positive") return "Stabilizing / mean-reverting dealer flow";
  if (regime === "negative") return "Amplifying / trend-following dealer flow";
  return "Transition · dealer hedging near neutral";
}

function contextLines(input: ManualGammaSymbolInput, regime: "positive" | "negative" | "near_zero"): readonly string[] {
  const lines: string[] = [];
  if (input.spot > input.callWall) lines.push("Above Call Wall → upside chase risk");
  if (input.spot < input.putWall) lines.push("Below Put Wall → downside flush risk");
  if (input.spot < input.gammaFlip) lines.push("Below Gamma Flip → volatility expansion risk");
  if (input.spot > input.gammaFlip && regime === "negative") {
    lines.push("Above Gamma Flip → trend amplification zone");
  }
  return lines;
}

export function buildManualGammaSummary(input: {
  readonly snapshot: ManualGammaSnapshot;
  readonly symbol: "SPY" | "QQQ";
  readonly hv20Bars?: readonly { readonly sessionDate: string; readonly close: number }[];
}): V2GammaSummary {
  const row = input.snapshot.symbols[input.symbol];
  const regime = regimeFromNetGex(row.netGexBillions);
  const volMispricing: VolMispricingSummary = summarizeVolMispricing({
    representativeIv: {
      status: "available",
      value: row.iv30Pct / 100,
      sessionDate: input.snapshot.marketSessionDate,
    },
    hv20Bars: input.hv20Bars,
    isFixture: false,
  });

  return {
    symbol: input.symbol,
    status: "ready",
    freshness: "fresh",
    sessionDate: input.snapshot.marketSessionDate,
    expiration: null,
    spot: row.spot,
    putWall: row.putWall,
    callWall: row.callWall,
    gammaFlip: row.gammaFlip,
    netGex: row.netGexBillions * 1e9,
    regime,
    dataLabel: `Manual ${input.snapshot.source} · ${input.snapshot.marketSessionDate}`,
    dealerFlowRegime: dealerFlowLabel(regime),
    contextLines: contextLines(row, regime),
    callWallTouch: { status: "unavailable", percent: null },
    putWallTouch: { status: "unavailable", percent: null },
    restOfDayRange: { status: "unavailable", lower: null, upper: null, confidencePct: null },
    volMispricing,
    quality: `manual · ${input.snapshot.source} · price ${input.snapshot.priceAsOf} · OI ${input.snapshot.oiAsOf}`,
    source: `Manual (${input.snapshot.source})`,
    isFixture: false,
  };
}
