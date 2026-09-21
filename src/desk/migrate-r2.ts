import type {BlobStoreClient} from './breadth/store/blob-client';
const MARKER='migration/vercel-blob-v1.json';
interface Progress {done:string[];complete:boolean;lastAttempt:string;failed?:boolean}
/** Bounded, resumable copy. Preserve both the source and any newer destination. */
export async function migrateBlobToR2(source:BlobStoreClient,target:BlobStoreClient,now=new Date(),limit=100) {
 const raw=await target.get(MARKER);
 const state:Progress=raw?JSON.parse(raw):{done:[],complete:false,lastAttempt:''};
 if(state.complete)return {status:'complete',copied:state.done.length};
 if(state.lastAttempt.slice(0,10)===now.toISOString().slice(0,10))return {status:'already_attempted',copied:state.done.length};
 state.lastAttempt=now.toISOString();
 // Record attempt even when the legacy store is suspended; never poll it per visit.
 await target.put(MARKER,JSON.stringify(state),{allowOverwrite:true});
 try {
  const keys=[...await source.list('desk/'),...await source.list('breadth/')].filter(k=>k.endsWith('.json'));
  const done=new Set(state.done),todo=keys.filter(k=>!done.has(k));
  const deadline=Date.now()+120000;
  for(const key of todo.slice(0,limit)) {
   if(Date.now()>deadline)break;
   const archive='legacy-vercel/'+key;
   const previous=await target.get(archive);
   const body=previous??await source.get(key);
   if(body===null)throw new Error('Legacy source disappeared');
   if(previous===null)await target.put(archive,body,{allowOverwrite:false});
   if(await target.get(archive)!==body)throw new Error('Legacy copy verification failed');
   if(await target.get(key)===null){
    try{await target.put(key,body,{allowOverwrite:false});}
    catch(error){if((error as {$metadata?:{httpStatusCode?:number}}).$metadata?.httpStatusCode!==412)throw error;}
   }
   done.add(key);
   state.done=[...done];
   if(state.done.length%10===0)await target.put(MARKER,JSON.stringify(state),{allowOverwrite:true});
  }
  state.complete=keys.every(k=>done.has(k));state.failed=false;
  await target.put(MARKER,JSON.stringify(state),{allowOverwrite:true});
  return {status:state.complete?'complete':'partial',copied:state.done.length};
 }catch {
  state.failed=true;
  await target.put(MARKER,JSON.stringify(state),{allowOverwrite:true});
  return {status:'source_or_copy_failed',copied:state.done.length};
 }
}
