import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GammaDataDelay, IsoDate, IsoDateTime } from "@/contracts";
import type { OptionsChainProvider } from "./provider";
import type { OptionsChainSnapshot, OptionsContract } from "./types";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function requireString(raw: unknown, field: string): string {
  if (typeof raw !== "string" || raw.length === 0) {
    throw new Error(`options chain fixture: missing or invalid ${field}`);
  }
  return raw;
}

function parseContract(raw: unknown, index: number, underlying: string): OptionsContract {
  if (!isRecord(raw)) {
    throw new Error(
      `options chain fixture: contracts[${index}] must be an object`,
    );
  }
  const right = raw.right;
  if (right !== "call" && right !== "put") {
    throw new Error(
      `options chain fixture: contracts[${index}].right must be call|put`,
    );
  }
  const expiryParsed = IsoDate.safeParse(raw.expiry);
  if (!expiryParsed.success) {
    throw new Error(
      `options chain fixture: contracts[${index}].expiry must be YYYY-MM-DD`,
    );
  }
  const strike = Number(raw.strike);
  if (!Number.isFinite(strike)) {
    throw new Error(
      `options chain fixture: contracts[${index}].strike must be finite`,
    );
  }
  const multiplier = Number(raw.multiplier);
  if (!Number.isFinite(multiplier)) {
    throw new Error(
      `options chain fixture: contracts[${index}].multiplier must be finite`,
    );
  }
  const oiRaw = raw.openInterest;
  const gammaRaw = raw.gamma;
  const openInterest =
    oiRaw === null || oiRaw === undefined ? null : Number(oiRaw);
  if (openInterest !== null && !Number.isFinite(openInterest)) {
    throw new Error(
      `options chain fixture: contracts[${index}].openInterest must be null or finite`,
    );
  }
  const gamma =
    gammaRaw === null || gammaRaw === undefined ? null : Number(gammaRaw);
  if (gamma !== null && !Number.isFinite(gamma)) {
    throw new Error(
      `options chain fixture: contracts[${index}].gamma must be null or finite`,
    );
  }

  return {
    symbol: requireString(raw.symbol, `contracts[${index}].symbol`),
    underlying: String(raw.underlying ?? underlying),
    expiry: expiryParsed.data,
    strike,
    right,
    openInterest,
    volume:
      raw.volume === null || raw.volume === undefined
        ? null
        : Number(raw.volume),
    gamma,
    iv: raw.iv === null || raw.iv === undefined ? null : Number(raw.iv),
    multiplier,
  };
}

/** Parse a fixture JSON document into OptionsChainSnapshot (throws on hard fail). */
export function parseOptionsChainFixture(raw: unknown): OptionsChainSnapshot {
  if (!isRecord(raw)) {
    throw new Error("options chain fixture must be an object");
  }
  const underlying = requireString(raw.underlying, "underlying");
  const asOfParsed = IsoDateTime.safeParse(raw.asOf);
  if (!asOfParsed.success) {
    throw new Error("options chain fixture: asOf must be ISO-8601 datetime");
  }
  const sessionParsed = IsoDate.safeParse(raw.sessionDate);
  if (!sessionParsed.success) {
    throw new Error(
      "options chain fixture: sessionDate must be YYYY-MM-DD",
    );
  }
  const delayParsed = GammaDataDelay.safeParse(raw.dataDelay);
  if (!delayParsed.success) {
    throw new Error(
      "options chain fixture: dataDelay must be realtime|delayed_15m|eod|fixture|unknown",
    );
  }
  if (!Array.isArray(raw.contracts)) {
    throw new Error("options chain fixture: contracts must be an array");
  }
  const contracts = raw.contracts.map((c, i) =>
    parseContract(c, i, underlying),
  );

  if (!isRecord(raw.source)) {
    throw new Error("options chain fixture: source must be an object");
  }
  const fetchedAtParsed = IsoDateTime.safeParse(raw.source.fetchedAt);
  if (!fetchedAtParsed.success) {
    throw new Error(
      "options chain fixture: source.fetchedAt must be ISO-8601 datetime",
    );
  }

  const spotRaw = raw.spot;
  let spot: number | null;
  if (spotRaw === null || spotRaw === undefined) {
    spot = null;
  } else {
    spot = Number(spotRaw);
    if (!Number.isFinite(spot)) {
      throw new Error("options chain fixture: spot must be null or finite");
    }
  }

  return {
    kind: "OptionsChainSnapshot",
    underlying,
    asOf: asOfParsed.data,
    sessionDate: sessionParsed.data,
    spot,
    dataDelay: delayParsed.data,
    source: {
      provider: requireString(raw.source.provider, "source.provider"),
      name: requireString(raw.source.name, "source.name"),
      fetchedAt: fetchedAtParsed.data,
    },
    contracts,
    synthetic: Boolean(raw.synthetic ?? true),
  };
}

export function loadOptionsChainFixtureFile(path: string): OptionsChainSnapshot {
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  return parseOptionsChainFixture(raw);
}

export class FixtureOptionsChainProvider implements OptionsChainProvider {
  readonly id = "fixture";

  constructor(
    private readonly fixtureRoot: string = join(
      process.cwd(),
      "fixtures",
      "gamma",
    ),
  ) {}

  loadChain(query: {
    readonly underlying: string;
    readonly sessionDate: string;
  }): OptionsChainSnapshot | null {
    const file = join(
      this.fixtureRoot,
      `${query.underlying.toLowerCase()}.${query.sessionDate}.json`,
    );
    try {
      const chain = loadOptionsChainFixtureFile(file);
      if (chain.underlying !== query.underlying) return null;
      if (chain.sessionDate !== query.sessionDate) return null;
      return chain;
    } catch {
      return null;
    }
  }
}
