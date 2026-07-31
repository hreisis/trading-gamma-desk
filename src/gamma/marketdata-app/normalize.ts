import type { GammaDataDelay } from "@/contracts";
import type {
  ChainDataQuality,
  ContractQualityAudit,
  OptionsChainSnapshot,
  OptionsContract,
  OptionRight,
} from "../types";
import { MarketDataAppNormalizeError } from "./errors";
import {
  assessContractQuality,
  buildChainDataQuality,
} from "./quality";
import {
  MARKETDATA_APP_CHAIN_ARRAY_FIELDS,
  MARKETDATA_APP_OPTIONAL_ARRAY_FIELDS,
  type MarketDataAppChainArrayField,
} from "./types";

export const MARKETDATA_APP_OPTIONS_MULTIPLIER = 100;

/** Relative spot tolerance (0.01%) with a one-cent floor. */
export const MARKETDATA_APP_SPOT_TOLERANCE_REL = 1e-4;
export const MARKETDATA_APP_SPOT_TOLERANCE_ABS = 0.01;

export interface NormalizeMarketDataAppChainInput {
  readonly httpStatus: number;
  readonly body: unknown;
  readonly sessionDate: string;
  readonly fetchedAt: string;
  readonly dataDelay?: GammaDataDelay;
  readonly sourceName?: string;
  readonly synthetic?: boolean;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function assertHttpSuccess(status: number): void {
  if (status < 200 || status >= 300) {
    throw new MarketDataAppNormalizeError(
      "http_status",
      `MarketData.app HTTP ${status}: expected 2xx`,
    );
  }
}

function assertVendorStatus(body: Record<string, unknown>): void {
  const status = body.s;
  if (status === "ok") {
    return;
  }
  if (status === "no_data") {
    throw new MarketDataAppNormalizeError(
      "vendor_status",
      "MarketData.app s=no_data",
    );
  }
  if (status === "error") {
    const detail =
      typeof body.errmsg === "string" && body.errmsg.length > 0
        ? body.errmsg
        : "vendor error";
    throw new MarketDataAppNormalizeError("vendor_status", detail);
  }
  throw new MarketDataAppNormalizeError(
    "vendor_status",
    `MarketData.app unexpected s=${String(status)}`,
  );
}

function readArrayField(
  body: Record<string, unknown>,
  field: MarketDataAppChainArrayField,
): unknown[] {
  const value = body[field];
  if (!Array.isArray(value)) {
    throw new MarketDataAppNormalizeError(
      "payload_shape",
      `MarketData.app missing parallel array: ${field}`,
    );
  }
  return value;
}

function assertParallelArrayLengths(
  arrays: Record<MarketDataAppChainArrayField, readonly unknown[]>,
): number {
  const lengths = MARKETDATA_APP_CHAIN_ARRAY_FIELDS.map(
    (field) => arrays[field].length,
  );
  const first = lengths[0] ?? 0;
  if (!lengths.every((len) => len === first)) {
    throw new MarketDataAppNormalizeError(
      "array_length",
      `MarketData.app parallel arrays length mismatch: ${MARKETDATA_APP_CHAIN_ARRAY_FIELDS.map((field) => `${field}=${arrays[field].length}`).join(", ")}`,
    );
  }
  return first;
}

function unixSecToIso(unixSec: number): string {
  return new Date(unixSec * 1000).toISOString();
}

function unixSecToExpiryDate(unixSec: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(unixSec * 1000));
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  if (!year || !month || !day) {
    throw new MarketDataAppNormalizeError(
      "row_field",
      `invalid expiration unix timestamp: ${unixSec}`,
    );
  }
  return `${year}-${month}-${day}`;
}

function parseUnixSeconds(raw: unknown, field: string, index: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) {
    throw new MarketDataAppNormalizeError(
      "row_field",
      `row[${index}].${field} must be a positive integer unix timestamp`,
    );
  }
  return value;
}

function parseRequiredFinitePositive(
  raw: unknown,
  field: string,
  index: number,
): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new MarketDataAppNormalizeError(
      "row_field",
      `row[${index}].${field} must be a finite number > 0`,
    );
  }
  return value;
}

function parseNullableNonNegativeFinite(
  raw: unknown,
  field: string,
  index: number,
): number | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new MarketDataAppNormalizeError(
      "row_field",
      `row[${index}].${field} must be null or a finite number >= 0`,
    );
  }
  return value;
}

function readOptionalArrayField(
  body: Record<string, unknown>,
  field: (typeof MARKETDATA_APP_OPTIONAL_ARRAY_FIELDS)[number],
): unknown[] | null {
  const value = body[field];
  if (value === undefined || value === null) {
    return null;
  }
  if (!Array.isArray(value)) {
    throw new MarketDataAppNormalizeError(
      "payload_shape",
      `MarketData.app optional array must be an array: ${field}`,
    );
  }
  return value;
}

function readOptionalArrayValue(
  arrays: unknown[] | null,
  index: number,
): unknown {
  if (!arrays || index >= arrays.length) {
    return null;
  }
  return arrays[index];
}

function parseNullableFinite(
  raw: unknown,
  field: string,
  index: number,
): number | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new MarketDataAppNormalizeError(
      "row_field",
      `row[${index}].${field} must be null or finite`,
    );
  }
  return value;
}

function parseSide(raw: unknown, index: number): OptionRight {
  if (raw === "call" || raw === "put") {
    return raw;
  }
  throw new MarketDataAppNormalizeError(
    "row_field",
    `row[${index}].side must be call|put`,
  );
}

function parseSymbol(raw: unknown, index: number): string {
  if (typeof raw !== "string" || raw.length === 0) {
    throw new MarketDataAppNormalizeError(
      "row_field",
      `row[${index}].optionSymbol must be a non-empty string`,
    );
  }
  return raw;
}

function parseUnderlying(raw: unknown, index: number): string {
  if (typeof raw !== "string" || raw.length === 0) {
    throw new MarketDataAppNormalizeError(
      "row_field",
      `row[${index}].underlying must be a non-empty string`,
    );
  }
  return raw;
}

function spotTolerance(reference: number): number {
  return Math.max(
    MARKETDATA_APP_SPOT_TOLERANCE_ABS,
    Math.abs(reference) * MARKETDATA_APP_SPOT_TOLERANCE_REL,
  );
}

function spotsMateriallyConsistent(values: readonly number[]): void {
  if (values.length === 0) {
    throw new MarketDataAppNormalizeError(
      "inconsistent_spot",
      "MarketData.app chain has no underlyingPrice values",
    );
  }
  const reference = values[0]!;
  const tolerance = spotTolerance(reference);
  for (const value of values) {
    if (Math.abs(value - reference) > tolerance) {
      throw new MarketDataAppNormalizeError(
        "inconsistent_spot",
        `MarketData.app underlyingPrice materially inconsistent: ${reference} vs ${value}`,
      );
    }
  }
}

function assertSingleUnderlying(values: readonly string[]): string {
  const unique = new Set(values);
  if (unique.size !== 1) {
    throw new MarketDataAppNormalizeError(
      "inconsistent_underlying",
      `MarketData.app underlying mismatch: ${[...unique].join(", ")}`,
    );
  }
  return values[0]!;
}

/**
 * Pure deterministic normalizer: MarketData.app parallel-array chain → OptionsChainSnapshot.
 */
export function normalizeMarketDataAppChain(
  input: NormalizeMarketDataAppChainInput,
): OptionsChainSnapshot {
  assertHttpSuccess(input.httpStatus);

  if (!isRecord(input.body)) {
    throw new MarketDataAppNormalizeError(
      "payload_shape",
      "MarketData.app body must be an object",
    );
  }
  const body = input.body;

  assertVendorStatus(body);

  const arrays = Object.fromEntries(
    MARKETDATA_APP_CHAIN_ARRAY_FIELDS.map((field) => [
      field,
      readArrayField(body, field),
    ]),
  ) as Record<MarketDataAppChainArrayField, unknown[]>;

  const rowCount = assertParallelArrayLengths(arrays);
  if (rowCount === 0) {
    throw new MarketDataAppNormalizeError(
      "payload_shape",
      "MarketData.app chain has zero contracts",
    );
  }

  const deltaArray = readOptionalArrayField(body, "delta");
  const askArray = readOptionalArrayField(body, "ask");
  for (const [label, arr] of [
    ["delta", deltaArray],
    ["ask", askArray],
  ] as const) {
    if (arr !== null && arr.length !== rowCount) {
      throw new MarketDataAppNormalizeError(
        "array_length",
        `MarketData.app ${label} array length ${arr.length} != ${rowCount}`,
      );
    }
  }

  const underlyings: string[] = [];
  const spots: number[] = [];
  const updatedInstants: number[] = [];
  const contracts: OptionsContract[] = [];
  const qualityInputs: Array<{
    contract: OptionsContract;
    delta: number | null;
    ask: number | null;
  }> = [];

  for (let i = 0; i < rowCount; i++) {
    const underlying = parseUnderlying(arrays.underlying[i], i);
    underlyings.push(underlying);

    const spot = parseRequiredFinitePositive(
      arrays.underlyingPrice[i],
      "underlyingPrice",
      i,
    );
    spots.push(spot);

    const updated = parseUnixSeconds(arrays.updated[i], "updated", i);
    updatedInstants.push(updated);

    const expiration = parseUnixSeconds(arrays.expiration[i], "expiration", i);

    const contract: OptionsContract = {
      symbol: parseSymbol(arrays.optionSymbol[i], i),
      underlying,
      right: parseSide(arrays.side[i], i),
      strike: parseRequiredFinitePositive(arrays.strike[i], "strike", i),
      expiry: unixSecToExpiryDate(expiration),
      openInterest: parseNullableNonNegativeFinite(
        arrays.openInterest[i],
        "openInterest",
        i,
      ),
      volume: parseNullableNonNegativeFinite(arrays.volume[i], "volume", i),
      gamma: parseNullableNonNegativeFinite(arrays.gamma[i], "gamma", i),
      iv: parseNullableNonNegativeFinite(arrays.iv[i], "iv", i),
      multiplier: MARKETDATA_APP_OPTIONS_MULTIPLIER,
    };
    contracts.push(contract);
    qualityInputs.push({
      contract,
      delta: parseNullableFinite(
        readOptionalArrayValue(deltaArray, i),
        "delta",
        i,
      ),
      ask: parseNullableFinite(readOptionalArrayValue(askArray, i), "ask", i),
    });
  }

  const underlying = assertSingleUnderlying(underlyings);
  spotsMateriallyConsistent(spots);

  const chainSpot = spots[0]!;
  const audits: ContractQualityAudit[] = qualityInputs.map((row) =>
    assessContractQuality({
      contract: row.contract,
      spot: chainSpot,
      delta: row.delta,
      ask: row.ask,
    }),
  );
  const dataQuality: ChainDataQuality = buildChainDataQuality(
    contracts,
    audits,
  );

  const asOf = unixSecToIso(Math.max(...updatedInstants));

  return {
    kind: "OptionsChainSnapshot",
    underlying,
    asOf,
    sessionDate: input.sessionDate,
    spot: chainSpot,
    dataDelay: input.dataDelay ?? "unknown",
    source: {
      provider: "marketdata_app",
      name: input.sourceName ?? "marketdata.app/options/chain",
      fetchedAt: input.fetchedAt,
    },
    contracts,
    synthetic: input.synthetic ?? false,
    dataQuality,
  };
}
