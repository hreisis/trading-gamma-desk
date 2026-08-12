import { join } from "node:path";
import type { V2CommandCenterView, V2Language } from "./v2-command-center";
import {
  buildV2CommandCenterView,
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
import { loadAlpacaDailyBarPanel } from "@/desk/breadth/bars/alpaca-panel";
import { resolveRuntimeDataRoot } from "@/desk/production-runtime";
import { resolveLastCompletedMarketSessionDate } from "@/ai-study/session";
import {
  buildMarketInputSnapshot,
} from "./build-market-input-snapshot";
import { loadCatalystFeedAsync } from "./production-runtime";
import { ensureDurableSpyBreadthForMarketInput } from "./breadth/read-durable-breadth";

export interface LoadV2HomePageInput {
  readonly demo: boolean;
  readonly source?: DeskSourceQuery | string | null;
  readonly forceFixture?: boolean;
}

export interface V2HomePageModel {
  readonly view: V2CommandCenterView;
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
  const gammaDataRoot = join(dataRoot, "gamma", "providers", "marketdata-app");
  const runtimeEnv = process.env;

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

  const [spyGamma, qqqGamma, breadthLoad, marketPanel, equityBars, catalystFeed] =
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
    loadAlpacaMarketPanel({
      publicDemo: input.demo,
      now,
      env: runtimeEnv,
    }).catch(() => null),
    loadAlpacaDailyBarPanel({
      symbols: ["SPY", "QQQ"],
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

  const equityBarsBySymbol = new Map<
    string,
    readonly { sessionDate: string; close: number }[]
  >();
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
    breadthInternals: breadthLoad.snapshot,
    breadthDurableMeta: {
      sourceArtifact: breadthLoad.sourceArtifact,
      unavailableReason: breadthLoad.missingReason,
    },
  });

  const view = buildV2CommandCenterView({
    driver: macro.driver,
    spyGamma,
    qqqGamma,
    methodologyPreview: input.demo,
    spyBreadth: summarizeSpyBreadthFromDurable(breadthLoad, input.demo),
    marketQuotes: marketPanel?.quotes,
    equityBarsBySymbol,
    now,
    marketInputSnapshot,
  });

  return { view, lang, demoMode: input.demo };
}
