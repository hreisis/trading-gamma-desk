import {describe,it,expect,vi} from 'vitest';
import {createInMemoryBlobStoreClient} from '@/desk/breadth/store/blob';
import {migrateBlobToR2} from '@/desk/migrate-r2';
describe('R2 migration',()=>{
 it('copies legacy records, preserves newer target data, and resumes',async()=>{
  const source=createInMemoryBlobStoreClient(),target=createInMemoryBlobStoreClient();
  await source.put('desk/a.json','old');await source.put('breadth/b.json','breadth');
  await target.put('desk/a.json','new');
  expect((await migrateBlobToR2(source,target,new Date('2026-09-21'),1)).status).toBe('partial');
  expect(await target.get('desk/a.json')).toBe('new');
  expect(await target.get('legacy-vercel/desk/a.json')).toBe('old');
  expect((await migrateBlobToR2(source,target,new Date('2026-09-22'))).status).toBe('complete');
  expect(await target.get('breadth/b.json')).toBe('breadth');
  expect(await source.get('desk/a.json')).toBe('old');
 });
 it('records failure without retrying a suspended source on every visit',async()=>{
  const source=createInMemoryBlobStoreClient(),target=createInMemoryBlobStoreClient();
  const list=vi.spyOn(source,'list').mockRejectedValue(new Error('suspended'));
  expect((await migrateBlobToR2(source,target,new Date('2026-09-21'))).status).toBe('source_or_copy_failed');
  expect((await migrateBlobToR2(source,target,new Date('2026-09-21T23:00:00Z'))).status).toBe('already_attempted');
  expect(list).toHaveBeenCalledTimes(1);
 });
});
