import {NextResponse} from 'next/server';
import {unstable_cache} from 'next/cache';
import {readJson,resolveRuntimeJsonStore} from '@/desk/runtime-store';
import {mergeScoreHistory,type ScorePoint} from '@/desk/score-history';
import {legacyScorePoint} from '@/desk/score-chart-data';
export const dynamic='force-dynamic';
// Shared Data Cache, rather than a cache limited to one warm function instance.
// Throw on read failures so failed refreshes cannot replace valid cached history.
const readLegacy=unstable_cache(async()=>{
 const store=resolveRuntimeJsonStore();
 const paths=(await store.list('command-center-v1')).filter(p=>/\/\d{4}-\d{2}-\d{2}\.json$/.test(p)).sort().slice(-730);
 return (await Promise.all(paths.map(async p=>legacyScorePoint(await readJson(store,p)))))
  .filter((p):p is ScorePoint=>p!==null);
},['score-history-legacy-v2'],{revalidate:3600});
const readCurrent=unstable_cache(async()=>{
 const store=resolveRuntimeJsonStore();
 const rows=await Promise.all(['en','zh'].map(lang=>readJson(store,`home-display/v1/${lang}.json`)));
 return rows.flatMap(r=>(r as {history?:ScorePoint[]}|null)?.history??[]);
},['score-history-current-v2'],{revalidate:300});
export async function GET() {
 try {
  const [current,legacy]=await Promise.all([readCurrent(),readLegacy().catch(()=>[])]);
  return NextResponse.json({points:mergeScoreHistory([...legacy,...current])},{headers:{'Cache-Control':'private, max-age=60'}});
 }catch{return NextResponse.json({points:[]},{status:503});}
}
