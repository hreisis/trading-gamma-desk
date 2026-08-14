import type { EtfUniverseArtifact } from "@/contracts/etf-universe-artifact";
import { isServerlessHost } from "@/desk/production-runtime";
import { QQQ_HOLDINGS_SOURCE_URL } from "../config";
import {
  parseQqqHoldingsPayload,
  type InvescoQqqHoldingsPayload,
} from "../holdings/parse-qqq-holdings";
import {
  applyUniverseFreshness,
  loadPersistedUniverse,
  persistUniverseArtifact,
} from "./persist";

export interface LoadQqqUniverseOptions {
  readonly fetchedAt: string;
  readonly targetMarketSessionDate: string;
  readonly dataRoot?: string;
  readonly fetchImpl?: typeof fetch;
  readonly allowPersistedFallback?: boolean;
  readonly env?: Record<string, string | undefined>;
  readonly persistToFilesystem?: boolean;
  readonly fetchQqqHoldings?: typeof fetchQqqHoldingsFromOfficial;
}

export interface LoadQqqUniverseResult {
  readonly artifact: EtfUniverseArtifact | null;
  readonly source: "network" | "persisted" | "none";
  readonly error: string | null;
}

export async function fetchQqqHoldingsFromOfficial(
  fetchedAt: string,
  fetchImpl: typeof fetch = fetch,
): Promise<EtfUniverseArtifact> {
  const response = await fetchImpl(QQQ_HOLDINGS_SOURCE_URL, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`QQQ holdings HTTP ${response.status}`);
  }
  const payload = (await response.json()) as InvescoQqqHoldingsPayload;
  return parseQqqHoldingsPayload({
    payload,
    fetchedAt,
    sourceUrl: QQQ_HOLDINGS_SOURCE_URL,
  });
}

export async function loadQqqUniverse(
  options: LoadQqqUniverseOptions,
): Promise<LoadQqqUniverseResult> {
  const dataRoot = options.dataRoot ?? "data";
  const fetchImpl = options.fetchImpl ?? fetch;
  const env = options.env ?? process.env;
  const persistToFilesystem =
    options.persistToFilesystem ??
    !isServerlessHost(env as NodeJS.ProcessEnv);
  const fetchQqq = options.fetchQqqHoldings ?? fetchQqqHoldingsFromOfficial;

  try {
    const artifact = await fetchQqq(options.fetchedAt, fetchImpl);
    if (persistToFilesystem) {
      persistUniverseArtifact(artifact, dataRoot);
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
      const persisted = loadPersistedUniverse(dataRoot, "QQQ");
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
