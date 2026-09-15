import {it,expect,vi} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildResearchReview,captureReviewThesis,publishResearchReview,readResearchReview,thesisTarget,type ReviewThesis} from '@/desk/research-review';
import {createFilesystemRuntimeJsonStore,readJson} from '@/desk/runtime-store';
import {deriveMarketAction} from '@/desk/market-action';
const bar={sessionDate:'2026-09-14',open:100,high:105,low:99,close:104,volume:100};
const bars=new Map([['SPY',[bar]],['QQQ',[bar]]]);
const action=deriveMarketAction({risk:30,opportunity:70,confirmation:'unconfirmed',eventBlocked:false});
const thesis:ReviewThesis={version:1,targetSession:'2026-09-14',recordedAt:'2026-09-14T12:00:00Z',inputSession:'2026-09-11',action,research:null};
const now=new Date('2026-09-14T22:15:00Z');
const config={apiKey:null,model:'gpt-4.1',timeoutMs:1000,maxRetries:0,maxOutputTokens:1000,parseRetries:0};
const store=()=>createFilesystemRuntimeJsonStore({dataRoot:mkdtempSync(join(tmpdir(),'review-'))});
it('targets pre-open today, intraday tomorrow, and respects weekend and DST',()=>{
 expect(thesisTarget(new Date('2026-09-14T12:00:00Z'))).toBe('2026-09-14');
 expect(thesisTarget(new Date('2026-09-14T14:00:00Z'))).toBe('2026-09-15');
 expect(thesisTarget(new Date('2026-09-12T18:00:00Z'))).toBe('2026-09-14');
 expect(thesisTarget(new Date('2026-12-14T14:00:00Z'))).toBe('2026-12-14');
});
it('withholds partial closes and missing QQQ; discards post-open forecasts',()=>{
 expect(buildResearchReview({now:new Date('2026-09-14T20:10:00Z'),sessionDate:bar.sessionDate,thesis,bars})).toBeNull();
 expect(buildResearchReview({now,sessionDate:bar.sessionDate,thesis,bars:new Map([['SPY',[bar]]])})).toBeNull();
 const late=buildResearchReview({now,sessionDate:bar.sessionDate,thesis:{...thesis,recordedAt:'2026-09-14T15:00:00Z'},bars})!;
 expect(late.thesis).toBeNull();expect(late.content.direction.en).toContain('not a forecast grade');
});
it('uses open-to-close direction without claiming fills or profit',()=>{
 const r=buildResearchReview({now,sessionDate:bar.sessionDate,thesis,bars})!;
 expect(r.outcomes[0]!.returnPct).toBe(4);expect(r.content.direction.en).toContain('does not establish trading profit');
 expect(r.content.timing.en).toContain('cannot establish');
});
it('freezes the first prospective action and shares one bilingual edition',async()=>{
 const s=store();await captureReviewThesis({store:s,now:new Date(thesis.recordedAt),inputSession:thesis.inputSession,action,research:null});
 await captureReviewThesis({store:s,now:new Date('2026-09-14T13:00:00Z'),inputSession:thesis.inputSession,action:{...action,action:'SELL'},research:null});
 const frozen=await readJson(s,'review/research-v1/theses/2026-09-14.json') as ReviewThesis;expect(frozen.action?.action).toBe('BUY');
 const fetchImpl=vi.fn();const a=await publishResearchReview({store:s,now,bars,config,fetchImpl});
 const b=await publishResearchReview({store:s,now,bars,config,fetchImpl});
 expect(a).toEqual(b);expect(a?.content.summary.zh).toContain('开盘');expect(fetchImpl).not.toHaveBeenCalled();
 expect(await readResearchReview(s)).toEqual(a);
});
it('keeps the previous edition when newer closing data is missing',async()=>{
 const s=store();const first=await publishResearchReview({store:s,now,bars,config});
 expect(await publishResearchReview({store:s,now:new Date('2026-09-15T22:15:00Z'),bars,config})).toBeNull();
 expect(await readResearchReview(s)).toEqual(first);
});
it('retains a bilingual fallback and does not retry paid calls after provider failure',async()=>{
 const s=store();const text={en:'Watch participation.',zh:'观察市场参与度。'};
 const research={version:2 as const,event:null,slot:'2026-09-14-pre',generatedAt:'2026-09-14T11:00:00Z',inputSession:'2026-09-11',model:'test',content:{headline:text,summary:text,limitations:text,sections:(['drivers','watch','invalidation'] as const).map(kind=>({kind,title:text,body:text,sources:[{url:'https://example.com/original',title:'Original evidence',publishedAt:null}]}))}};
 await captureReviewThesis({store:s,now:new Date(thesis.recordedAt),inputSession:thesis.inputSession,action,research});
 const fetchImpl=vi.fn(async()=>new Response('secret upstream body',{status:500}));
 const args={store:s,now,bars,config:{...config,apiKey:'test-key'},fetchImpl};
 const first=await publishResearchReview(args);expect(first?.source).toBe('deterministic');
 expect(first?.thesis?.research?.content.sections[0]?.sources[0]?.url).toBe('https://example.com/original');
 expect(await publishResearchReview(args)).toEqual(first);expect(fetchImpl).toHaveBeenCalledTimes(1);
 expect(JSON.stringify(await readJson(s,'review/research-v1/errors/2026-09-14.json'))).not.toContain('secret');
});
it('never accepts a research edition published after the thesis capture',()=>{
 const text={en:'Watch.',zh:'观察。'};
 const research={version:2 as const,event:null,slot:'2026-09-14-post',generatedAt:'2026-09-14T22:00:00Z',inputSession:null,model:'test',content:{headline:text,summary:text,limitations:text,sections:(['drivers','watch','invalidation'] as const).map(kind=>({kind,title:text,body:text,sources:[{url:'https://example.com',title:'Source',publishedAt:null}]}))}};
 expect(buildResearchReview({now,sessionDate:bar.sessionDate,thesis:{...thesis,research},bars})?.thesis).toBeNull();
});
