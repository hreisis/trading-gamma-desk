import styles from "@/app/components/v2/DarkCommandCenter.module.css";
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

/** Normal homepage frame for a first visit with no saved data; never invent scores. */
function HomeFrame({zh}:{zh:boolean}) {
  const sections=zh ? ["决策总览","市场结构","轮动与市场参与度","宏观与风险背景","新闻与事件"] : ["Decision overview","Market structure","Rotation & participation","Macro & risk context","News & events"];
  return <div className={styles.app}>
    <header className={styles.nav}>
      <a className={styles.logo} href="/">Gamma<span>Desk</span></a>
      <nav aria-label={zh ? "页面导航" : "Sections"}>{sections.map((title,i)=><a key={title} href={`#${["overview","structure","rotation","macro","news"][i]}`}>{title}</a>)}</nav>
      <div className={styles.languages}><a href="/?lang=en">EN</a><span>/</span><a href="/?lang=zh">中文</a></div>
    </header>
    <main className={styles.layout} aria-busy="true"><div className={styles.center}>
      <section className={styles.marketDecision}><div className={styles.decisionHeading}><h1>MARKET DECISION</h1></div></section>
      {sections.map((title,i)=><section key={title} id={["overview","structure","rotation","macro","news"][i]} style={{minHeight:160}}><div className={styles.sectionHeading}><span>{String(i+1).padStart(2,"0")}</span><h2>{title}</h2></div></section>)}
    </div></main>
  </div>;
}
async function CachedHome({lang}:{lang:"en"|"zh"}) {
  const cached = await readHomeDisplay(resolveRuntimeJsonStore(),lang);
  if(!cached) return <HomeFrame zh={lang==="zh"}/>;
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
  const shell=<HomeFrame zh={lang==="zh"}/>;
  const fallback=!params.source&&!params.gamma ? <Suspense fallback={shell}><CachedHome lang={lang}/></Suspense> : shell;
  return <Suspense fallback={fallback}><MarketHome searchParams={Promise.resolve(params)}/></Suspense>;
}
