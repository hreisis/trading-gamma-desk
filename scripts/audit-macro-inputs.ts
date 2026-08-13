/**
 * Audit macro driver inputs for the current completed session.
 * Usage: npx tsx scripts/audit-macro-inputs.ts
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  ASSET_REGISTRY,
  CORE_SYMBOLS,
  CORE_RATE_SYMBOLS,
  type MacroSymbol,
} from "@/contracts";
import { resolveLastCompletedMarketSessionDate } from "@/ai-study/session";
import { resolveRuntimeJsonStore } from "@/desk/runtime-store";
import { loadSessionDriverAsync } from "@/desk/load-session-driver";
import { observedZ } from "@/macro/scoring";
import { RegimeSignatureConfig } from "@/contracts";
import { readJson } from "@/desk/runtime-store/json";
import type { MacroSnapshot } from "@/ingest/assemble";
import { resolveMacroIngestEndDate } from "@/ingest/run";

const DATA_ROOT = join(process.cwd(), "data");
const SIGNATURE_PATH = "fixtures/macro/regime-signature.sig-2026-07-01.json";

async function main() {
  const now = new Date();
  const targetSession = resolveLastCompletedMarketSessionDate(now);
  const ingestEndDate = resolveMacroIngestEndDate(now);

  console.log("=== Macro input audit ===");
  console.log("now:", now.toISOString());
  console.log("target completed session:", targetSession);
  console.log("ingest endDate:", ingestEndDate);

  const artifactStore = resolveRuntimeJsonStore(process.env);
  console.log("artifact store:", artifactStore.mode, artifactStore.rootLabel);

  const driverLoad = await loadSessionDriverAsync(targetSession, artifactStore);
  if (driverLoad.driver) {
    console.log("\n--- Loaded driver ---");
    console.log("path:", driverLoad.driverPath);
    console.log("marketSessionDate:", driverLoad.driver.marketSessionDate);
    console.log("generatedAt:", driverLoad.driver.generatedAt);
    console.log("primaryRegime:", driverLoad.driver.primaryRegime);
    console.log("label:", driverLoad.driver.label);
    console.log("sessionAlignment:", driverLoad.driver.sessionAlignment);
    console.log("isCompleteSession:", driverLoad.driver.isCompleteSession);
    console.log("issues:", driverLoad.issues);
  } else {
    console.log("\nNo driver for", targetSession);
    const driversDir = join(DATA_ROOT, "drivers");
    if (existsSync(driversDir)) {
      const sessions = readdirSync(driversDir)
        .filter((n) => n.endsWith(".json"))
        .map((n) => n.replace(".json", ""))
        .sort();
      console.log("local driver sessions:", sessions.join(", ") || "(none)");
      if (sessions.length > 0) {
        const latest = sessions[sessions.length - 1]!;
        const raw = JSON.parse(
          readFileSync(join(driversDir, `${latest}.json`), "utf8"),
        );
        console.log("latest local driver session:", latest);
        console.log("latest primaryRegime:", raw.primaryRegime);
        console.log("latest label:", raw.label);
      }
    }
  }

  let snapshot: MacroSnapshot | null = null;
  const snapshotRel = `snapshots/${targetSession}.json`;
  const snapshotFs = join(DATA_ROOT, "snapshots", `${targetSession}.json`);
  const rawBlob = await readJson(artifactStore, snapshotRel);
  if (rawBlob !== null) {
    snapshot = rawBlob as MacroSnapshot;
    console.log("\n--- Snapshot from artifact store ---");
    console.log("path:", `${artifactStore.rootLabel}/${snapshotRel}`);
  } else if (existsSync(snapshotFs)) {
    snapshot = JSON.parse(readFileSync(snapshotFs, "utf8")) as MacroSnapshot;
    console.log("\n--- Snapshot from filesystem ---");
    console.log("path:", snapshotFs);
  }

  if (snapshot) {
    console.log("marketSessionDate:", snapshot.marketSessionDate);
    console.log("sessionAlignment:", snapshot.sessionAlignment);
    console.log("isCompleteSession:", snapshot.isCompleteSession);
    auditSnapshot(snapshot, targetSession);
  } else {
    console.log("\nNo snapshot for", targetSession);
    const snapDir = join(DATA_ROOT, "snapshots");
    if (existsSync(snapDir)) {
      const sessions = readdirSync(snapDir)
        .filter((n) => n.endsWith(".json"))
        .map((n) => n.replace(".json", ""))
        .sort();
      console.log("local snapshot sessions:", sessions.join(", ") || "(none)");
    }
  }

  // List bars availability
  console.log("\n--- Bar files (data/bars) ---");
  const barsRoot = join(DATA_ROOT, "bars");
  for (const symbol of CORE_SYMBOLS) {
    const def = ASSET_REGISTRY[symbol];
    const barPath = join(barsRoot, `${symbol}.json`);
    const exists = existsSync(barPath);
    let latestBarDate: string | null = null;
    if (exists) {
      try {
        const bars = JSON.parse(readFileSync(barPath, "utf8")) as {
          bars?: { sessionDate: string }[];
        };
        const dates = bars.bars?.map((b) => b.sessionDate) ?? [];
        latestBarDate = dates.sort().at(-1) ?? null;
      } catch {
        latestBarDate = "parse-error";
      }
    }
    console.log(
      `${symbol} (${def.instrument}) provider=${snapshot?.barSources?.[symbol]?.source ?? "tiingo/cboe/treasury"} barFile=${exists ? barPath : "MISSING"} latestBar=${latestBarDate ?? "—"}`,
    );
  }
}

function auditSnapshot(snapshot: MacroSnapshot, targetSession: string) {
  const config = RegimeSignatureConfig.parse(
    JSON.parse(readFileSync(join(process.cwd(), SIGNATURE_PATH), "utf8")),
  );

  const scoreInputs = snapshot.features.map((f) => ({
    symbol: f.symbol,
    zScore: f.zScore,
    stale: (snapshot.staleDaysByAsset[f.symbol] ?? 0) > 0,
  }));

  const zMap = observedZ(scoreInputs);
  const missingRates = CORE_RATE_SYMBOLS.filter((s) => !zMap.has(s));
  const corePresent = CORE_SYMBOLS.filter((s) => zMap.has(s)).length;
  const coverageInsufficient =
    missingRates.length > 0
      ? `core rate missing: ${missingRates.join(", ")}`
      : corePresent < 6
        ? `core coverage ${corePresent}/8 < 6`
        : null;

  console.log("\n--- Per-asset feature audit ---");
  let available = 0;
  let excluded = 0;

  for (const symbol of CORE_SYMBOLS) {
    const def = ASSET_REGISTRY[symbol];
    const feature = snapshot.features.find((f) => f.symbol === symbol)!;
    const sourceDate = snapshot.sourceDateByAsset[symbol];
    const staleDays = snapshot.staleDaysByAsset[symbol] ?? 0;
    const barSource = snapshot.barSources[symbol];

    let status: "available" | "stale" | "missing" | "session-misaligned";
    let reason = "";

    if (feature.zScore === null) {
      status = "missing";
      reason = `zScore null; flags=${feature.flags.join(",") || "none"}`;
      excluded += 1;
    } else if (staleDays > 0) {
      status = "stale";
      reason = `staleDays=${staleDays}; sourceDate=${sourceDate} vs marketSession=${snapshot.marketSessionDate}`;
      available += 1; // still has z
    } else if (sourceDate !== snapshot.marketSessionDate) {
      status = "session-misaligned";
      reason = `sourceDate=${sourceDate} != marketSession=${snapshot.marketSessionDate}`;
      excluded += 1;
    } else if (snapshot.marketSessionDate !== targetSession) {
      status = "session-misaligned";
      reason = `snapshot session ${snapshot.marketSessionDate} != target ${targetSession}`;
      excluded += 1;
    } else {
      status = "available";
      reason = `change ${feature.currentChange} (${feature.currentFrom}→${feature.currentTo})`;
      available += 1;
    }

    console.log(
      [
        symbol,
        def.instrument,
        status,
        `expected=${targetSession}`,
        `actual=${sourceDate ?? "—"}`,
        `z=${feature.zScore ?? "null"}`,
        barSource ? `bars=${barSource.source}(${barSource.barCount})` : "no-bar-meta",
        reason,
      ].join(" | "),
    );
  }

  console.log("\n--- Rates (core gate) ---");
  for (const symbol of CORE_RATE_SYMBOLS) {
    const inZ = zMap.has(symbol);
    console.log(`${symbol}: in zMap=${inZ}`);
  }

  console.log("\n--- Coverage summary ---");
  console.log("core symbols with z:", [...zMap.keys()].filter((s) => CORE_SYMBOLS.includes(s)).length, "/ 8");
  console.log("insufficient_data rule:", coverageInsufficient ?? "PASS");
  console.log("primaryRegime:", snapshot.classification.primaryRegime);
  console.log("label:", snapshot.classification.label);
  console.log("available (scored):", available);
  console.log("excluded/problematic:", excluded);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
