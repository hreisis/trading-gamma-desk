/** Public diagnostics expose categories only, never provider messages/credentials. */
export function storageErrorCode(error:unknown):string {
 const e=error as {name?:string;message?:string;$metadata?:{httpStatusCode?:number}};
 if(e?.message==='Incomplete R2 storage configuration')return 'r2_configuration_incomplete';
 if(e?.message==='Invalid R2 S3 endpoint'||e?.name==='TypeError'&&e.message?.includes('Invalid URL'))return 'r2_endpoint_invalid';
 if(e?.name==='NoSuchBucket')return 'r2_bucket_not_found';
 if(e?.name==='SignatureDoesNotMatch')return 'r2_signature_mismatch';
 if(e?.name==='InvalidAccessKeyId')return 'r2_access_key_invalid';
 if(e?.name==='AccessDenied'||e?.$metadata?.httpStatusCode===403)return 'storage_access_denied';
 if(e?.name==='TimeoutError'||e?.name==='AbortError')return 'storage_timeout';
 return 'storage_unavailable';
}
