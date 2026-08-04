import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadAlpacaMarketPanel } from "@/alpaca";
import { StudyEvidenceBundle } from "@/contracts";
import type { AiStudyInputProvenance } from "@/contracts/ai-study-briefing";
import { loadCatalystFeed } from "@/catalyst";
import { resolveDeskRequest } from "@/desk";
import { loadBoundedGammaDeskView } from "@/desk/load-bounded-gamma";
import { isPublicDemoMode, PUBLIC_DEMO_SESSION } from "@/desk/public-demo";
import { buildMarketStructureStateV2 } from "@/gamma/structure-state-v2";
import { studyEvidenceBundlePath } from "@/studies/pipeline-store";
import evidenceFixture from "../../fixtures/studies/evidence-bundle.m62.json";

export interface AiStudyFacts {
  readonly sessionDate: string | null;
  readonly macro: Record<string, unknown> | null;
  readonly marketTemperature: null;
  readonly catalysts: readonly Record<string, unknown>[];
  readonly gammaStructure: Record<string, unknown> | null;
  readonly marketQuotes: readonly Record<string, unknown>[];
  readonly historicalStudy: Record<string, unknown> | null;
}

export interface AiStudyInputPacket {
  readonly sessionDate: string | null;
  readonly inputs: readonly AiStudyInputProvenance[];
  readonly facts: AiStudyFacts;
}

function input(
  id: AiStudyInputProvenance["id"],
  status: AiStudyInputProvenance["status"],
  sourceLabel: string,
  note?: string,
): AiStudyInputProvenance {
  return { id, status, sourceLabel, ...(note ? { note } : {}) };
}

function summarizeMacro(publicDemo: boolean): {
  provenance: AiStudyInputProvenance;
  facts: Record<string, unknown> | null;
  sessionDate: string | null;
} {
  const view = resolveDeskRequest({ publicDemo });
  if (view.status !== "ready" || !view.driver) {
    return {
      provenance: input(
        "macro",
        "unavailable",
        view.sourceLabel ?? "macro desk",
        view.error?.message ?? "No DominantDriver available",
      ),
      facts: null,
      sessionDate: null,
    };
  }
  const driver = view.driver;
  return {
    sessionDate: driver.marketSessionDate,
    provenance: input(
      "macro",
      view.isDemo || view.isPublicDemo ? "fixture" : "available",
      view.sourceLabel ?? "DominantDriver",
      view.isPublicDemo ? "Synthetic demo macro fixture" : undefined,
    ),
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

function summarizeCatalysts(publicDemo: boolean): {
  provenance: AiStudyInputProvenance;
  facts: readonly Record<string, unknown>[];
} {
  const feed = loadCatalystFeed({}, { publicDemo });
  const events = feed.catalysts.slice(0, 8).map((c) => ({
    id: c.id,
    headline: c.headline,
    category: c.category,
    status: c.status,
    importance: c.importance,
    occurredAt: c.occurredAt,
    direction: c.direction,
    synthetic: c.synthetic,
  }));
  if (events.length === 0) {
    return {
      provenance: input(
        "catalysts",
        "unavailable",
        feed.source.type,
        feed.disclaimer ?? "No catalyst events in feed window",
      ),
      facts: [],
    };
  }
  const hasSynthetic = events.some((e) => e.synthetic);
  return {
    provenance: input(
      "catalysts",
      publicDemo || hasSynthetic ? "fixture" : "available",
      publicDemo ? "synthetic_fixtures" : feed.source.type,
      publicDemo
        ? "Synthetic demo catalyst fixtures"
        : hasSynthetic
          ? "Feed includes synthetic catalyst rows"
          : undefined,
    ),
    facts: events,
  };
}

function summarizeGamma(publicDemo: boolean): {
  provenance: AiStudyInputProvenance;
  facts: Record<string, unknown> | null;
} {
  const view = loadBoundedGammaDeskView({ publicDemo, symbol: "SPY" });
  if (view.status !== "ready" || !view.snapshot) {
    return {
      provenance: input(
        "gamma_structure",
        "unavailable",
        view.sourceLabel,
        view.error?.message ?? "Bounded gamma unavailable",
      ),
      facts: null,
    };
  }
  const snap = view.snapshot;
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
    provenance: input(
      "gamma_structure",
      view.isFixture ? "fixture" : snap.status === "available" ? "available" : "partial",
      view.sourceLabel,
      view.isFixture
        ? "Synthetic bounded gamma fixture"
        : snap.status !== "available"
          ? `Bounded gamma status: ${snap.status}`
          : undefined,
    ),
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

async function summarizeMarketQuotes(publicDemo: boolean): Promise<{
  provenance: AiStudyInputProvenance;
  facts: readonly Record<string, unknown>[];
}> {
  const panel = await loadAlpacaMarketPanel({ publicDemo });
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
  if (panel.status === "synthetic_demo") {
    return {
      provenance: input(
        "market_quotes",
        "fixture",
        "synthetic_demo",
        "Synthetic demo market quotes",
      ),
      facts: quotes,
    };
  }
  if (!anyAvailable) {
    return {
      provenance: input(
        "market_quotes",
        "unavailable",
        "alpaca",
        panel.message,
      ),
      facts: quotes,
    };
  }
  return {
    provenance: input("market_quotes", "available", "alpaca"),
    facts: quotes,
  };
}

function summarizeHistoricalStudy(
  sessionDate: string | null,
  publicDemo: boolean,
): {
  provenance: AiStudyInputProvenance;
  facts: Record<string, unknown> | null;
} {
  if (publicDemo) {
    const bundle = StudyEvidenceBundle.parse(evidenceFixture);
    return {
      provenance: input(
        "historical_study",
        "fixture",
        "fixtures/studies/evidence-bundle.m62.json",
        "Synthetic demo historical study fixture",
      ),
      facts: {
        evidenceStatus: bundle.evidenceStatus,
        primaryHorizon: bundle.primaryHorizon,
        cohortQuality: bundle.cohortQuality,
        matchedStudyIds: bundle.cohortQuality.matchedStudyIds,
        horizonSummary: {
          d1: bundle.horizonEvidence.d1?.aggregate?.status,
          d5: bundle.horizonEvidence.d5?.aggregate?.status,
          d20: bundle.horizonEvidence.d20?.aggregate?.status,
        },
      },
    };
  }

  const date = sessionDate ?? "";
  const dataRoot = join(process.cwd(), "data");
  const path = date
    ? studyEvidenceBundlePath(dataRoot, date, "SPY")
    : null;
  if (!path || !existsSync(path)) {
    return {
      provenance: input(
        "historical_study",
        "unavailable",
        "local_store",
        sessionDate
          ? `No evidence bundle at data/studies/evidence/${sessionDate}/SPY/`
          : "Session date unknown — cannot resolve historical study",
      ),
      facts: null,
    };
  }
  try {
    const bundle = StudyEvidenceBundle.parse(
      JSON.parse(readFileSync(path, "utf8")),
    );
    return {
      provenance: input(
        "historical_study",
        "available",
        `data/studies/evidence/${date}/SPY/evidence-bundle.json`,
      ),
      facts: {
        evidenceStatus: bundle.evidenceStatus,
        primaryHorizon: bundle.primaryHorizon,
        cohortQuality: bundle.cohortQuality,
        matchedStudyIds: bundle.cohortQuality.matchedStudyIds,
        horizonSummary: {
          d1: bundle.horizonEvidence.d1?.aggregate?.status,
          d5: bundle.horizonEvidence.d5?.aggregate?.status,
          d20: bundle.horizonEvidence.d20?.aggregate?.status,
        },
      },
    };
  } catch {
    return {
      provenance: input(
        "historical_study",
        "unavailable",
        path,
        "Evidence bundle present but invalid",
      ),
      facts: null,
    };
  }
}

export async function collectAiStudyInputs(
  env: NodeJS.ProcessEnv = process.env,
): Promise<AiStudyInputPacket> {
  const publicDemo = isPublicDemoMode(env);
  const macro = summarizeMacro(publicDemo);
  const catalysts = summarizeCatalysts(publicDemo);
  const gamma = summarizeGamma(publicDemo);
  const quotes = await summarizeMarketQuotes(publicDemo);
  const sessionDate =
    macro.sessionDate ?? (publicDemo ? PUBLIC_DEMO_SESSION : null);
  const historical = summarizeHistoricalStudy(sessionDate, publicDemo);

  const inputs: AiStudyInputProvenance[] = [
    macro.provenance,
    input(
      "market_temperature",
      "unavailable",
      "not_implemented",
      "Market Temperature is backlog — not computed in this MVP",
    ),
    catalysts.provenance,
    gamma.provenance,
    quotes.provenance,
    historical.provenance,
  ];

  return {
    sessionDate,
    inputs,
    facts: {
      sessionDate,
      macro: macro.facts,
      marketTemperature: null,
      catalysts: catalysts.facts,
      gammaStructure: gamma.facts,
      marketQuotes: quotes.facts,
      historicalStudy: historical.facts,
    },
  };
}
