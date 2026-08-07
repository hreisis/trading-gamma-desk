import { CommandCenter } from "@/app/components/v2/CommandCenter";
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

  return <CommandCenter view={view} lang={lang} demoMode={demoMode} />;
}
