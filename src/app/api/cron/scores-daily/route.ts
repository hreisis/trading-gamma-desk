import {NextResponse} from 'next/server';
import {verifyCronSecret} from '@/desk/cron/verify-cron-secret';
import {isPublicDemoMode} from '@/desk/public-demo';
import {captureDailyScores} from '@/desk/daily-score-history';
import {resolveRuntimeJsonStore} from '@/desk/runtime-store';
import {loadV2HomePage} from '@/desk/load-v2-home';
import {loadAlpacaDailyBarPanel} from '@/desk/breadth/bars/alpaca-panel';
import {resolveRuntimeDataRoot} from '@/desk/production-runtime';
import {resolveCurrentMarketSessionDate} from '@/ai-study/session';
export const dynamic='force-dynamic';
export const maxDuration=300;
export async function GET(request:Request) {
 if(!verifyCronSecret(request,process.env).ok)return NextResponse.json({error:'unauthorized'},{status:401});
 if(isPublicDemoMode(process.env))return NextResponse.json({status:'skipped',reason:'demo'});
 try {
  const now=new Date(),date=resolveCurrentMarketSessionDate(now);
  const result=await captureDailyScores({store:resolveRuntimeJsonStore(),now,load:async()=>{
   const [{view},bars]=await Promise.all([
    loadV2HomePage({demo:false,scoresOnly:true}),
    loadAlpacaDailyBarPanel({symbols:['SPY','QQQ','IBIT'],dataRoot:resolveRuntimeDataRoot(process.env),persistToFilesystem:false}),
   ]);
   const closes=Object.fromEntries(['SPY','QQQ','IBIT'].map(symbol=>[symbol,bars.seriesBySymbol.get(symbol)?.bars.find(b=>b.sessionDate===date)?.close??null]));
   return {view,closes};
  }});
  return NextResponse.json(result,{status:result.status==='unavailable'?503:200});
 }catch(error){console.error('[scores-daily] capture failed',error instanceof Error?error.name:'unknown');return NextResponse.json({status:'failed'},{status:503});}
}
