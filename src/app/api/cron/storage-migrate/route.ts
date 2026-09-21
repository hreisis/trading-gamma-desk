import {NextResponse} from 'next/server';
import {verifyCronSecret} from '@/desk/cron/verify-cron-secret';
import {readR2Config,createR2StoreClient} from '@/desk/breadth/store/r2-client';
import {readBreadthBlobToken} from '@/desk/breadth/store/blob-client';
import {createVercelBlobStoreClient} from '@/desk/breadth/store/vercel-blob-sdk';
import {migrateBlobToR2} from '@/desk/migrate-r2';
import {isPublicDemoMode} from '@/desk/public-demo';
export const dynamic='force-dynamic';
export const maxDuration=300;
export async function GET(request:Request) {
 if(!verifyCronSecret(request).ok)return NextResponse.json({error:'unauthorized'},{status:401});
 if(isPublicDemoMode(process.env))return NextResponse.json({status:'skipped'});
 try {
  const config=readR2Config(process.env),token=readBreadthBlobToken();
  if(!config||!token)return NextResponse.json({status:'skipped',reason:'migration_not_configured'});
  const result=await migrateBlobToR2(createVercelBlobStoreClient({token}),createR2StoreClient(config));
  return NextResponse.json(result,{status:result.status==='source_or_copy_failed'?503:200});
 }catch{return NextResponse.json({status:'storage_failed'},{status:503});}
}
