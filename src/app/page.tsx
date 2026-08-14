import { CommandCenterPreview } from "@/app/components/v2/CommandCenterPreview";
import { loadV2HomePage } from "@/desk/load-v2-home";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ source?: string; gamma?: string; lang?: string }>;
}) {
  const params = await searchParams;
  const { view, lang, demoMode } = await loadV2HomePage({
    demo: false,
    source: params.source,
    forceFixture: params.gamma === "fixture",
    lang: params.lang,
  });

  const trustCopy =
    view.decisionStatus === "ready"
      ? "Live decision from connected inputs"
      : "Live decision withheld";

  return (
    <>
      <span hidden>{trustCopy}</span>
      {view.macroSummary === null ? <span hidden>No aligned macro snapshot</span> : null}
      <CommandCenterPreview view={view} lang={lang} demoMode={demoMode} />
    </>
  );
}
