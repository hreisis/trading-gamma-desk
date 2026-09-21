import {S3Client,GetObjectCommand,PutObjectCommand,ListObjectsV2Command} from '@aws-sdk/client-s3';
import type {BlobStoreClient} from './blob-client';

export interface R2Config {endpoint:string;bucket:string;accessKeyId:string;secretAccessKey:string}
export function readR2Config(env:Record<string,string|undefined>):R2Config|null {
 const keys=['R2_ENDPOINT','R2_BUCKET','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY'] as const;
 if(!keys.some(k=>env[k]?.trim()))return null;
 if(!keys.every(k=>env[k]?.trim()))throw new Error('Incomplete R2 storage configuration');
 const endpoint=new URL(env.R2_ENDPOINT!.trim());
 if(endpoint.protocol!=='https:'||!endpoint.hostname.endsWith('.r2.cloudflarestorage.com')||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||!['','/'].includes(endpoint.pathname))throw new Error('Invalid R2 S3 endpoint');
 return {endpoint:endpoint.origin,bucket:env.R2_BUCKET!.trim(),accessKeyId:env.R2_ACCESS_KEY_ID!.trim(),secretAccessKey:env.R2_SECRET_ACCESS_KEY!.trim()};
}
export function createR2StoreClient(config:R2Config):BlobStoreClient {
 const s3=new S3Client({region:'auto',endpoint:config.endpoint,forcePathStyle:true,
  credentials:{accessKeyId:config.accessKeyId,secretAccessKey:config.secretAccessKey},
  maxAttempts:2,requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED'});
 const options=()=>({abortSignal:AbortSignal.timeout(15000)});
 return {
  async get(path){
   try {
    const result=await s3.send(new GetObjectCommand({Bucket:config.bucket,Key:path}),options());
    if(!result.Body)throw new Error('R2 returned an empty body');
    return await result.Body.transformToString();
   }catch(error){if((error as {name?:string}).name==='NoSuchKey')return null;throw error;}
  },
  async put(path,body,putOptions){
   await s3.send(new PutObjectCommand({Bucket:config.bucket,Key:path,Body:body,ContentType:'application/json',
    ...(putOptions?.allowOverwrite?{}:{IfNoneMatch:'*'})}),options());
  },
  async list(prefix){
   const keys:string[]=[];let cursor:string|undefined;
   do {
    const page=await s3.send(new ListObjectsV2Command({Bucket:config.bucket,Prefix:prefix,ContinuationToken:cursor}),options());
    for(const row of page.Contents??[])if(row.Key)keys.push(row.Key);
    const next=page.IsTruncated?page.NextContinuationToken:undefined;
    if(page.IsTruncated&&(!next||next===cursor))throw new Error('R2 listing returned invalid pagination');
    cursor=next;
   }while(cursor);
   return keys;
  },
 };
}
