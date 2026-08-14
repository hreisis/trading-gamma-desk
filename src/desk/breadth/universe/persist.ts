import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { EtfUniverseArtifact } from "@/contracts/etf-universe-artifact";
import { EtfUniverseArtifact as EtfUniverseArtifactSchema } from "@/contracts/etf-universe-artifact";
import { writeJsonAtomic } from "@/desk/atomic-write";
import { SPY_BREADTH_CONFIG } from "../config";
import { evaluateUniverseFreshness } from "./session-lag";

/**
 * Local-development persistence under `data/universes/{fundSymbol}/`.
 */

export function universeDir(dataRoot: string, fundSymbol: string): string {
  return join(dataRoot, "universes", fundSymbol);
}

export function universeAsOfPath(
  dataRoot: string,
  fundSymbol: string,
  asOf: string,
): string {
  return join(universeDir(dataRoot, fundSymbol), `${asOf}.json`);
}

export function universeLatestPath(dataRoot: string, fundSymbol: string): string {
  return join(universeDir(dataRoot, fundSymbol), "latest.json");
}

export function persistUniverseArtifact(
  artifact: EtfUniverseArtifact,
  dataRoot: string,
): { readonly asOfPath: string; readonly latestPath: string } {
  const asOfPath = universeAsOfPath(dataRoot, artifact.fundSymbol, artifact.asOf);
  if (!existsSync(asOfPath)) {
    writeJsonAtomic(asOfPath, artifact);
  }
  const latestPath = universeLatestPath(dataRoot, artifact.fundSymbol);
  writeJsonAtomic(latestPath, artifact);
  return { asOfPath, latestPath };
}

export function readUniverseArtifact(path: string): EtfUniverseArtifact {
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  return EtfUniverseArtifactSchema.parse(raw);
}

export function loadPersistedUniverse(
  dataRoot: string,
  fundSymbol: string,
): EtfUniverseArtifact | null {
  const latestPath = universeLatestPath(dataRoot, fundSymbol);
  if (!existsSync(latestPath)) return null;
  return readUniverseArtifact(latestPath);
}

export function spyUniverseDir(dataRoot: string): string {
  return universeDir(dataRoot, SPY_BREADTH_CONFIG.fundSymbol);
}

export function spyUniverseAsOfPath(dataRoot: string, asOf: string): string {
  return join(spyUniverseDir(dataRoot), `${asOf}.json`);
}

export function spyUniverseLatestPath(dataRoot: string): string {
  return join(spyUniverseDir(dataRoot), "latest.json");
}

export function persistSpyUniverseArtifact(
  artifact: EtfUniverseArtifact,
  dataRoot: string,
): { readonly asOfPath: string; readonly latestPath: string } {
  return persistUniverseArtifact(artifact, dataRoot);
}

export function readSpyUniverseArtifact(path: string): EtfUniverseArtifact {
  return readUniverseArtifact(path);
}

export function loadPersistedSpyUniverse(
  dataRoot: string,
): EtfUniverseArtifact | null {
  return loadPersistedUniverse(dataRoot, SPY_BREADTH_CONFIG.fundSymbol);
}

export function applyUniverseFreshness(
  artifact: EtfUniverseArtifact,
  targetMarketSessionDate: string,
): EtfUniverseArtifact {
  const freshness = evaluateUniverseFreshness({
    universeAsOf: artifact.asOf,
    targetMarketSessionDate,
  });
  return EtfUniverseArtifactSchema.parse({
    ...artifact,
    sessionLag: freshness.sessionLag,
    stale: freshness.stale,
    status: freshness.status,
  });
}
