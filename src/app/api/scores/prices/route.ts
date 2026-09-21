import {NextResponse} from 'next/server';
import {loadAlpacaDailyBarPanel} from '@/desk/breadth/bars/alpaca-panel';
import {resolveRuntimeDataRoot} from '@/desk/production-runtime';
import type {PricePoint} from '@/desk/score-chart-data';
import {readDailyScores} from '@/desk/read-daily-scores';
let cached:Promise<Record<string,PricePoint[]>>|null=null,at=0;
export async function GET() {
 try {
  if(!cached||Date.now()-at>900000){at=Date.now();cached=loadAlpacaDailyBarPanel({symbols:['SPY','QQQ','IBIT'],dataRoot:resolveRuntimeDataRoot(process.env),persistToFilesystem:false}).then(panel=>Object.fromEntries(['SPY','QQQ','IBIT'].map(symbol=>[symbol,(panel.seriesBySymbol.get(symbol)?.bars??[]).map(b=>({date:b.sessionDate,close:b.close}))]))).catch(e=>{cached=null;throw e;});}
  const [live,daily]=await Promise.all([cached.catch(()=>({} as Record<string,PricePoint[]>)),readDailyScores().catch(()=>[])]);
  const series=Object.fromEntries(['SPY','QQQ','IBIT'].map(symbol=>{
   const rows=new Map((live[symbol]??[]).map(p=>[p.date,p]));
   for(const point of daily){const close=point.closes[symbol];if(typeof close==='number'&&Number.isFinite(close)&&close>0)rows.set(point.date,{date:point.date,close});}
   return [symbol,[...rows.values()].sort((a,b)=>a.date.localeCompare(b.date))];
  }));
  if(!Object.values(series).some(rows=>rows.length))return NextResponse.json({series:{}},{status:503});
  return NextResponse.json({series},{headers:{'Cache-Control':'private, max-age=900'}});
 }catch{return NextResponse.json({series:{}},{status:503});}
}
