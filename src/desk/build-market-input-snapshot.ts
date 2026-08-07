import { loadAlpacaMarketPanel } from "@/alpaca";
import { loadCatalystFeedAsync } from "@/catalyst";
import {
  ASSET_REGISTRY,
  deriveMarketInputSnapshotSummary,
  MarketInputField,
  MarketInputKey,
  MarketInputSnapshot,
  MARKET_INPUT_LABELS,
  MARKET_INPUT_SNAPSHOT_SCHEMA_VERSION,
  type MacroSymbol,
} from "@/contracts";
import type { AlpacaMarketPanel } from "@/contracts/alpaca-market";
import { resolveLastCompletedMarketSessionDate } from "@/ai-study/session";
import { filterTier1Catalysts } from "@/catalyst/public-feed";
import type { CatalystFeedResponse } from "@/catalyst/types";
import { sessionDateFromIso } from "@/gamma/marketdata-app/time";
import {
  loadBoundedGammaDeskView,
  type BoundedGammaDeskView,
} from "./load-bounded-gamma";
import { isSessionStale, type MacroDeskView } from "./load-macro-desk";
import {
  loadBoundedGammaDeskViewAsync,
  resolveDeskRequestAsync,
} from "./production-runtime";
import { resolveDeskRequest } from "./resolve-desk-request";

const GAMMA_FLIP_UNAVAILABLE_REASON =
  "Gamma Flip is not estimated; requires recomputing gamma from spot, IV, rates, and time-to-expiry rather than interpolating strike GEX";

import type { BreadthInternalsSnapshot } from "@/contracts/breadth-internals";

const NO_VIX_TERM_STRUCTURE_REASON =
  "VIX term structure and positioning ingest is not implemented (no VIX9D/VIX3M/VVIX source).";

const NO_CREDIT_REASON =
  "Credit stress ingest is not implemented (no HYG/LQD or spread series in ASSET_REGISTRY).";

import { buildEventGate } from "./event-gate/build-event-gate";
import { loadDurableSpyBreadthForMarketInput } from "./breadth/read-durable-breadth";

const LEADERSHIP_ROTATION_MISSING_REASON =
  "Leadership rotation ingest is not implemented (V2-3B3 scope: SPY breadth only).";

export interface BuildMarketInputSnapshotInput {
  readonly targetMarketSessionDate: string;
  readonly generatedAt: string;
  readonly macro: MacroDeskView | null;
  readonly alpacaPanel: AlpacaMarketPanel | null;
  readonly catalystFeed: CatalystFeedResponse | null;
  readonly spyGamma: BoundedGammaDeskView;
  readonly qqqGamma: BoundedGammaDeskView;
  readonly publicDemo: boolean;
  readonly breadthInternals?: BreadthInternalsSnapshot | null;
  readonly breadthDurableMeta?: {
    readonly sourceArtifact?: string | null;
    readonly unavailableReason?: string | null;
  };
}

function missingField(
  key: MarketInputKey,
  reason: string,
): MarketInputField {
  return {
    key,
    label: MARKET_INPUT_LABELS[key],
    value: null,
    asOf: null,
    marketSessionDate: null,
    source: {
      provider: "none",
      artifact: "not_wired",
      fetchedAt: null,
    },
    status: "missing",
    stale: false,
    missingReason: reason,
    isProxy: false,
  };
}

function quoteSessionDate(timestamp: string | null): string | null {
  if (!timestamp) return null;
  try {
    return sessionDateFromIso(timestamp);
  } catch {
    return null;
  }
}

function deriveBreadthInternalsField(
  breadth: BreadthInternalsSnapshot | null | undefined,
  targetSession: string,
  publicDemo: boolean,
  durableMeta?: {
    readonly sourceArtifact?: string | null;
    readonly unavailableReason?: string | null;
  },
): MarketInputField {
  if (publicDemo) {
    return {
      key: "breadth_internals",
      label: MARKET_INPUT_LABELS.breadth_internals,
      value: null,
      asOf: null,
      marketSessionDate: null,
      source: {
        provider: "none",
        artifact: "not_wired_demo",
        fetchedAt: null,
      },
      status: "unavailable",
      stale: false,
      missingReason: "SPY breadth is not computed on the public demo path.",
      isProxy: false,
    };
  }
  if (!breadth) {
    return {
      key: "breadth_internals",
      label: MARKET_INPUT_LABELS.breadth_internals,
      value: null,
      asOf: null,
      marketSessionDate: null,
      source: {
        provider: "durable_breadth_snapshot",
        artifact:
          durableMeta?.sourceArtifact ?? "breadth/spy_etf_holdings/latest.json",
        fetchedAt: null,
      },
      status: "unavailable",
      stale: false,
      missingReason:
        durableMeta?.unavailableReason ??
        "SPY breadth could not be loaded from durable snapshot store.",
      isProxy: false,
    };
  }
  const fieldStatus =
    breadth.status === "available"
      ? "available"
      : breadth.status === "partial"
        ? "partial"
        : "unavailable";
  return {
    key: "breadth_internals",
    label: MARKET_INPUT_LABELS.breadth_internals,
    value: breadth,
    asOf: breadth.asOf,
    marketSessionDate: breadth.marketSessionDate,
    source: {
      provider: "durable_breadth_snapshot",
      artifact:
        durableMeta?.sourceArtifact ??
        `breadth/spy_etf_holdings/snapshots/${breadth.marketSessionDate}.json`,
      fetchedAt: breadth.bars.fetchedAt,
    },
    status: fieldStatus,
    stale: breadth.stale,
    missingReason: breadth.missingReason,
    isProxy: false,
  };
}

function deriveQuoteField(
  key: Extract<MarketInputKey, "spy_quote" | "qqq_quote">,
  symbol: "SPY" | "QQQ",
  panel: AlpacaMarketPanel | null,
  targetSession: string,
): MarketInputField {
  const label = MARKET_INPUT_LABELS[key];
  if (!panel) {
    return {
      key,
      label,
      value: null,
      asOf: null,
      marketSessionDate: null,
      source: {
        provider: "alpaca",
        artifact: "src/alpaca/load-market-panel.ts",
        fetchedAt: null,
      },
      status: "unavailable",
      stale: false,
      missingReason: "Alpaca market panel was not loaded.",
      isProxy: false,
    };
  }

  const quote = panel.quotes.find((q) => q.symbol === symbol);
  const sessionDate = quoteSessionDate(quote?.timestamp ?? null);
  const crossSession =
    sessionDate !== null && sessionDate !== targetSession;
  const stale =
    quote?.status === "stale" ||
    crossSession ||
    panel.status === "partial";
  const status =
    quote?.status === "available" && !crossSession
      ? "available"
      : quote?.status === "stale" || crossSession
        ? "partial"
        : panel.status === "synthetic_demo"
          ? "partial"
          : "unavailable";

  return {
    key,
    label,
    value:
      quote && quote.latestPrice !== null
        ? {
            symbol,
            latestPrice: quote.latestPrice,
            dailyChangePct: quote.dailyChangePct,
            quoteStatus: quote.status,
          }
        : null,
    asOf: quote?.timestamp ?? panel.fetchedAt,
    marketSessionDate: sessionDate,
    source: {
      provider: panel.status === "synthetic_demo" ? "synthetic_demo" : "alpaca",
      artifact:
        panel.status === "synthetic_demo"
          ? "src/alpaca/demo-fixtures.ts"
          : "GET /v2/stocks/snapshots",
      fetchedAt: panel.fetchedAt,
    },
    status,
    stale,
    missingReason:
      quote?.error ??
      (crossSession
        ? `Quote session ${sessionDate} does not match target ${targetSession}.`
        : quote?.status === "unavailable"
          ? "Quote unavailable from Alpaca panel."
          : null),
    isProxy: false,
  };
}

function deriveMacroAssetField(
  key: Extract<MarketInputKey, "us2y" | "us10y" | "usd" | "vix_spot">,
  symbol: MacroSymbol,
  macro: MacroDeskView | null,
  targetSession: string,
): MarketInputField {
  const def = ASSET_REGISTRY[symbol];
  const baseSource = {
    provider: "macro_pipeline",
    artifact: macro?.driverPath ?? "data/drivers/{session}.json",
    fetchedAt: macro?.driver?.generatedAt ?? null,
  };

  if (!macro || macro.status !== "ready" || !macro.driver) {
    return {
      key,
      label: MARKET_INPUT_LABELS[key],
      value: null,
      asOf: macro?.driver?.generatedAt ?? null,
      marketSessionDate: macro?.driver?.marketSessionDate ?? null,
      source: baseSource,
      status: "unavailable",
      stale: macro?.sessionStale === true,
      missingReason:
        macro?.error?.message ?? "No DominantDriver artifact for macro asset.",
      isProxy: def.isProxy,
    };
  }

  const driver = macro.driver;
  const asset = driver.assets.find((row) => row.symbol === symbol);
  const sourceDate = driver.sourceDateByAsset[symbol] ?? asset?.sourceDate ?? null;
  const staleDays = driver.staleDaysByAsset[symbol] ?? asset?.staleDays ?? null;
  const crossSession =
    sourceDate !== null && sourceDate !== targetSession;
  const driverCrossSession = driver.marketSessionDate !== targetSession;
  const stale =
    (staleDays !== null && staleDays > 0) ||
    crossSession ||
    driverCrossSession ||
    isSessionStale(driver);

  let status: MarketInputField["status"] = "unavailable";
  if (asset?.role === "missing" || asset?.value === null) {
    status = "unavailable";
  } else if (driver.sessionAlignment === "partial" || crossSession) {
    status = "partial";
  } else if (stale) {
    status = "partial";
  } else {
    status = "available";
  }

  return {
    key,
    label: MARKET_INPUT_LABELS[key],
    value:
      asset?.value !== null && asset?.value !== undefined
        ? {
            symbol,
            value: asset.value,
            unit: asset.unit,
            zScore: asset.zScore,
            role: asset.role,
            instrument: def.instrument,
          }
        : null,
    asOf: driver.generatedAt,
    marketSessionDate: sourceDate,
    source: baseSource,
    status,
    stale,
    missingReason:
      asset?.role === "missing"
        ? `${symbol} missing from DominantDriver assets.`
        : crossSession
          ? `Macro sourceDate ${sourceDate} does not match target ${targetSession}.`
          : driverCrossSession
            ? `Driver session ${driver.marketSessionDate} does not match target ${targetSession}.`
            : null,
    isProxy: def.isProxy,
  };
}

function deriveCatalystCalendarField(
  feed: CatalystFeedResponse | null,
  targetSession: string,
  generatedAt: string,
): MarketInputField {
  if (!feed) {
    return {
      key: "catalyst_calendar",
      label: MARKET_INPUT_LABELS.catalyst_calendar,
      value: null,
      asOf: null,
      marketSessionDate: null,
      source: {
        provider: "catalyst",
        artifact: "data/catalyst/calendar-latest.json",
        fetchedAt: null,
      },
      status: "unavailable",
      stale: false,
      missingReason: "Catalyst feed was not loaded.",
      isProxy: false,
    };
  }

  const tier1 = filterTier1Catalysts(feed.catalysts);
  const upcoming = [...tier1]
    .filter((c) => Date.parse(c.occurredAt) >= Date.parse(generatedAt))
    .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  const nearest = upcoming[0] ?? null;
  const stale = feed.mode === "stale_calendar";
  const status =
    feed.mode === "live_unavailable"
      ? "unavailable"
      : feed.mode === "stale_calendar"
        ? "partial"
        : feed.source.partialFailure
          ? "partial"
          : "available";

  return {
    key: "catalyst_calendar",
    label: MARKET_INPUT_LABELS.catalyst_calendar,
    value: {
      mode: feed.mode,
      tier1Count: tier1.length,
      upcomingTier1Count: upcoming.length,
      nearestOccurringAt: nearest?.occurredAt ?? null,
      nearestHeadline: nearest?.headline ?? null,
      synthetic: feed.source.synthetic,
    },
    asOf: feed.generatedAt,
    marketSessionDate: targetSession,
    source: {
      provider: feed.source.synthetic ? "synthetic_demo" : "official_calendar",
      artifact: feed.source.synthetic
        ? "fixtures/catalyst/synthetic-events.json"
        : "data/catalyst/calendar-latest.json",
      fetchedAt: feed.source.fetchedAt ?? feed.generatedAt,
    },
    status,
    stale,
    missingReason:
      feed.mode === "live_unavailable"
        ? "Official catalyst calendar cache unavailable."
        : null,
    isProxy: false,
  };
}

function deriveEventGateField(
  feed: CatalystFeedResponse | null,
  targetSession: string,
  generatedAt: string,
  publicDemo: boolean,
): MarketInputField {
  const gate = buildEventGate({
    feed,
    targetMarketSessionDate: targetSession,
    generatedAt,
    publicDemo,
  });

  let fieldStatus: MarketInputField["status"] = "unavailable";
  if (gate.status === "available") fieldStatus = "available";
  else if (gate.status === "partial") fieldStatus = "partial";

  return {
    key: "event_gate",
    label: MARKET_INPUT_LABELS.event_gate,
    value: gate,
    asOf: gate.asOf,
    marketSessionDate: gate.marketSessionDate,
    source: gate.source,
    status: gate.state === "unavailable" ? "unavailable" : fieldStatus,
    stale: gate.stale,
    missingReason: gate.missingReason,
    isProxy: false,
  };
}

function wallStrike(
  wall: NonNullable<BoundedGammaDeskView["snapshot"]>["boundedCallWall"],
): number | null {
  return wall.status === "unavailable" ? null : (wall.strike ?? null);
}

function deriveGammaField(
  key: Extract<MarketInputKey, "spy_gamma" | "qqq_gamma">,
  symbol: "SPY" | "QQQ",
  view: BoundedGammaDeskView,
  targetSession: string,
): MarketInputField {
  const label = MARKET_INPUT_LABELS[key];

  if (view.status === "empty" || view.snapshot === null) {
    return {
      key,
      label,
      value: null,
      asOf: null,
      marketSessionDate: null,
      source: {
        provider: "marketdata_app",
        artifact: view.sourceLabel,
        fetchedAt: null,
      },
      status: view.isFixture ? "partial" : "unavailable",
      stale: false,
      missingReason: view.error?.message ?? "No bounded gamma snapshot.",
      isProxy: false,
    };
  }

  const snapshot = view.snapshot;
  const crossSession = snapshot.sessionDate !== targetSession;
  const stale = crossSession;
  let status: MarketInputField["status"] = "available";
  if (snapshot.status === "unavailable") status = "unavailable";
  else if (snapshot.status === "incomplete") status = "incomplete";
  else if (snapshot.status === "partial" || crossSession || view.isFixture) {
    status = "partial";
  }

  const putWall = wallStrike(snapshot.boundedPutWall);
  const callWall = wallStrike(snapshot.boundedCallWall);

  return {
    key,
    label,
    value: {
      symbol,
      scope: snapshot.scope,
      spot: snapshot.spot,
      boundedPutWall: putWall,
      boundedCallWall: callWall,
      gammaRegime: snapshot.gammaRegime,
      snapshotStatus: snapshot.status,
      vendorAsOf: snapshot.vendorAsOf,
      gammaFlip: {
        status: "unavailable" as const,
        reason: GAMMA_FLIP_UNAVAILABLE_REASON,
      },
      coverage: {
        contractsUsed: snapshot.coverage.contractsUsed,
        contractsIn: snapshot.coverage.contractsIn,
        usableGammaCoveragePct: snapshot.coverage.usableGammaCoveragePct ?? null,
      },
    },
    asOf: snapshot.vendorAsOf,
    marketSessionDate: snapshot.sessionDate,
    source: {
      provider: "marketdata_app",
      artifact: view.sourceLabel,
      fetchedAt: snapshot.source.fetchedAt,
    },
    status,
    stale,
    missingReason: crossSession
      ? `Gamma session ${snapshot.sessionDate} does not match target ${targetSession}.`
      : snapshot.status === "incomplete"
        ? snapshot.limitations.join(" · ") || "Bounded gamma snapshot incomplete."
        : null,
    isProxy: false,
  };
}

export function buildMarketInputSnapshot(
  input: BuildMarketInputSnapshotInput,
): MarketInputSnapshot {
  const inputs: MarketInputField[] = [
    deriveQuoteField("spy_quote", "SPY", input.alpacaPanel, input.targetMarketSessionDate),
    deriveQuoteField("qqq_quote", "QQQ", input.alpacaPanel, input.targetMarketSessionDate),
    deriveBreadthInternalsField(
      input.breadthInternals,
      input.targetMarketSessionDate,
      input.publicDemo,
      input.breadthDurableMeta,
    ),
    missingField("leadership_rotation", LEADERSHIP_ROTATION_MISSING_REASON),
    deriveMacroAssetField("vix_spot", "VIX", input.macro, input.targetMarketSessionDate),
    missingField("vix_term_structure", NO_VIX_TERM_STRUCTURE_REASON),
    deriveMacroAssetField("us2y", "US2Y", input.macro, input.targetMarketSessionDate),
    deriveMacroAssetField("us10y", "US10Y", input.macro, input.targetMarketSessionDate),
    deriveMacroAssetField("usd", "USD", input.macro, input.targetMarketSessionDate),
    missingField("credit_stress", NO_CREDIT_REASON),
    deriveCatalystCalendarField(
      input.catalystFeed,
      input.targetMarketSessionDate,
      input.generatedAt,
    ),
    deriveEventGateField(
      input.catalystFeed,
      input.targetMarketSessionDate,
      input.generatedAt,
      input.publicDemo,
    ),
    deriveGammaField("spy_gamma", "SPY", input.spyGamma, input.targetMarketSessionDate),
    deriveGammaField("qqq_gamma", "QQQ", input.qqqGamma, input.targetMarketSessionDate),
  ];

  const { sessionAlignment, isCompleteCrossSection, summary } =
    deriveMarketInputSnapshotSummary(inputs, input.targetMarketSessionDate);

  return MarketInputSnapshot.parse({
    kind: "MarketInputSnapshot",
    schemaVersion: MARKET_INPUT_SNAPSHOT_SCHEMA_VERSION,
    targetMarketSessionDate: input.targetMarketSessionDate,
    generatedAt: input.generatedAt,
    sessionAlignment,
    isCompleteCrossSection,
    inputs,
    summary,
  });
}

export interface LoadMarketInputSnapshotOptions {
  readonly publicDemo?: boolean;
  readonly now?: Date;
  readonly env?: NodeJS.ProcessEnv;
  readonly forceFixture?: boolean;
}

export async function loadMarketInputSnapshot(
  options: LoadMarketInputSnapshotOptions = {},
): Promise<MarketInputSnapshot> {
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const generatedAt = now.toISOString();
  const targetMarketSessionDate = resolveLastCompletedMarketSessionDate(now);
  const publicDemo = options.publicDemo === true;

  const [macro, alpacaPanel, catalystFeed, spyGamma, qqqGamma, breadthLoad] =
    await Promise.all([
      publicDemo
        ? Promise.resolve(
            resolveDeskRequest({ demoPath: true, publicDemo: true }),
          )
        : resolveDeskRequestAsync({ publicDemo: false }),
      loadAlpacaMarketPanel({ publicDemo, env, now }),
      loadCatalystFeedAsync({}, { publicDemo, now, env }),
      publicDemo
        ? Promise.resolve(
            loadBoundedGammaDeskView({
              symbol: "SPY",
              publicDemo: true,
              forceFixture: options.forceFixture,
            }),
          )
        : loadBoundedGammaDeskViewAsync({
            symbol: "SPY",
            publicDemo: false,
            forceFixture: options.forceFixture,
            env,
          }),
      publicDemo
        ? Promise.resolve(
            loadBoundedGammaDeskView({ symbol: "QQQ", publicDemo: true }),
          )
        : loadBoundedGammaDeskViewAsync({
            symbol: "QQQ",
            publicDemo: false,
            forceFixture: options.forceFixture,
            env,
          }),
      loadDurableSpyBreadthForMarketInput({
        targetMarketSessionDate,
        env,
        publicDemo,
      }),
    ]);

  return buildMarketInputSnapshot({
    targetMarketSessionDate,
    generatedAt,
    macro,
    alpacaPanel,
    catalystFeed,
    spyGamma,
    qqqGamma,
    publicDemo,
    breadthInternals: breadthLoad.snapshot,
    breadthDurableMeta: {
      sourceArtifact: breadthLoad.sourceArtifact,
      unavailableReason: breadthLoad.missingReason,
    },
  });
}
