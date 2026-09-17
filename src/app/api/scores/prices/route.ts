import {NextResponse} from 'next/server';
import {loadAlpacaDailyBarPanel} from '@/desk/breadth/bars/alpaca-panel';
import {resolveRuntimeDataRoot} from '@/desk/production-runtime';
import type {PricePoint} from '@/desk/score-chart-data';
let cached:Promise<Record<string,PricePoint[]>>|null=null,at=0;
export async function GET() {
 try {
  if(!cached||Date.now()-at>900000){at=Date.now();cached=loadAlpacaDailyBarPanel({symbols:['SPY','QQQ','IBIT'],dataRoot:resolveRuntimeDataRoot(process.env),persistToFilesystem:false}).then(panel=>Object.fromEntries(['SPY','QQQ','IBIT'].map(symbol=>[symbol,(panel.seriesBySymbol.get(symbol)?.bars??[]).map(b=>({date:b.sessionDate,close:b.close}))]))).catch(e=>{cached=null;throw e;});}
  return NextResponse.json({series:await cached},{headers:{'Cache-Control':'private, max-age=900'}});
 }catch{return NextResponse.json({series:{}},{status:503});}
}
