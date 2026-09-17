import {NextResponse} from 'next/server';
import {readJson,resolveRuntimeJsonStore} from '@/desk/runtime-store';
import {mergeScoreHistory,type ScorePoint} from '@/desk/score-history';
export const dynamic='force-dynamic';
export async function GET() {
 try {
  const store=resolveRuntimeJsonStore();
  const rows=await Promise.all(['en','zh'].map(lang=>readJson(store,`home-display/v1/${lang}.json`)));
  return NextResponse.json({points:mergeScoreHistory(rows.flatMap(r=>(r as {history?:ScorePoint[]}|null)?.history??[]))},{headers:{'Cache-Control':'private, max-age=60'}});
 }catch{return NextResponse.json({points:[]},{status:503});}
}
