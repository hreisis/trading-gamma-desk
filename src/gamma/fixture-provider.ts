import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { OptionsChainProvider } from "./provider";
import type { OptionsChainSnapshot, OptionsContract } from "./types";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseContract(raw: unknown, underlying: string): OptionsContract | null {
  if (!isRecord(raw)) return null;
  const right = raw.right;
  if (right !== "call" && right !== "put") return null;
  const strike = Number(raw.strike);
  const multiplier = Number(raw.multiplier);
  const oiRaw = raw.openInterest;
  const gammaRaw = raw.gamma;
  return {
    symbol: String(raw.symbol ?? ""),
    underlying: String(raw.underlying ?? underlying),
    expiry: String(raw.expiry ?? ""),
    strike,
    right,
    openInterest:
      oiRaw === null || oiRaw === undefined ? null : Number(oiRaw),
    volume:
      raw.volume === null || raw.volume === undefined
        ? null
        : Number(raw.volume),
    gamma:
      gammaRaw === null || gammaRaw === undefined ? null : Number(gammaRaw),
    iv:
      raw.iv === null || raw.iv === undefined ? null : Number(raw.iv),
    multiplier,
  };
}

/** Parse a fixture JSON document into OptionsChainSnapshot (throws on hard fail). */
export function parseOptionsChainFixture(raw: unknown): OptionsChainSnapshot {
  if (!isRecord(raw)) {
    throw new Error("options chain fixture must be an object");
  }
  const underlying = String(raw.underlying ?? "");
  const contractsRaw = Array.isArray(raw.contracts) ? raw.contracts : [];
  const contracts = contractsRaw
    .map((c) => parseContract(c, underlying))
    .filter((c): c is OptionsContract => c !== null);

  const source = isRecord(raw.source) ? raw.source : {};
  const spotRaw = raw.spot;

  return {
    kind: "OptionsChainSnapshot",
    underlying,
    asOf: String(raw.asOf ?? ""),
    sessionDate: String(raw.sessionDate ?? ""),
    spot:
      spotRaw === null || spotRaw === undefined ? null : Number(spotRaw),
    dataDelay:
      raw.dataDelay === "realtime" ||
      raw.dataDelay === "delayed_15m" ||
      raw.dataDelay === "eod" ||
      raw.dataDelay === "fixture" ||
      raw.dataDelay === "unknown"
        ? raw.dataDelay
        : "fixture",
    source: {
      provider: String(source.provider ?? "fixture"),
      name: String(source.name ?? "fixture"),
      fetchedAt: String(source.fetchedAt ?? raw.asOf ?? ""),
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
