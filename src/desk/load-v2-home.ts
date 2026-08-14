import { join } from "node:path";
import {
  buildV2AiStudyPayload,
  generateV2CommandAiStudyInterpretation,
  previewV2AiStudyInterpretation,
} from "@/ai-study/v2-command-interpret";
import { loadAiStudyLlmConfig } from "@/ai-study/config";
import type {
  V2AiStudyInterpretation,
  V2CommandCenterView,
  V2Language,
} from "./v2-command-center";
import {
  buildV2CommandCenterView,
  eventGateFromMarketInput,
  sectorRotationBarSymbols,
  summarizeSpyBreadthFromDurable,
} from "./v2-command-center";
import {
  loadBoundedGammaDeskView,
  type LoadBoundedGammaOptions,
} from "./load-bounded-gamma";
import {
  resolveDeskRequest,
  type DeskSourceQuery,
} from "./resolve-desk-request";
import {
  loadBoundedGammaDeskViewAsync,
  resolveDeskRequestAsync,
} from "./production-runtime";
import { loadAlpacaMarketPanel } from "@/alpaca";
import { mergeMacroAlpacaWatchlist } from "@/desk/macro-display-returns";
import { resolveAlpacaWatchlist } from "@/alpaca/config";
import { loadAlpacaDailyBarPanel } from "@/desk/breadth/bars/alpaca-panel";
import type { DailyBar } from "@/desk/breadth/bars/types";
import { resolveRuntimeDataRoot } from "@/desk/production-runtime";
import { resolveRuntimeJsonStore } from "@/desk/runtime-store";
import { resolveLastCompletedMarketSessionDate } from "@/ai-study/session";
import {
  buildMarketInputSnapshot,
} from "./build-market-input-snapshot";
import { loadCatalystFeedAsync } from "./production-runtime";
import {
  ensureDurableSpyBreadthForMarketInput,
  ensureDurableQqqBreadthForMarketInput,
} from "./breadth/read-durable-breadth";
import {
  buildDeterministicV2DailyReview,
  buildV2DailyReview,
  maybePersistCommandCenterV1Daily,
  type V2DailyReview,
} from "./command-center-v1";
import { generateV2DailyReviewInterpretation } from "@/ai-study/v2-daily-review-interpret";

export interface LoadV2HomePageInput {
  readonly demo: boolean;
  readonly source?: DeskSourceQuery | string | null;
  readonly forceFixture?: boolean;
}

export type V2CommandCenterPageView = V2CommandCenterView & {
  readonly aiStudy: V2AiStudyInterpretation;
  readonly dailyReview: V2DailyReview;
};

export interface V2HomePageModel {
  readonly view: V2CommandCenterPageView;
  readonly lang: V2Language;
  readonly demoMode: boolean;
}

export function parseV2Language(raw: string | undefined): V2Language {
  return raw === "zh" ? "zh" : "en";
}

async function loadGamma(
  symbol: "SPY" | "QQQ",
  options: Pick<LoadBoundedGammaOptions, "forceFixture" | "publicDemo">,
  demo: boolean,
  runtime: {
    readonly dataRoot: string;
    readonly gammaDataRoot: string;
    readonly now: Date;
    readonly env: NodeJS.ProcessEnv;
  },
) {
  if (demo) {
    return loadBoundedGammaDeskView({
      symbol,
      forceFixture: options.forceFixture,
      publicDemo: true,
    });
  }
  return loadBoundedGammaDeskViewAsync({
    symbol,
    forceFixture: options.forceFixture,
    publicDemo: false,
    dataRoot: runtime.gammaDataRoot,
    env: runtime.env,
    now: runtime.now,
  });
}

export async function loadV2HomePage(
  input: LoadV2HomePageInput & { readonly lang?: string },
): Promise<V2HomePageModel> {
  const lang = parseV2Language(input.lang);
  const forceFixture = input.forceFixture === true;
  const now = new Date();
  const targetMarketSessionDate = resolveLastCompletedMarketSessionDate(now);
  const dataRoot = resolveRuntimeDataRoot(process.env);
  const runtimeEnv = process.env;
  const artifactStore = resolveRuntimeJsonStore(runtimeEnv);
  const gammaDataRoot = join(dataRoot, "gamma", "providers", "marketdata-app");

  const macro = input.demo
    ? resolveDeskRequest({ demoPath: true, publicDemo: true })
    : await resolveDeskRequestAsync({
        source: input.source,
        publicDemo: false,
        dataRoot,
      });

  const gammaOptions = { forceFixture, publicDemo: input.demo } as const;
  const gammaRuntime = {
    dataRoot,
    gammaDataRoot,
    now,
    env: runtimeEnv,
  };

  const [spyGamma, qqqGamma, spyBreadthLoad, qqqBreadthLoad, marketPanel, equityBars, catalystFeed] =
    await Promise.all([
    loadGamma("SPY", gammaOptions, input.demo, gammaRuntime),
    loadGamma("QQQ", gammaOptions, input.demo, gammaRuntime),
    input.demo
      ? Promise.resolve({
          snapshot: null,
          sourceArtifact: null,
          missingReason: "SPY breadth is not computed on the public demo path.",
        })
      : ensureDurableSpyBreadthForMarketInput({
          targetMarketSessionDate,
          publicDemo: false,
          dataRoot,
          env: runtimeEnv,
        }).catch((error: unknown) => {
          const detail =
            error instanceof Error ? error.message : String(error);
          return {
            snapshot: null,
            sourceArtifact: null,
            missingReason: `Durable breadth read failed: ${detail}`,
          };
        }),
    input.demo
      ? Promise.resolve({
          snapshot: null,
          sourceArtifact: null,
          missingReason: "QQQ breadth is not computed on the public demo path.",
        })
      : ensureDurableQqqBreadthForMarketInput({
          targetMarketSessionDate,
          publicDemo: false,
          dataRoot,
          env: runtimeEnv,
        }).catch((error: unknown) => {
          const detail =
            error instanceof Error ? error.message : String(error);
          return {
            snapshot: null,
            sourceArtifact: null,
            missingReason: `Durable QQQ breadth read failed: ${detail}`,
          };
        }),
    loadAlpacaMarketPanel({
      publicDemo: input.demo,
      now,
      env: runtimeEnv,
      symbols: mergeMacroAlpacaWatchlist(resolveAlpacaWatchlist(runtimeEnv)),
    }).catch(() => null),
    loadAlpacaDailyBarPanel({
      symbols: [...new Set(["QQQ", ...sectorRotationBarSymbols()])],
      env: runtimeEnv,
      dataRoot,
    }).catch(() => null),
    input.demo
      ? Promise.resolve(null)
      : loadCatalystFeedAsync({}, {
          publicDemo: false,
          now,
          dataRoot,
          env: runtimeEnv,
        }).catch(() => null),
  ]);

  const equityBarsBySymbol = new Map<string, readonly DailyBar[]>();
  if (equityBars?.seriesBySymbol) {
    for (const [symbol, series] of equityBars.seriesBySymbol.entries()) {
      equityBarsBySymbol.set(symbol, series.bars);
    }
  }

  const marketInputSnapshot = buildMarketInputSnapshot({
    targetMarketSessionDate,
    generatedAt: now.toISOString(),
    macro,
    alpacaPanel: marketPanel,
    catalystFeed,
    spyGamma,
    qqqGamma,
    publicDemo: input.demo,
    breadthInternals: spyBreadthLoad.snapshot,
    breadthDurableMeta: {
      sourceArtifact: spyBreadthLoad.sourceArtifact,
      unavailableReason: spyBreadthLoad.missingReason,
    },
  });

  const baseView = await buildV2CommandCenterView({
    driver: macro.driver,
    spyGamma,
    qqqGamma,
    methodologyPreview: input.demo,
    spyBreadth: summarizeSpyBreadthFromDurable(spyBreadthLoad, input.demo),
    qqqBreadth: summarizeSpyBreadthFromDurable(qqqBreadthLoad, input.demo),
    marketQuotes: marketPanel?.quotes,
    equityBarsBySymbol,
    now,
    marketInputSnapshot,
    dataRoot,
    artifactStore: input.demo ? undefined : artifactStore,
    barPanelLatestSession: equityBars?.provenance.latestSessionDate ?? null,
    forceRiskDecisionDaily:
      runtimeEnv.GAMMADESK_FORCE_RISK_DECISION_DAILY === "1" ||
      runtimeEnv.GAMMADESK_FORCE_COMMAND_CENTER_SNAPSHOT === "1",
  });

  if (!input.demo) {
    await maybePersistCommandCenterV1Daily({
      dataRoot,
      artifactStore,
      view: baseView,
      generatedAt: now.toISOString(),
      now,
      force: runtimeEnv.GAMMADESK_FORCE_COMMAND_CENTER_SNAPSHOT === "1",
    });
  }

  const llmEnv: NodeJS.ProcessEnv = {
    ...runtimeEnv,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    AI_STUDY_LLM_MODEL: process.env.AI_STUDY_LLM_MODEL,
  };

  const { review: deterministicReview, context: dailyReviewContext } =
    await buildDeterministicV2DailyReview({
      now,
      demo: input.demo,
      dataRoot,
      artifactStore: input.demo ? undefined : artifactStore,
      equityBarsBySymbol,
    });

  const dailyReview =
    input.demo || deterministicReview.status !== "ready" || !dailyReviewContext
      ? deterministicReview
      : await generateV2DailyReviewInterpretation({
          review: deterministicReview,
          context: dailyReviewContext,
          view: baseView,
          config: loadAiStudyLlmConfig(llmEnv),
          env: llmEnv,
        });

  const eventGate = eventGateFromMarketInput(marketInputSnapshot);
  const payload = buildV2AiStudyPayload(baseView, eventGate);
  const aiStudy = input.demo
    ? previewV2AiStudyInterpretation()
    : await generateV2CommandAiStudyInterpretation({
        payload,
        config: loadAiStudyLlmConfig(llmEnv),
        env: llmEnv,
      });

  const view: V2CommandCenterPageView = { ...baseView, aiStudy, dailyReview };

  return { view, lang, demoMode: input.demo };
}
