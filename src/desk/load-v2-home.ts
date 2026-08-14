import { join } from "node:path";
import {
  buildV2AiStudyPayload,
  generateV2CommandAiStudyInterpretation,
  previewV2AiStudyInterpretation,
} from "@/ai-study/v2-command-interpret";
import {
  loadAiStudyLlmConfig,
  OPENAI_RESPONSES_URL,
  openAiResponsesReasoningEffort,
  type AiStudyLlmRuntimeConfig,
} from "@/ai-study/config";
import { extractOutputText } from "@/ai-study/openai-utils";
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
import type { AlpacaMarketQuote } from "@/contracts/alpaca-market";
import type { EventGateSnapshot } from "@/contracts/event-gate";
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
  maybePersistCommandCenterV1Daily,
  type V2DailyReview,
} from "./command-center-v1";
import { generateV2DailyReviewInterpretation } from "@/ai-study/v2-daily-review-interpret";
import {
  buildTechnologyInternalSummary,
  buildTechLeadersLaggardsSummary,
  technologyUiBarSymbols,
  type V2TechnologyInternalSummary,
  type V2TechLeadersLaggardsSummary,
} from "./v2-ui-projection";

export interface LoadV2HomePageInput {
  readonly demo: boolean;
  readonly source?: DeskSourceQuery | string | null;
  readonly forceFixture?: boolean;
}

export type V2CommandCenterPageView = V2CommandCenterView & {
  readonly aiStudy: V2AiStudyInterpretation;
  readonly dailyReview: V2DailyReview;
  readonly eventGate: EventGateSnapshot | null;
  readonly marketQuotes: readonly AlpacaMarketQuote[];
  readonly technologyInternal: V2TechnologyInternalSummary;
  readonly techLeadersLaggards: V2TechLeadersLaggardsSummary;
};

export interface V2HomePageModel {
  readonly view: V2CommandCenterPageView;
  readonly lang: V2Language;
  readonly demoMode: boolean;
}

export function parseV2Language(raw: string | undefined): V2Language {
  return raw === "zh" ? "zh" : "en";
}

const V2_ZH_LOCALIZATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["aiStudy", "dailyReview"],
  properties: {
    aiStudy: {
      type: "object",
      additionalProperties: false,
      required: ["regime", "baseCase", "ifThen", "invalidation", "tension", "dataLimitations"],
      properties: {
        regime: { type: "string" },
        baseCase: { type: "string" },
        ifThen: { type: "string" },
        invalidation: { type: "string" },
        tension: { type: "string" },
        dataLimitations: { type: "array", items: { type: "string" } },
      },
    },
    dailyReview: {
      type: "object",
      additionalProperties: false,
      required: ["actualOutcome", "whatWorked", "whatFailed", "errorExplanation", "tomorrowWatch", "dataLimitations"],
      properties: {
        actualOutcome: { type: "string" },
        whatWorked: { type: "array", items: { type: "string" } },
        whatFailed: { type: "array", items: { type: "string" } },
        errorExplanation: { type: "string" },
        tomorrowWatch: { type: "array", items: { type: "string" } },
        dataLimitations: { type: "array", items: { type: "string" } },
      },
    },
  },
} as const;

type V2ZhLocalization = {
  readonly aiStudy: {
    readonly regime: string;
    readonly baseCase: string;
    readonly ifThen: string;
    readonly invalidation: string;
    readonly tension: string;
    readonly dataLimitations: string[];
  };
  readonly dailyReview: {
    readonly actualOutcome: string;
    readonly whatWorked: string[];
    readonly whatFailed: string[];
    readonly errorExplanation: string;
    readonly tomorrowWatch: string[];
    readonly dataLimitations: string[];
  };
};

function validZhLocalization(value: unknown): value is V2ZhLocalization {
  if (!value || typeof value !== "object") return false;
  const root = value as Record<string, unknown>;
  const ai = root.aiStudy as Record<string, unknown> | undefined;
  const review = root.dailyReview as Record<string, unknown> | undefined;
  const strings = (items: unknown) =>
    Array.isArray(items) && items.every((item) => typeof item === "string");
  return Boolean(
    ai &&
      review &&
      typeof ai.regime === "string" &&
      typeof ai.baseCase === "string" &&
      typeof ai.ifThen === "string" &&
      typeof ai.invalidation === "string" &&
      typeof ai.tension === "string" &&
      strings(ai.dataLimitations) &&
      typeof review.actualOutcome === "string" &&
      strings(review.whatWorked) &&
      strings(review.whatFailed) &&
      typeof review.errorExplanation === "string" &&
      strings(review.tomorrowWatch) &&
      strings(review.dataLimitations),
  );
}

async function localizeV2NarrativesToChinese(
  aiStudy: V2AiStudyInterpretation,
  dailyReview: V2DailyReview,
  config: AiStudyLlmRuntimeConfig,
): Promise<{ aiStudy: V2AiStudyInterpretation; dailyReview: V2DailyReview }> {
  if (!config.apiKey) return { aiStudy, dailyReview };

  const source = {
    aiStudy: {
      regime: aiStudy.regime,
      baseCase: aiStudy.baseCase,
      ifThen: aiStudy.ifThen,
      invalidation: aiStudy.invalidation,
      tension: aiStudy.tension,
      dataLimitations: [...aiStudy.dataLimitations],
    },
    dailyReview: {
      actualOutcome: dailyReview.actualOutcome,
      whatWorked: [...dailyReview.whatWorked],
      whatFailed: [...dailyReview.whatFailed],
      errorExplanation: dailyReview.errorExplanation,
      tomorrowWatch: [...dailyReview.tomorrowWatch],
      dataLimitations: [...dailyReview.dataLimitations],
    },
  };

  const reasoning = openAiResponsesReasoningEffort(config.model);
  const body = {
    model: config.model,
    input: [
      {
        role: "system",
        content: [{
          type: "input_text",
          text: "You are the Chinese localization layer for GammaDesk. Translate only the supplied narrative strings into concise natural Simplified Chinese. Preserve every number, percentage, date, ticker, ETF symbol, price level, and technical token exactly. Keep SPY, QQQ, CTA, IV, HV, Gamma, Call Wall, Put Wall, Gamma Flip, Net GEX, ROD, ETF symbols, and enum/status identifiers unchanged when they appear. Do not add analysis, advice, facts, levels, or explanations. Keep array item counts unchanged. Return only the required JSON object.",
        }],
      },
      {
        role: "user",
        content: [{ type: "input_text", text: JSON.stringify(source) }],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "v2_zh_localization",
        strict: true,
        schema: V2_ZH_LOCALIZATION_SCHEMA,
      },
    },
    ...(reasoning ? { reasoning } : {}),
    max_output_tokens: Math.max(1200, config.maxOutputTokens),
  };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await fetch(OPENAI_RESPONSES_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) return { aiStudy, dailyReview };
      const raw = await response.json() as unknown;
      const text = extractOutputText(raw);
      if (!text) return { aiStudy, dailyReview };
      const parsed = JSON.parse(text) as unknown;
      if (!validZhLocalization(parsed)) return { aiStudy, dailyReview };

      return {
        aiStudy: {
          ...aiStudy,
          regime: parsed.aiStudy.regime,
          baseCase: parsed.aiStudy.baseCase,
          ifThen: parsed.aiStudy.ifThen,
          invalidation: parsed.aiStudy.invalidation,
          tension: parsed.aiStudy.tension,
          dataLimitations: parsed.aiStudy.dataLimitations,
        },
        dailyReview: {
          ...dailyReview,
          actualOutcome: parsed.dailyReview.actualOutcome,
          whatWorked: parsed.dailyReview.whatWorked,
          whatFailed: parsed.dailyReview.whatFailed,
          errorExplanation: parsed.dailyReview.errorExplanation,
          tomorrowWatch: parsed.dailyReview.tomorrowWatch,
          dataLimitations: parsed.dailyReview.dataLimitations,
        },
      };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return { aiStudy, dailyReview };
  }
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
          const detail = error instanceof Error ? error.message : String(error);
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
          const detail = error instanceof Error ? error.message : String(error);
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
      symbols: [
        ...new Set([
          "QQQ",
          ...sectorRotationBarSymbols(),
          ...technologyUiBarSymbols(),
        ]),
      ],
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

  const technologyInternal = buildTechnologyInternalSummary(equityBarsBySymbol);
  const techLeadersLaggards = buildTechLeadersLaggardsSummary(equityBarsBySymbol);

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
  const llmConfig = loadAiStudyLlmConfig(llmEnv);

  const { review: deterministicReview, context: dailyReviewContext } =
    await buildDeterministicV2DailyReview({
      now,
      demo: input.demo,
      dataRoot,
      artifactStore: input.demo ? undefined : artifactStore,
      equityBarsBySymbol,
    });

  const dailyReviewRaw =
    input.demo || deterministicReview.status !== "ready" || !dailyReviewContext
      ? deterministicReview
      : await generateV2DailyReviewInterpretation({
          review: deterministicReview,
          context: dailyReviewContext,
          view: baseView,
          config: llmConfig,
          env: llmEnv,
        });

  const eventGate = eventGateFromMarketInput(marketInputSnapshot);
  const payload = buildV2AiStudyPayload(baseView, eventGate);
  const aiStudyRaw = input.demo
    ? previewV2AiStudyInterpretation()
    : await generateV2CommandAiStudyInterpretation({
        payload,
        config: llmConfig,
        env: llmEnv,
      });

  const localized =
    lang === "zh" && !input.demo
      ? await localizeV2NarrativesToChinese(aiStudyRaw, dailyReviewRaw, llmConfig)
      : { aiStudy: aiStudyRaw, dailyReview: dailyReviewRaw };

  const view: V2CommandCenterPageView = {
    ...baseView,
    aiStudy: localized.aiStudy,
    dailyReview: localized.dailyReview,
    eventGate,
    marketQuotes: marketPanel?.quotes ?? [],
    technologyInternal,
    techLeadersLaggards,
  };

  return { view, lang, demoMode: input.demo };
}
