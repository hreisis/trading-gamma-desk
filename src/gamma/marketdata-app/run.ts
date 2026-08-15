import {
  BoundedGammaProviderSnapshot,
  BOUNDED_GAMMA_PROVIDER_SCHEMA_VERSION,
  BOUNDED_GAMMA_SCOPE,
  type BoundedGammaProviderSnapshot as BoundedGammaProviderSnapshotDto,
  type BoundedWallLevel,
} from "@/contracts";
import { writeJsonAtomic } from "@/desk/atomic-write";
import { writeJson, type RuntimeJsonStore } from "@/desk/runtime-store";
import type { FetchLike } from "@/ingest/http";
import { computeEstimatedGammaStructure } from "../compute";
import { extractRepresentativeIvFromChain } from "../aggregate";
import { grossGex } from "../gex";
import { resolveMarketDataApiToken } from "./config";
import {
  isMarketDataCreditLimitExhausted,
  markMarketDataCreditsExhausted,
} from "./credits";
import { fetchBoundedMarketDataAppChain } from "./fetch";
import { MarketDataAppNormalizeError } from "./errors";
import { normalizeMarketDataAppChain } from "./normalize";
import {
  boundedGammaArtifactRelativePath,
  boundedGammaLatestPath,
  DEFAULT_BOUNDED_GAMMA_DATA_ROOT,
} from "./paths";
import {
  MarketDataAppStrikeError,
  planBoundedStrikeRange,
  type StrikeRangePlan,
} from "./strikes";
import {
  calendarDte,
  extractVendorUpdatedRange,
  sessionDateFromIso,
} from "./time";

export type BoundedGammaRunOutcome =
  | {
      readonly ok: true;
      readonly snapshot: BoundedGammaProviderSnapshotDto;
      readonly path: string | null;
      readonly requestPath: string;
    }
  | {
      readonly ok: false;
      readonly error: string;
      readonly code: string;
      readonly path: null;
      readonly wrote: false;
    };

export interface RunBoundedGammaProviderInput {
  readonly symbol: string;
  readonly expiration: string;
  readonly strikeMin: number;
  readonly strikeMax: number;
  readonly strikeStep?: number;
  readonly maxExpectedContracts?: number;
  readonly allowAboveCap?: boolean;
  readonly write?: boolean;
  readonly dataRoot?: string;
  readonly token?: string | null;
  readonly env?: NodeJS.ProcessEnv;
  readonly fetchImpl?: FetchLike;
  readonly baseUrl?: string;
  readonly generatedAt?: string;
  readonly fetchedAt?: string;
  readonly sessionDate?: string;
  readonly synthetic?: boolean;
  readonly artifactStore?: RuntimeJsonStore;
}

const SCOPE_LIMITATION =
  "BOUNDED single-expiry strike sample — not full-chain market walls. Call/Put walls are boundedCallWall/boundedPutWall only.";

function toBoundedWall(
  wall: {
    status: BoundedWallLevel["status"];
    strike?: number;
    gex?: number;
    reason?: string;
  },
): BoundedWallLevel {
  return {
    ...wall,
    scope: BOUNDED_GAMMA_SCOPE,
  };
}

function toBoundedFlip(
  flip: {
    status: "available";
    strike: number;
    level: number;
    method: "spot_shock_bs_gamma";
    lowerStrike?: number;
    upperStrike?: number;
  } | {
    status: "unavailable";
    reason: string;
    lowerStrike?: number;
    upperStrike?: number;
    level?: number;
  },
): BoundedGammaProviderSnapshotDto["gammaFlip"] {
  return {
    ...flip,
    scope: BOUNDED_GAMMA_SCOPE,
  };
}

function returnedStrikeRange(
  byStrike: readonly { strike: number }[],
): { min: number | null; max: number | null } {
  if (byStrike.length === 0) return { min: null, max: null };
  const strikes = byStrike.map((s) => s.strike);
  return { min: Math.min(...strikes), max: Math.max(...strikes) };
}

function containsSecret(text: string, token: string | null): boolean {
  if (!token || token.length === 0) return false;
  return text.includes(token);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function vendorStatusFailure(
  body: unknown,
  httpStatus: number,
): { code: string; error: string } | null {
  if (!isRecord(body)) {
    if (httpStatus === 401 || httpStatus === 403) {
      return {
        code: "auth",
        error: `MarketData.app HTTP ${httpStatus}: check MARKETDATA_API_TOKEN`,
      };
    }
    return null;
  }

  const status = body.s;
  if (status === "ok") return null;
  if (status === "no_data") {
    return { code: "no_data", error: "MarketData.app s=no_data" };
  }
  if (status === "error") {
    const detail =
      typeof body.errmsg === "string" && body.errmsg.length > 0
        ? body.errmsg
        : "vendor error";
    if (httpStatus === 401 || httpStatus === 403) {
      return {
        code: "auth",
        error: `${detail} (HTTP ${httpStatus})`,
      };
    }
    return { code: "vendor_status", error: detail };
  }
  if (httpStatus === 401 || httpStatus === 403) {
    return {
      code: "auth",
      error: `MarketData.app HTTP ${httpStatus}: check MARKETDATA_API_TOKEN`,
    };
  }
  if (status !== undefined) {
    return {
      code: "vendor_status",
      error: `MarketData.app unexpected s=${String(status)}`,
    };
  }
  return null;
}

/**
 * Fetch one bounded MarketData.app chain → normalize → quality → Gamma Engine → snapshot.
 * Does not write on failure. Never logs or serializes the API token.
 */
export async function runBoundedGammaProvider(
  input: RunBoundedGammaProviderInput,
): Promise<BoundedGammaRunOutcome> {
  const token =
    input.token !== undefined
      ? input.token
      : resolveMarketDataApiToken(input.env ?? process.env);

  if (!token) {
    return {
      ok: false,
      code: "missing_token",
      error:
        "MARKETDATA_API_TOKEN (or MARKETDATA_APP_TOKEN) is missing — bounded gamma fetch unavailable",
      path: null,
      wrote: false,
    };
  }

  let plan: StrikeRangePlan;
  try {
    plan = planBoundedStrikeRange({
      strikeMin: input.strikeMin,
      strikeMax: input.strikeMax,
      strikeStep: input.strikeStep,
      maxExpectedContracts: input.maxExpectedContracts,
      allowAboveCap: input.allowAboveCap,
    });
  } catch (e) {
    const code =
      e instanceof MarketDataAppStrikeError ? e.code : "invalid_range";
    return {
      ok: false,
      code,
      error: e instanceof Error ? e.message : String(e),
      path: null,
      wrote: false,
    };
  }

  let fetchResult;
  try {
    fetchResult = await fetchBoundedMarketDataAppChain({
      symbol: input.symbol,
      expiration: input.expiration,
      strikes: plan.strikes,
      date: input.sessionDate,
      token,
      fetchImpl: input.fetchImpl,
      baseUrl: input.baseUrl,
    });
  } catch (e) {
    return {
      ok: false,
      code: "fetch_failed",
      error: e instanceof Error ? e.message : String(e),
      path: null,
      wrote: false,
    };
  }

  if (containsSecret(fetchResult.requestPath, token)) {
    return {
      ok: false,
      code: "token_leak",
      error: "refusing to continue: request path unexpectedly contained token",
      path: null,
      wrote: false,
    };
  }

  if (
    isMarketDataCreditLimitExhausted({
      httpStatus: fetchResult.httpStatus,
      body: fetchResult.body,
    })
  ) {
    markMarketDataCreditsExhausted();
    const detail =
      isRecord(fetchResult.body) &&
      typeof fetchResult.body.errmsg === "string" &&
      fetchResult.body.errmsg.length > 0
        ? fetchResult.body.errmsg
        : `MarketData.app HTTP ${fetchResult.httpStatus}: daily API credit limit exhausted`;
    return {
      ok: false,
      code: "credit_limit",
      error: detail,
      path: null,
      wrote: false,
    };
  }

  const vendorFailure = vendorStatusFailure(
    fetchResult.body,
    fetchResult.httpStatus,
  );
  if (vendorFailure) {
    return {
      ok: false,
      code: vendorFailure.code,
      error: vendorFailure.error,
      path: null,
      wrote: false,
    };
  }

  let updatedRange;
  try {
    updatedRange = extractVendorUpdatedRange(fetchResult.body);
  } catch (e) {
    return {
      ok: false,
      code: "missing_asof",
      error: e instanceof Error ? e.message : String(e),
      path: null,
      wrote: false,
    };
  }

  let sessionDate: string;
  let dte: number;
  try {
    sessionDate = sessionDateFromIso(updatedRange.maxIso);
    dte = calendarDte(sessionDate, input.expiration);
  } catch (e) {
    return {
      ok: false,
      code: "time_semantics",
      error: e instanceof Error ? e.message : String(e),
      path: null,
      wrote: false,
    };
  }

  const fetchedAt = input.fetchedAt ?? new Date().toISOString();
  const generatedAt = input.generatedAt ?? fetchedAt;

  let chain;
  try {
    chain = normalizeMarketDataAppChain({
      httpStatus: fetchResult.httpStatus,
      body: fetchResult.body,
      sessionDate,
      fetchedAt,
      dataDelay: "unknown",
      sourceName: `marketdata.app/options/chain/${input.symbol.toUpperCase()} bounded`,
      synthetic: input.synthetic ?? false,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const code =
      e instanceof MarketDataAppNormalizeError ? e.code : "normalize_failed";
    return {
      ok: false,
      code,
      error: msg,
      path: null,
      wrote: false,
    };
  }

  const structure = computeEstimatedGammaStructure(chain);
  const gross = grossGex(structure.byStrike);
  const strikeReturned = returnedStrikeRange(structure.byStrike);
  const representativeIvExtract = extractRepresentativeIvFromChain(chain);

  const limitations = [
    SCOPE_LIMITATION,
    ...structure.limitations,
  ];

  const snapshot = BoundedGammaProviderSnapshot.parse({
    kind: "BoundedGammaProviderSnapshot",
    schemaVersion: BOUNDED_GAMMA_PROVIDER_SCHEMA_VERSION,
    symbol: input.symbol.toUpperCase(),
    source: {
      provider: "marketdata_app",
      name: chain.source.name,
      fetchedAt: chain.source.fetchedAt,
    },
    generatedAt,
    vendorAsOf: chain.asOf,
    vendorUpdatedMin: updatedRange.minIso,
    vendorUpdatedMax: updatedRange.maxIso,
    sessionDate,
    expiration: input.expiration,
    dte,
    zeroDte: structure.zeroDte,
    spot: structure.spot,
    strikeRequest: {
      min: plan.strikeMin,
      max: plan.strikeMax,
      step: plan.strikeStep,
      strikeCount: plan.strikeCount,
      estimatedMaxContracts: plan.estimatedMaxContracts,
    },
    strikeReturned,
    scope: BOUNDED_GAMMA_SCOPE,
    httpStatus: fetchResult.httpStatus,
    credits: {
      consumed: fetchResult.creditsConsumed,
      remaining: fetchResult.creditsRemaining,
    },
    status: structure.status,
    limitations,
    totalGex: structure.totalGex,
    grossGex: gross,
    gammaRegime: structure.gammaRegime,
    boundedCallWall: toBoundedWall(structure.callWall),
    boundedPutWall: toBoundedWall(structure.putWall),
    gammaFlip: toBoundedFlip(structure.gammaFlip),
    byStrike: structure.byStrike,
    byExpiry: structure.byExpiry,
    coverage: structure.coverage,
    synthetic: structure.synthetic,
    representativeIv: {
      status: representativeIvExtract.status,
      value: representativeIvExtract.value,
      sessionDate,
      asOf: chain.asOf,
    },
  });

  const serialized = JSON.stringify(snapshot);
  if (containsSecret(serialized, token)) {
    return {
      ok: false,
      code: "token_leak",
      error: "refusing to write: snapshot serialization contained token",
      path: null,
      wrote: false,
    };
  }

  const dataRoot = input.dataRoot ?? DEFAULT_BOUNDED_GAMMA_DATA_ROOT;
  const path = boundedGammaLatestPath(input.symbol, dataRoot);
  const artifactRelativePath = boundedGammaArtifactRelativePath(input.symbol);

  if (input.write !== false) {
    if (input.artifactStore) {
      await writeJson(input.artifactStore, artifactRelativePath, snapshot, {
        allowOverwrite: true,
      });
    } else {
      writeJsonAtomic(path, snapshot);
    }
  }

  return {
    ok: true,
    snapshot,
    path: input.write === false ? null : path,
    requestPath: fetchResult.requestPath,
  };
}
