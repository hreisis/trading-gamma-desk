import { after } from "next/server";
import { readHomeDisplay, saveHomeDisplay } from "@/desk/home-display-cache";
import { resolveRuntimeJsonStore } from "@/desk/runtime-store";
import { Suspense } from "react";
import { DarkCommandCenter } from "@/app/components/v2/DarkCommandCenter";
import { loadV2HomePage } from "@/desk/load-v2-home";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // Allow deferred breadth refresh to finish after the response.

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

  if (!params.source && !params.gamma) after(() => saveHomeDisplay(resolveRuntimeJsonStore(), lang, view));

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

function InitialHome({zh}:{zh:boolean}) {
  return <main style={{minHeight:"100vh",background:"#07111b",color:"#edf3ff",padding:"32px",fontFamily:"system-ui"}}>
    <h1>Gamma<span style={{color:"#3196ff"}}>Desk</span></h1>
    <p>{zh ? "市场决策 · 市场结构 · 板块轮动 · AI 研究" : "Market decision · Structure · Rotation · AI Study"}</p>
    <p role="status">{zh ? "正在连接市场数据…" : "Connecting to market data…"}</p>
  </main>;
}
async function CachedHome({lang}:{lang:"en"|"zh"}) {
  const cached = await readHomeDisplay(resolveRuntimeJsonStore(),lang);
  if(!cached) return <InitialHome zh={lang==="zh"}/>;
  return <>
    <div role="status" style={{padding:"10px 24px",background:"#132536",color:"#b8d8f1",fontSize:13}}>
      {lang==="zh" ? "正在更新 · 当前显示上次成功快照，保存于 " : "Updating · showing the last successful snapshot, saved "}{cached.savedAt}
    </div>
    <DarkCommandCenter view={cached.view} lang={lang}/>
  </>;
}
export default async function Home({searchParams}:{searchParams:Promise<{source?:string;gamma?:string;lang?:string}>}) {
  const params=await searchParams;
  const lang=params.lang==="zh"?"zh":"en";
  const shell=<InitialHome zh={lang==="zh"}/>;
  const fallback=!params.source&&!params.gamma ? <Suspense fallback={shell}><CachedHome lang={lang}/></Suspense> : shell;
  return <Suspense fallback={fallback}><MarketHome searchParams={Promise.resolve(params)}/></Suspense>;
}
