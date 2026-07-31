import { IsoDate } from "@/contracts";
import { DEFAULT_MAX_EXPECTED_CONTRACTS } from "./config";

export interface GammaFetchCliArgs {
  readonly symbol: string;
  readonly expiration: string;
  readonly strikeMin: number;
  readonly strikeMax: number;
  readonly strikeStep: number;
  readonly maxExpectedContracts: number;
  readonly allowAboveCap: boolean;
  readonly dataRoot?: string;
}

function requireFlag(argv: readonly string[], name: string): string {
  const eq = argv.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const idx = argv.indexOf(name);
  if (idx >= 0 && argv[idx + 1] && !argv[idx + 1]!.startsWith("--")) {
    return argv[idx + 1]!;
  }
  throw new Error(`missing required argument ${name}`);
}

function optionalFlag(argv: readonly string[], name: string): string | undefined {
  const eq = argv.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const idx = argv.indexOf(name);
  if (idx >= 0 && argv[idx + 1] && !argv[idx + 1]!.startsWith("--")) {
    return argv[idx + 1];
  }
  return undefined;
}

function parseNumberFlag(
  argv: readonly string[],
  name: string,
  required: boolean,
  fallback?: number,
): number {
  const raw = optionalFlag(argv, name);
  if (raw === undefined) {
    if (required) throw new Error(`missing required argument ${name}`);
    return fallback!;
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`${name} must be a finite number (got ${raw})`);
  }
  return n;
}

export function parseGammaFetchArgs(argv: readonly string[]): GammaFetchCliArgs {
  const symbol = requireFlag(argv, "--symbol").trim().toUpperCase();
  if (!symbol) throw new Error("--symbol must be non-empty");

  const expiration = requireFlag(argv, "--expiration").trim();
  if (!IsoDate.safeParse(expiration).success) {
    throw new Error("--expiration must be YYYY-MM-DD");
  }

  const strikeMin = parseNumberFlag(argv, "--strike-min", true);
  const strikeMax = parseNumberFlag(argv, "--strike-max", true);
  const strikeStep = parseNumberFlag(argv, "--strike-step", false, 1);
  const maxExpectedContracts = parseNumberFlag(
    argv,
    "--max-expected-contracts",
    false,
    DEFAULT_MAX_EXPECTED_CONTRACTS,
  );
  const allowAboveCap = argv.includes("--allow-above-cap");
  const dataRoot = optionalFlag(argv, "--data-root");

  return {
    symbol,
    expiration,
    strikeMin,
    strikeMax,
    strikeStep,
    maxExpectedContracts,
    allowAboveCap,
    dataRoot,
  };
}
