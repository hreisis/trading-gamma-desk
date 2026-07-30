import { existsSync, readFileSync, rmSync } from "node:fs";
import { RegimeSignatureConfig } from "@/contracts";
import { lookbackStart } from "./dates";
import { fetchTreasuryYields } from "./treasury";
import { fetchVix } from "./cboe";
import { fetchTiingoBtc, fetchTiingoEtf } from "./tiingo";
import { assembleSnapshot, type MacroSnapshot } from "./assemble";
import {
  writeBars,
  writeSnapshot,
  snapshotPath,
  DEFAULT_DATA_ROOT,
} from "./store";
import type { FetchLike } from "./http";
import type { SymbolSeries } from "./types";

const DEFAULT_LOOKBACK_DAYS = 75;
const DEFAULT_SIGNATURE =
  "fixtures/macro/regime-signature.sig-2026-07-01.json";

export interface IngestRunOptions {
  readonly endDate?: string;
  readonly lookbackDays?: number;
  readonly dataRoot?: string;
  readonly signaturePath?: string;
  readonly token?: string;
  readonly fetchImpl?: FetchLike;
  readonly todayUtc?: string;
  /** When true, replace an existing snapshot for the same session. */
  readonly force?: boolean;
}

export interface IngestRunResult {
  readonly snapshot: MacroSnapshot;
  readonly snapshotPath: string;
  readonly barPaths: string[];
}

function loadSignature(path: string): RegimeSignatureConfig {
  return RegimeSignatureConfig.parse(
    JSON.parse(readFileSync(path, "utf8")),
  );
}

/**
 * Pull every M1 source, persist raw bars, assemble features + classification,
 * and write an immutable compute snapshot. Network IO is confined here; the
 * rest of the pipeline stays pure.
 */
export async function runMacroIngest(
  options: IngestRunOptions = {},
): Promise<IngestRunResult> {
  const endDate = options.endDate ?? new Date().toISOString().slice(0, 10);
  const lookbackDays = options.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const startDate = lookbackStart(endDate, lookbackDays);
  const dataRoot = options.dataRoot ?? DEFAULT_DATA_ROOT;
  const config = loadSignature(options.signaturePath ?? DEFAULT_SIGNATURE);

  const treasury = await fetchTreasuryYields(startDate, endDate, {
    fetchImpl: options.fetchImpl,
  });
  const vix = await fetchVix(startDate, endDate, {
    fetchImpl: options.fetchImpl,
  });

  const etfSymbols = ["GOLD", "COPPER", "OIL", "USD"] as const;
  const etfs: SymbolSeries[] = [];
  for (const symbol of etfSymbols) {
    etfs.push(
      await fetchTiingoEtf(symbol, startDate, endDate, {
        token: options.token,
        fetchImpl: options.fetchImpl,
      }),
    );
  }

  const btc = await fetchTiingoBtc(startDate, endDate, {
    token: options.token,
    fetchImpl: options.fetchImpl,
    todayUtc: options.todayUtc,
  });

  const seriesList: SymbolSeries[] = [
    treasury.us2y,
    treasury.us10y,
    vix,
    ...etfs,
    btc,
  ];

  const barPaths = seriesList.map((series) => writeBars(series, dataRoot));
  const snapshot = assembleSnapshot(seriesList, config);
  const path = snapshotPath(dataRoot, snapshot.marketSessionDate);
  if (options.force && existsSync(path)) {
    rmSync(path);
  }
  const written = writeSnapshot(
    snapshot.marketSessionDate,
    snapshot,
    dataRoot,
  );

  return { snapshot, snapshotPath: written, barPaths };
}
