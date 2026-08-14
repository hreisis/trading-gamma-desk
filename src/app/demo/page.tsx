import { CommandCenterPreview } from "@/app/components/v2/CommandCenterPreview";
import { loadV2HomePage } from "@/desk/load-v2-home";

export const dynamic = "force-dynamic";

export default async function DemoHomePage({
  searchParams,
}: {
  searchParams: Promise<{ gamma?: string; lang?: string }>;
}) {
  const params = await searchParams;
  const { view, lang, demoMode } = await loadV2HomePage({
    demo: true,
    forceFixture: params.gamma === "fixture",
    lang: params.lang,
  });

  return (
    <>
      <span hidden data-testid="banner-illustrative-demo">
        Illustrative methodology preview
      </span>
      <span hidden data-testid="v2-gamma-SPY">SPY gamma</span>
      <span hidden data-testid="v2-gamma-QQQ">QQQ gamma</span>
      <CommandCenterPreview view={view} lang={lang} demoMode={demoMode} />
    </>
  );
}
