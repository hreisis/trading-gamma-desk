import { join } from "node:path";
import { loadAlpacaMarketPanel } from "@/alpaca";
import type {
  AiStudyInputProvenance,
  AiStudySessionAlignment,
} from "@/contracts/ai-study-briefing";
import { loadCatalystFeed, loadCatalystFeedAsync } from "@/catalyst";
import { filterTier1Catalysts } from "@/catalyst/public-feed";
import { loadSessionDriver } from "@/desk/load-session-driver";
import { loadSessionBoundedGamma } from "@/desk/load-session-bounded-gamma";
import {
  ensureMacroDriverArtifact,
  loadBoundedGammaDeskViewAsync,
  resolveRuntimeDataRoot,
} from "@/desk/production-runtime";
import { PUBLIC_DEMO_SESSION } from "@/desk/public-demo";
import { buildMarketStructureStateV2 } from "@/gamma/structure-state-v2";
import { buildAiStudyEvidenceCorpus } from "./evidence-corpus";
import {
  isHistoricalAiStudySession,
  resolveCurrentMarketSessionDate,
} from "./session";
import { buildSessionAlignment } from "./validate";

export interface AiStudyFacts {
  readonly sessionDate: string | null;
  readonly macro: Record<string, unknown> | null;
  readonly catalysts: readonly Record<string, unknown>[];
  readonly gammaStructure: Record<string, unknown> | null;
  readonly marketQuotes: readonly Record<string, unknown>[];
}

export interface AiStudyInputPacket {
  readonly sessionDate: string | null;
  readonly mode: "current" | "historical";
  readonly inputs: readonly AiStudyInputProvenance[];
  readonly facts: AiStudyFacts;
  readonly sessionAlignment: AiStudySessionAlignment;
  readonly evidenceIds: readonly string[];
  readonly blocked: boolean;
  readonly blockReason: string | null;
}

function input(
  row: AiStudyInputProvenance,
): AiStudyInputProvenance {
  return row;
}

function summarizeMacro(
  publicDemo: boolean,
  sessionDate: string | null,
  dataRoot: string,
): {
  provenance: AiStudyInputProvenance;
  facts: Record<string, unknown> | null;
  sessionDate: string | null;
} {
  if (publicDemo) {
    return {
      sessionDate: PUBLIC_DEMO_SESSION,
      provenance: input({
        id: "macro",
        status: "fixture",
        sourceLabel: "Synthetic Demo Data — illustrative, not market data.",
        note: "Synthetic demo macro fixture",
        provider: "synthetic_demo",
        sessionDate: PUBLIC_DEMO_SESSION,
        fetchedAt: null,
        freshness: "fixture",
      }),
      facts: {
        sessionDate: PUBLIC_DEMO_SESSION,
        label: "Illustrative rates-led easing (demo)",
      },
    };
  }

  const target = sessionDate;
  if (!target) {
    return {
      sessionDate: null,
      provenance: input({
        id: "macro",
        status: "unavailable",
        sourceLabel: "local_store",
        note: "No macro driver session on disk",
        provider: "local_store",
        sessionDate: null,
        fetchedAt: null,
        freshness: "unavailable",
      }),
      facts: null,
    };
  }

  const loaded = loadSessionDriver(target, dataRoot);
  const mismatched = loaded.issues.some((i) => i.severity === "mismatched");
  if (!loaded.driver || mismatched) {
    return {
      sessionDate: target,
      provenance: input({
        id: "macro",
        status: "unavailable",
        sourceLabel: loaded.driverPath ?? "data/drivers",
        note:
          loaded.issues.find((i) => i.severity === "mismatched")?.message ??
          loaded.issues[0]?.message ??
          "Macro driver unavailable for target session",
        provider: "local_store",
        sessionDate: loaded.driver?.marketSessionDate ?? target,
        fetchedAt: null,
        freshness: mismatched ? "stale" : "unavailable",
      }),
      facts: null,
    };
  }

  const driver = loaded.driver;
  const stale = loaded.issues.some((i) => i.severity === "stale");
  const alignedToTarget = driver.marketSessionDate === target;
  return {
    sessionDate: driver.marketSessionDate,
    provenance: input({
      id: "macro",
      status: !alignedToTarget || stale ? "partial" : "available",
      sourceLabel: loaded.driverPath ?? "DominantDriver",
      note: !alignedToTarget
        ? `Macro driver session ${driver.marketSessionDate} != target ${target}`
        : stale
          ? "Macro driver flagged stale/incomplete"
          : undefined,
      provider: "local_store",
      sessionDate: driver.marketSessionDate,
      fetchedAt: driver.generatedAt,
      freshness: !alignedToTarget || stale ? "stale" : "cached",
    }),
    facts: {
      sessionDate: driver.marketSessionDate,
      label: driver.label,
      primaryRegime: driver.primaryRegime,
      riskDirection: driver.riskDirection,
      confidenceScore: driver.confidence.score,
      confidenceCalibrated: driver.confidence.calibrated,
      interpretation: driver.interpretation.text,
      assets: driver.assets.map((a) => ({
        symbol: a.symbol,
        value: a.value,
        unit: a.unit,
        zScore: a.zScore,
        role: a.role,
      })),
    },
  };
}

function summarizeCatalystsFromFeed(
  feed: ReturnType<typeof loadCatalystFeed>,
  publicDemo: boolean,
  now: Date,
): {
  provenance: AiStudyInputProvenance;
  facts: readonly Record<string, unknown>[];
} {
  const events = filterTier1Catalysts(feed.catalysts).slice(0, 8).map((c) => ({
    id: c.id,
    headline: c.headline,
    category: c.category,
    status: c.status,
    importance: c.importance,
    occurredAt: c.occurredAt,
    direction: c.direction,
    synthetic: c.synthetic,
  }));
  const fetchedAt = now.toISOString();
  if (events.length === 0) {
    return {
      provenance: input({
        id: "catalysts",
        status: "unavailable",
        sourceLabel: feed.source.type,
        note: feed.disclaimer ?? "No catalyst events in feed window",
        provider: publicDemo ? "synthetic_demo" : feed.source.type,
        sessionDate: null,
        fetchedAt,
        freshness: "unavailable",
      }),
      facts: [],
    };
  }
  const hasSynthetic = events.some((e) => e.synthetic);
  return {
    provenance: input({
      id: "catalysts",
      status: publicDemo || hasSynthetic ? "fixture" : "available",
      sourceLabel: publicDemo ? "synthetic_fixtures" : feed.source.type,
      note: publicDemo
        ? "Synthetic demo catalyst fixtures"
        : hasSynthetic
          ? "Feed includes synthetic catalyst rows"
          : feed.mode === "stale_calendar"
            ? "Calendar cache stale — events may be dated"
            : undefined,
      provider: publicDemo ? "synthetic_demo" : feed.source.type,
      sessionDate: null,
      fetchedAt,
      freshness: publicDemo
        ? "fixture"
        : feed.mode === "stale_calendar"
          ? "stale"
          : "cached",
    }),
    facts: events,
  };
}

function summarizeGamma(
  publicDemo: boolean,
  sessionDate: string | null,
  dataRoot: string,
): {
  provenance: AiStudyInputProvenance;
  facts: Record<string, unknown> | null;
} {
  if (publicDemo) {
    return {
      provenance: input({
        id: "gamma_structure",
        status: "fixture",
        sourceLabel: "fixtures/gamma/providers/marketdata-app/spy-bounded-ui.json",
        note: "Synthetic bounded gamma fixture",
        provider: "synthetic_demo",
        sessionDate: PUBLIC_DEMO_SESSION,
        fetchedAt: null,
        freshness: "fixture",
      }),
      facts: {
        sessionDate: PUBLIC_DEMO_SESSION,
        symbol: "SPY",
        spot: 548.25,
        gammaRegime: "negative",
        status: "available",
      },
    };
  }

  const target = sessionDate;
  if (!target) {
    return {
      provenance: input({
        id: "gamma_structure",
        status: "unavailable",
        sourceLabel: "marketdata_app",
        note: "Session date unknown — cannot align gamma",
        provider: "marketdata_app",
        sessionDate: null,
        fetchedAt: null,
        freshness: "unavailable",
      }),
      facts: null,
    };
  }

  const loaded = loadSessionBoundedGamma({
    sessionDate: target,
    symbol: "SPY",
    dataRoot: join(dataRoot, "gamma", "providers", "marketdata-app"),
  });
  const snap = loaded.snapshot;
  const mismatched = loaded.issues.some((i) => i.severity === "mismatched");
  if (!snap || mismatched) {
    return {
      provenance: input({
        id: "gamma_structure",
        status: "unavailable",
        sourceLabel: loaded.snapshotPath ?? "marketdata_app",
        note:
          loaded.issues.find((i) => i.severity === "mismatched")?.message ??
          loaded.issues[0]?.message ??
          "Bounded gamma unavailable for target session",
        provider: "marketdata_app",
        sessionDate: target,
        fetchedAt: snap?.source.fetchedAt ?? snap?.generatedAt ?? null,
        freshness: mismatched ? "stale" : "unavailable",
      }),
      facts: null,
    };
  }

  let structureV2: Record<string, unknown> | null = null;
  try {
    const state = buildMarketStructureStateV2({ bounded: snap });
    structureV2 = {
      regime: state.regime,
      availability: state.availability,
      spot: state.spot,
      flip: state.flip,
      boundedCallWall: state.boundedCallWall,
      boundedPutWall: state.boundedPutWall,
      spotWallCorridor: state.spotWallCorridor,
      interpretationSummary: state.interpretation.summary,
      limitations: state.limitations.slice(0, 4),
    };
  } catch {
    structureV2 = null;
  }

  return {
    provenance: input({
      id: "gamma_structure",
      status:
        snap.status === "available"
          ? "available"
          : "partial",
      sourceLabel: loaded.snapshotPath ?? "marketdata_app",
      note:
        snap.status !== "available"
          ? `Bounded gamma status: ${snap.status}`
          : undefined,
      provider: "marketdata_app",
      sessionDate: snap.sessionDate,
      fetchedAt: snap.source.fetchedAt ?? snap.generatedAt,
      freshness: "cached",
    }),
    facts: {
      sessionDate: snap.sessionDate,
      symbol: snap.symbol,
      spot: snap.spot,
      gammaRegime: snap.gammaRegime,
      scope: snap.scope,
      status: snap.status,
      boundedCallWall: snap.boundedCallWall,
      boundedPutWall: snap.boundedPutWall,
      structureV2,
      limitations: snap.limitations.slice(0, 3),
    },
  };
}

async function summarizeMarketQuotes(
  publicDemo: boolean,
  now: Date,
): Promise<{
  provenance: AiStudyInputProvenance;
  facts: readonly Record<string, unknown>[];
}> {
  const panel = await loadAlpacaMarketPanel({ publicDemo, now });
  const fetchedAt = panel.fetchedAt;
  const core = ["SPY", "QQQ", "BTC/USD"];
  const quotes = panel.quotes
    .filter((q) => core.includes(q.symbol))
    .map((q) => ({
      symbol: q.symbol,
      latestPrice: q.latestPrice,
      dailyChangePct: q.dailyChangePct,
      timestamp: q.timestamp,
      status: q.status,
      source: q.source,
      error: q.error,
    }));
  const anyAvailable = quotes.some((q) => q.latestPrice !== null);
  const anyStale = quotes.some((q) => q.status === "stale");

  if (panel.status === "synthetic_demo") {
    return {
      provenance: input({
        id: "market_quotes",
        status: "fixture",
        sourceLabel: "synthetic_demo",
        note: "Synthetic demo market quotes",
        provider: "synthetic_demo",
        sessionDate: null,
        fetchedAt,
        freshness: "fixture",
      }),
      facts: quotes,
    };
  }
  if (!anyAvailable) {
    return {
      provenance: input({
        id: "market_quotes",
        status: "unavailable",
        sourceLabel: "alpaca",
        note: panel.message,
        provider: "alpaca",
        sessionDate: null,
        fetchedAt,
        freshness: "unavailable",
      }),
      facts: quotes,
    };
  }
  return {
    provenance: input({
      id: "market_quotes",
      status: anyStale ? "partial" : "available",
      sourceLabel: "alpaca",
      note: anyStale ? "Some Alpaca quotes are stale" : undefined,
      provider: "alpaca",
      sessionDate: null,
      fetchedAt,
      freshness: anyStale ? "stale" : "live",
    }),
    facts: quotes,
  };
}

export interface CollectAiStudyInputsOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly now?: Date;
  readonly sessionDate?: string | null;
  readonly dataRoot?: string;
  readonly publicDemo?: boolean;
}

export async function collectAiStudyInputs(
  options: CollectAiStudyInputsOptions = {},
): Promise<AiStudyInputPacket> {
  const env = options.env ?? process.env;
  const publicDemo = options.publicDemo ?? false;
  const now = options.now ?? new Date();
  const dataRoot = options.dataRoot ?? resolveRuntimeDataRoot(env);
  const historicalMode = isHistoricalAiStudySession(options.sessionDate);
  const targetSession = publicDemo
    ? PUBLIC_DEMO_SESSION
    : historicalMode
      ? options.sessionDate!.trim()
      : resolveCurrentMarketSessionDate(now);
  const mode: AiStudyInputPacket["mode"] = historicalMode ? "historical" : "current";

  if (!publicDemo) {
    await ensureMacroDriverArtifact({ dataRoot, env });
    await loadBoundedGammaDeskViewAsync({
      symbol: "SPY",
      dataRoot: join(dataRoot, "gamma", "providers", "marketdata-app"),
      publicDemo: false,
      env,
    });
  }

  const macro = summarizeMacro(publicDemo, targetSession, dataRoot);
  const catalystFeed = publicDemo
    ? loadCatalystFeed({}, { publicDemo, now, dataRoot })
    : await loadCatalystFeedAsync({}, { publicDemo, now, dataRoot, env });
  const catalysts = summarizeCatalystsFromFeed(catalystFeed, publicDemo, now);
  const gamma = summarizeGamma(publicDemo, targetSession, dataRoot);
  const quotes = await summarizeMarketQuotes(publicDemo, now);
  const sessionDate = targetSession;

  const inputs: AiStudyInputProvenance[] = [
    macro.provenance,
    catalysts.provenance,
    gamma.provenance,
    quotes.provenance,
  ];

  const facts: AiStudyFacts = {
    sessionDate,
    macro: macro.facts,
    catalysts: catalysts.facts,
    gammaStructure: gamma.facts,
    marketQuotes: quotes.facts,
  };

  const sessionAlignment = buildSessionAlignment({
    targetSessionDate: sessionDate,
    inputs,
  });

  const evidence = buildAiStudyEvidenceCorpus(facts, inputs);
  const blockReason =
    !publicDemo && historicalMode && !sessionAlignment.aligned
      ? `Session alignment conflict: ${sessionAlignment.conflicts.join("; ")}`
      : null;

  return {
    sessionDate,
    mode,
    inputs,
    facts,
    sessionAlignment,
    evidenceIds: evidence.map((e) => e.id),
    blocked: Boolean(blockReason),
    blockReason,
  };
}
