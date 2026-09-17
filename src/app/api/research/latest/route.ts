import {NextResponse} from 'next/server';
import {ResearchRecord} from '@/ai-study/web-research-contract';
import {readJson,resolveRuntimeJsonStore} from '@/desk/runtime-store';
import {isPublicDemoMode} from '@/desk/public-demo';
export const dynamic='force-dynamic';
// Read-only: checking completion must never start research or write snapshots.
export async function GET() {
 if(isPublicDemoMode(process.env))return NextResponse.json({research:null});
 try {
  const parsed=ResearchRecord.safeParse(await readJson(resolveRuntimeJsonStore(process.env),'research/web-v1/latest.json'));
  return NextResponse.json({research:parsed.success?parsed.data:null},{headers:{'Cache-Control':'private, no-store'}});
 } catch {return NextResponse.json({research:null},{status:503});}
}
