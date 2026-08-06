import { CommandCenter } from "@/app/components/v2/CommandCenter";
import {
  buildV2CommandCenterView,
  loadBoundedGammaDeskView,
  resolveDeskRequest,
  type BoundedGammaDeskView,
  type V2Language,
} from "@/desk";

export const dynamic = "force-dynamic";

function unavailableQqqView(): BoundedGammaDeskView {
  return {
    status: "empty",
    snapshot: null,
    sourceLabel: "QQQ demo fixture not configured",
    isFixture: false,
    error: {
      code: "empty",
      message: "QQQ is unavailable because the demo must not reuse the SPY fixture.",
    },
  };
}

export default async function V2Page({
  searchParams,
}: {
  searchParams: Promise<{
    source?: string;
    gamma?: string;
    lang?: string;
    preview?: string;
  }>;
}) {
  const params = await searchParams;
  const lang: V2Language = params.lang === "zh" ? "zh" : "en";
  const macro = resolveDeskRequest({ source: params.source });
  const forceFixture = params.gamma === "fixture";
  const spyGamma = loadBoundedGammaDeskView({
    symbol: "SPY",
    forceFixture,
    publicDemo: macro.isPublicDemo,
  });
  const qqqGamma =
    macro.isPublicDemo || forceFixture
      ? unavailableQqqView()
      : loadBoundedGammaDeskView({ symbol: "QQQ", publicDemo: false });

  const view = buildV2CommandCenterView({
    driver: macro.driver,
    spyGamma,
    qqqGamma,
    methodologyPreview: params.preview === "1",
  });

  return <CommandCenter view={view} lang={lang} />;
}

