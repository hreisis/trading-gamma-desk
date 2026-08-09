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
import { resolveLastCompletedMarketSessionDate } from "@/ai-study/session";
import { loadDurableSpyBreadthForMarketInput } from "./breadth/read-durable-breadth";

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
  });
}

export async function loadV2HomePage(
  input: LoadV2HomePageInput & { readonly lang?: string },
): Promise<V2HomePageModel> {
  const lang = parseV2Language(input.lang);
  const forceFixture = input.forceFixture === true;

  const macro = input.demo
    ? resolveDeskRequest({ demoPath: true, publicDemo: true })
    : await resolveDeskRequestAsync({
        source: input.source,
        publicDemo: false,
      });

  const gammaOptions = { forceFixture, publicDemo: input.demo } as const;
  const now = new Date();
  const targetMarketSessionDate = resolveLastCompletedMarketSessionDate(now);

  const [spyGamma, qqqGamma, breadthLoad] = await Promise.all([
    loadGamma("SPY", gammaOptions, input.demo),
    loadGamma("QQQ", gammaOptions, input.demo),
    input.demo
      ? Promise.resolve({
          snapshot: null,
          sourceArtifact: null,
          missingReason: "SPY breadth is not computed on the public demo path.",
        })
      : loadDurableSpyBreadthForMarketInput({
          targetMarketSessionDate,
          publicDemo: false,
        }).catch((error: unknown) => {
          const detail =
            error instanceof Error ? error.message : String(error);
          return {
            snapshot: null,
            sourceArtifact: null,
            missingReason: `Durable breadth read failed: ${detail}`,
          };
        }),
  ]);

  const view = buildV2CommandCenterView({
    driver: macro.driver,
    spyGamma,
    qqqGamma,
    methodologyPreview: input.demo,
    spyBreadth: summarizeSpyBreadthFromDurable(breadthLoad, input.demo),
  });

  return { view, lang, demoMode: input.demo };
}
