import {describe,it,expect,vi} from 'vitest';
import {captureDailyScores,completedToday,DAILY_SCORES_PATH} from '@/desk/daily-score-history';
import {createBlobRuntimeJsonStore,readJson} from '@/desk/runtime-store';
import {createInMemoryBlobStoreClient} from '@/desk/breadth/store/blob';
import type {V2CommandCenterPageView} from '@/desk/load-v2-home';
import {mergeScoreHistory} from '@/desk/score-history';
const now=new Date('2026-09-21T23:30:00Z');
const view={sessionDate:'2026-09-21',decisionStatus:'ready',gamma:[],riskScore:60,opportunityScore:40,opportunity:{version:'v3'}} as unknown as V2CommandCenterPageView;
const store=()=>createBlobRuntimeJsonStore({client:createInMemoryBlobStoreClient()});
describe('daily close score capture',()=>{
 it('handles holidays, weekends, early close and winter close',()=>{
  expect(completedToday(new Date('2026-09-20T23:30:00Z'))).toBeNull();
  expect(completedToday(new Date('2026-09-07T23:30:00Z'))).toBeNull();
  expect(completedToday(new Date('2026-09-21T18:00:00Z'))).toBeNull();
  expect(completedToday(new Date('2026-11-27T23:30:00Z'))).toBe('2026-11-27');
  expect(completedToday(new Date('2026-12-01T23:30:00Z'))).toBe('2026-12-01');
  expect(completedToday(new Date('2026-09-22T01:30:00Z'))).toBe('2026-09-21');
 });
 it('records without page access and skips repeated collection',async()=>{
  const s=store(),load=vi.fn(async()=>({view,closes:{QQQ:500}}));
  expect((await captureDailyScores({store:s,now,load})).status).toBe('recorded');
  expect((await captureDailyScores({store:s,now,load})).status).toBe('already_recorded');
  expect(load).toHaveBeenCalledTimes(1);
  expect(await readJson(s,DAILY_SCORES_PATH)).toMatchObject({points:[{date:'2026-09-21',risk:60,opportunity:40,closes:{QQQ:500}}]});
 });
 it('does not fabricate today from old scores or missing prices; can retry',async()=>{
  const s=store();
  expect((await captureDailyScores({store:s,now,load:async()=>({view:{...view,sessionDate:'2026-09-18'},closes:{QQQ:500}})})).status).toBe('unavailable');
  expect((await captureDailyScores({store:s,now,load:async()=>({view,closes:{QQQ:null}})})).status).toBe('unavailable');
  expect(await readJson(s,DAILY_SCORES_PATH)).toBeNull();
  expect((await captureDailyScores({store:s,now,load:async()=>({view,closes:{QQQ:500}})})).status).toBe('recorded');
 });
 it('surfaces storage errors instead of reporting success',async()=>{
  const s=store();vi.spyOn(s,'writeText').mockRejectedValue(new Error('storage unavailable'));
  await expect(captureDailyScores({store:s,now,load:async()=>({view,closes:{QQQ:500}})})).rejects.toThrow('storage unavailable');
 });
 it('keeps scheduled close observations over later page snapshots',()=>{
  const daily={date:'2026-09-21',at:now.toISOString(),risk:60,opportunity:40,version:'v3',source:'daily-close' as const};
  const page={...daily,at:'2026-09-22T01:00:00Z',risk:70,source:undefined};
  expect(mergeScoreHistory([daily,page])[0]?.risk).toBe(60);
  expect(mergeScoreHistory([page,daily])[0]?.risk).toBe(60);
 });
});
