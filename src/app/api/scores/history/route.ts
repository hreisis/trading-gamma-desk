import {NextResponse} from 'next/server';
import {unstable_cache} from 'next/cache';
import {readJson,resolveRuntimeJsonStore} from '@/desk/runtime-store';
import {mergeScoreHistory,type ScorePoint} from '@/desk/score-history';
import {legacyScorePoint} from '@/desk/score-chart-data';
import {readDailyScores} from '@/desk/read-daily-scores';
import {readR2Config,createR2StoreClient} from '@/desk/breadth/store/r2-client';
import {storageErrorCode} from '@/desk/storage-error';
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
 const r2=readR2Config(process.env);
 const archives=r2?await Promise.all(['en','zh'].map(async lang=>{
  const raw=await createR2StoreClient(r2).get(`legacy-vercel/desk/home-display/v1/${lang}.json`);
  return raw?JSON.parse(raw):null;
 })):[];
 return [...rows,...archives].flatMap(r=>(r as {history?:ScorePoint[]}|null)?.history??[]);
},['score-history-current-r2-v1'],{revalidate:300});
export async function GET() {
 try {
  const [current,legacy,daily]=await Promise.all([readCurrent(),readLegacy().catch(()=>[]),readDailyScores()]);
  return NextResponse.json({points:mergeScoreHistory([...legacy,...current,...daily])},{headers:{'Cache-Control':'private, max-age=60','X-Storage-Backend':readR2Config(process.env)?'r2':'legacy'}});
 }catch(error){return NextResponse.json({points:[],storageError:storageErrorCode(error)},{status:503,headers:{'Cache-Control':'no-store'}});}
}
