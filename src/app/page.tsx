import { Suspense } from "react";
import { DarkCommandCenter } from "@/app/components/v2/DarkCommandCenter";
import { loadV2HomePage } from "@/desk/load-v2-home";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function MarketHome({
  searchParams,
}: {
  searchParams: Promise<{ source?: string; gamma?: string; lang?: string }>;
}) {
  const params = await searchParams;
  const { view, lang, demoMode, narratives } = await loadV2HomePage({
    demo: false,
    deferNarratives: true,
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
      <DarkCommandCenter view={view} lang={lang} demoMode={demoMode} narratives={narratives} source={params.source} forceFixture={params.gamma === "fixture"} />
    </>
  );
}

export default async function Home({ searchParams }: {
  searchParams: Promise<{ source?: string; gamma?: string; lang?: string }>;
}) {
  const params = await searchParams;
  const zh = params.lang === "zh";
  return <Suspense fallback={<main style={{ minHeight: "100vh", background: "#07111b", color: "#edf3ff", padding: "32px", fontFamily: "system-ui" }} aria-busy="true">
    <h1>Gamma<span style={{ color: "#3196ff" }}>Desk</span></h1>
    <p role="status">{zh ? "正在读取市场快照…" : "Loading market snapshots…"}</p>
    <p>{zh ? "市场数据与 AI 分析分阶段加载。" : "Market data and AI analysis load separately."}</p>
  </main>}><MarketHome searchParams={Promise.resolve(params)} /></Suspense>;
}
