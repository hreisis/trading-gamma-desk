import {NextResponse} from 'next/server';
import {unstable_cache} from 'next/cache';
import {ResearchRecord} from '@/ai-study/web-research-contract';
import {readJson,resolveRuntimeJsonStore} from '@/desk/runtime-store';
import {isPublicDemoMode} from '@/desk/public-demo';
export const dynamic='force-dynamic';
const readLatest=unstable_cache(async()=>{
 const parsed=ResearchRecord.safeParse(await readJson(resolveRuntimeJsonStore(process.env),'research/web-v1/latest.json'));
 return parsed.success?parsed.data:null;
},['public-research-latest-v1'],{revalidate:60});
// Read-only: checking completion must never start research or write snapshots.
export async function GET() {
 if(isPublicDemoMode(process.env))return NextResponse.json({research:null});
 try {
  return NextResponse.json({research:await readLatest()},{headers:{'Cache-Control':'private, max-age=60'}});
 } catch {return NextResponse.json({research:null},{status:503});}
}
