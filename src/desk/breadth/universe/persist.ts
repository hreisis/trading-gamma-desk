import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { EtfUniverseArtifact } from "@/contracts/etf-universe-artifact";
import { EtfUniverseArtifact as EtfUniverseArtifactSchema } from "@/contracts/etf-universe-artifact";
import { writeJsonAtomic } from "@/desk/atomic-write";
import { SPY_BREADTH_CONFIG } from "../config";
import { evaluateUniverseFreshness } from "./session-lag";

/**
 * Local-development persistence under `data/universes/SPY/`.
 * Not durable on Vercel serverless — deployment needs external object storage
 * or build-time artifacts; this module is the adapter boundary until then.
 */

export function spyUniverseDir(dataRoot: string): string {
  return join(dataRoot, "universes", SPY_BREADTH_CONFIG.fundSymbol);
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
  const asOfPath = spyUniverseAsOfPath(dataRoot, artifact.asOf);
  if (!existsSync(asOfPath)) {
    writeJsonAtomic(asOfPath, artifact);
  }
  writeJsonAtomic(spyUniverseLatestPath(dataRoot), artifact);
  return { asOfPath, latestPath: spyUniverseLatestPath(dataRoot) };
}

export function readSpyUniverseArtifact(path: string): EtfUniverseArtifact {
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  return EtfUniverseArtifactSchema.parse(raw);
}

export function loadPersistedSpyUniverse(
  dataRoot: string,
): EtfUniverseArtifact | null {
  const latestPath = spyUniverseLatestPath(dataRoot);
  if (!existsSync(latestPath)) return null;
  return readSpyUniverseArtifact(latestPath);
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
