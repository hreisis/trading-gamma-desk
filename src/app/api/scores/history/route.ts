import {NextResponse} from 'next/server';
import {readJson,resolveRuntimeJsonStore} from '@/desk/runtime-store';
import {mergeScoreHistory,type ScorePoint} from '@/desk/score-history';
import {legacyScorePoint} from '@/desk/score-chart-data';
let legacyCache:{at:number;points:ScorePoint[]}|null=null;
export const dynamic='force-dynamic';
export async function GET() {
 try {
  const store=resolveRuntimeJsonStore();
  const rows=await Promise.all(['en','zh'].map(lang=>readJson(store,`home-display/v1/${lang}.json`)));
  let legacy=legacyCache?.points??[];
  if(!legacyCache||Date.now()-legacyCache.at>300000) {
   try {
    const paths=(await store.list('command-center-v1')).filter(p=>/\/\d{4}-\d{2}-\d{2}\.json$/.test(p)).sort().slice(-730);
    legacy=(await Promise.all(paths.map(async p=>{try{return legacyScorePoint(await readJson(store,p));}catch{return null;}}))).filter((p):p is ScorePoint=>p!==null);
    legacyCache={at:Date.now(),points:legacy};
   }catch{/* Preserve current history if legacy storage is unavailable. */}
  }
  return NextResponse.json({points:mergeScoreHistory([...legacy,...rows.flatMap(r=>(r as {history?:ScorePoint[]}|null)?.history??[])])},{headers:{'Cache-Control':'private, max-age=60'}});
 }catch{return NextResponse.json({points:[]},{status:503});}
}
