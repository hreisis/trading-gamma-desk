import {isPublicDemoMode} from "@/desk/public-demo";
import {NextResponse} from 'next/server';
import {verifyCronSecret} from '@/desk/cron/verify-cron-secret';
import {resolveRuntimeJsonStore} from '@/desk/runtime-store';
import {resolveRuntimeDataRoot} from '@/desk/production-runtime';
import {loadAlpacaDailyBarPanel} from '@/desk/breadth/bars/alpaca-panel';
import {loadAiStudyLlmConfig} from '@/ai-study/config';
import {publishResearchReview} from '@/desk/research-review';
export const dynamic='force-dynamic';
export const maxDuration=300;
export async function GET(request:Request){
 if(!verifyCronSecret(request,process.env).ok)return NextResponse.json({error:'unauthorized'},{status:401});
 if(isPublicDemoMode(process.env))return NextResponse.json({status:'skipped',reason:'public_demo'});
 try{
  const now=new Date();
  const bars=await loadAlpacaDailyBarPanel({symbols:['SPY','QQQ'],env:process.env,dataRoot:resolveRuntimeDataRoot(process.env)});
  const review=await publishResearchReview({now,store:resolveRuntimeJsonStore(process.env),bars:new Map([...bars.seriesBySymbol].map(([symbol,series])=>[symbol,series.bars])),config:{...loadAiStudyLlmConfig(process.env),model:process.env.AI_STUDY_RESEARCH_MODEL||'gpt-4.1'}});
  return NextResponse.json({status:review?'ready':'waiting_for_close_data',sessionDate:review?.sessionDate??null});
 }catch{return NextResponse.json({status:'failed'},{status:503});}
}
