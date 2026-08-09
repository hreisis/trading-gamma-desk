import type { EtfUniverseArtifact } from "@/contracts/etf-universe-artifact";
import { isServerlessHost } from "@/desk/production-runtime";
import { SPY_HOLDINGS_SOURCE_URL } from "../config";
import { readXlsxSheet1Matrix } from "../holdings/parse-xlsx";
import { parseSpyHoldingsMatrix } from "../holdings/parse-spy-holdings";
import {
  applyUniverseFreshness,
  loadPersistedSpyUniverse,
  persistSpyUniverseArtifact,
} from "./persist";

export interface LoadSpyUniverseOptions {
  readonly fetchedAt: string;
  readonly targetMarketSessionDate: string;
  readonly dataRoot?: string;
  readonly fetchImpl?: typeof fetch;
  readonly allowPersistedFallback?: boolean;
  readonly env?: Record<string, string | undefined>;
  /**
   * When false, a successful official fetch returns an in-memory artifact only.
   * Defaults to false on Vercel/serverless hosts; true for local development.
   */
  readonly persistToFilesystem?: boolean;
  /** Test injection override for official holdings fetch. */
  readonly fetchSpyHoldings?: typeof fetchSpyHoldingsFromOfficial;
}

export interface LoadSpyUniverseResult {
  readonly artifact: EtfUniverseArtifact | null;
  readonly source: "network" | "persisted" | "none";
  readonly error: string | null;
}

export async function fetchSpyHoldingsFromOfficial(
  fetchedAt: string,
  fetchImpl: typeof fetch = fetch,
): Promise<EtfUniverseArtifact> {
  const response = await fetchImpl(SPY_HOLDINGS_SOURCE_URL, {
    headers: { Accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  });
  if (!response.ok) {
    throw new Error(`SPY holdings HTTP ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    throw new Error("SPY holdings response is not a valid XLSX zip archive");
  }
  const rows = readXlsxSheet1Matrix(buffer);
  return parseSpyHoldingsMatrix({
    rows,
    fetchedAt,
    sourceUrl: SPY_HOLDINGS_SOURCE_URL,
  });
}

export async function loadSpyUniverse(
  options: LoadSpyUniverseOptions,
): Promise<LoadSpyUniverseResult> {
  const dataRoot = options.dataRoot ?? "data";
  const fetchImpl = options.fetchImpl ?? fetch;
  const env = options.env ?? process.env;
  const persistToFilesystem =
    options.persistToFilesystem ??
    !isServerlessHost(env as NodeJS.ProcessEnv);
  const fetchSpy = options.fetchSpyHoldings ?? fetchSpyHoldingsFromOfficial;

  try {
    const artifact = await fetchSpy(
      options.fetchedAt,
      fetchImpl,
    );
    if (persistToFilesystem) {
      persistSpyUniverseArtifact(artifact, dataRoot);
    }
    return {
      artifact: applyUniverseFreshness(
        artifact,
        options.targetMarketSessionDate,
      ),
      source: "network",
      error: null,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (options.allowPersistedFallback !== false) {
      const persisted = loadPersistedSpyUniverse(dataRoot);
      if (persisted) {
        return {
          artifact: applyUniverseFreshness(
            persisted,
            options.targetMarketSessionDate,
          ),
          source: "persisted",
          error: message,
        };
      }
    }
    return { artifact: null, source: "none", error: message };
  }
}
