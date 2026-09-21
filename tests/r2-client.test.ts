import {beforeEach,describe,it,expect,vi} from 'vitest';
const send=vi.hoisted(()=>vi.fn());
vi.mock('@aws-sdk/client-s3',()=>({
 S3Client:class {send=send;},
 GetObjectCommand:class {constructor(public input:unknown){}},
 PutObjectCommand:class {constructor(public input:unknown){}},
 ListObjectsV2Command:class {constructor(public input:unknown){}},
}));
import {createR2StoreClient,readR2Config} from '@/desk/breadth/store/r2-client';
const config={endpoint:'https://test.r2.cloudflarestorage.com',bucket:'test',accessKeyId:'test',secretAccessKey:'test'};
beforeEach(()=>send.mockReset());
describe('R2 client',()=>{
 it('rejects incomplete configuration and unsafe endpoints',()=>{
  expect(readR2Config({})).toBeNull();
  expect(()=>readR2Config({R2_BUCKET:'test'})).toThrow('Incomplete');
  expect(()=>readR2Config({R2_ENDPOINT:'https://wrong.example',R2_BUCKET:'test',R2_ACCESS_KEY_ID:'test',R2_SECRET_ACCESS_KEY:'test'})).toThrow('Invalid');
 });
 it('returns null only for missing keys, propagating permission/storage errors',async()=>{
  const client=createR2StoreClient(config);
  send.mockRejectedValueOnce({name:'NoSuchKey'}).mockRejectedValueOnce({name:'AccessDenied'});
  expect(await client.get('missing')).toBeNull();
  await expect(client.get('private')).rejects.toMatchObject({name:'AccessDenied'});
 });
 it('reads text and uses atomic create-only writes',async()=>{
  const client=createR2StoreClient(config);
  send.mockResolvedValueOnce({Body:{transformToString:async()=>'{"a":1}'}}).mockResolvedValue({});
  expect(await client.get('key')).toBe('{"a":1}');
  await client.put('key','body');
  expect(send.mock.calls[1]![0].input).toMatchObject({IfNoneMatch:'*',Bucket:'test',Key:'key'});
  await client.put('key','new',{allowOverwrite:true});
  expect(send.mock.calls[2]![0].input).not.toHaveProperty('IfNoneMatch');
 });
 it('reads all list pages',async()=>{
  send.mockResolvedValueOnce({Contents:[{Key:'a'}],IsTruncated:true,NextContinuationToken:'next'})
   .mockResolvedValueOnce({Contents:[{Key:'b'}],IsTruncated:false});
  expect(await createR2StoreClient(config).list('')).toEqual(['a','b']);
  expect(send.mock.calls[1]![0].input.ContinuationToken).toBe('next');
 });
});
