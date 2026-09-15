import {it,expect,vi} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createFilesystemRuntimeJsonStore,writeJson,readJson} from '@/desk/runtime-store';
import {researchSlot} from '@/ai-study/web-research-contract';
import {loadWebResearch,searchSources} from '@/ai-study/web-research';
const text={en:'Interpretation, subject to confirmation.',zh:'这是需要验证的市场判断。'};
const content={headline:text,summary:text,sections:['drivers','watch','invalidation'].map((kind,i)=>({kind,title:text,body:text,sources:[{url:`https://example.com/${i%2}`,title:'Source',publishedAt:null}]})),limitations:text};
const response=()=>({status:'completed',output:[{type:'web_search_call',status:'completed',action:{sources:[{url:'https://example.com/0'},{url:'https://example.com/1'}]}},{type:'message',content:[{type:'output_text',text:JSON.stringify(content)}]}]});
const config={apiKey:'test',model:'gpt-4.1-mini',timeoutMs:1000,maxRetries:0,maxOutputTokens:1000,parseRetries:0};
it('accepts native citations but never treats model-written URLs as evidence',()=>{
 const raw={status:'completed',output:[{type:'message',content:[{
  type:'output_text',text:JSON.stringify({url:'https://invented.example/story'}),
  annotations:[{type:'url_citation',url:'https://example.com/verified',title:'Verified source'}],
 }]}]};
 expect(searchSources(raw)).toEqual([{id:'S1',url:'https://example.com/verified',title:'Verified source'}]);
 raw.output[0]!.content[0]!.annotations=[];
 expect(searchSources(raw)).toEqual([]);
});
it('uses New York publication windows including overnight and winter offsets',()=>{
 expect(researchSlot(new Date('2026-09-14T12:00:00Z'))).toBe('2026-09-13-post');
 expect(researchSlot(new Date('2026-09-14T14:00:00Z'))).toBe('2026-09-14-pre');
 expect(researchSlot(new Date('2026-09-14T20:00:00Z'))).toBe('2026-09-14-post');
 expect(researchSlot(new Date('2026-12-14T14:00:00Z'))).toBe('2026-12-14-pre');
});
it('shares a published bilingual cache and does not search on subsequent reads',async()=>{
 const store=createFilesystemRuntimeJsonStore({dataRoot:mkdtempSync(join(tmpdir(),'research-'))});
 const draft={status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({...content,sections:content.sections.map((s,i)=>({...s,sources:[{id:`S${i%2+1}`,publishedAt:null}]}))})}]}]};
 const fetchImpl=vi.fn(async(_url:unknown,_init?:RequestInit)=>new Response(JSON.stringify(_init?.body&&JSON.parse(String(_init.body)).tools?response():draft)));
 const args={store,config,now:new Date('2026-09-14T21:00:00Z'),payload:{nextEvent:{kind:'fomc_decision',occurredAt:'2026-09-16T18:00:00Z'}},inputSession:'2026-09-14',fetchImpl};
 const first=await loadWebResearch(args);expect(first?.content.summary.zh).toBe(text.zh);expect(first?.event?.et).toContain("14:00");
 await loadWebResearch(args);expect(fetchImpl).toHaveBeenCalledTimes(2);
 const body=JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));expect(body.tools[0].type).toBe('web_search');
});
it('serves previous research immediately, retains it on failed refresh, and records failure without secrets',async()=>{
 const store=createFilesystemRuntimeJsonStore({dataRoot:mkdtempSync(join(tmpdir(),'research-'))});
 const old={version:2,event:null,slot:'2026-09-14-pre',generatedAt:'2026-09-14T14:00:00Z',model:'test',inputSession:'2026-09-11',content};
 await writeJson(store,'research/web-v1/latest.json',old);
 let task:(()=>Promise<void>)|undefined;
 const fetchImpl=vi.fn(async()=>new Response('secret upstream body',{status:403}));
 const args={store,config,now:new Date('2026-09-14T21:00:00Z'),payload:{},inputSession:'2026-09-14',fetchImpl,deferRefresh:(f:()=>Promise<void>)=>{task=f;}};
 expect((await loadWebResearch(args))?.slot).toBe(old.slot);expect(fetchImpl).not.toHaveBeenCalled();
 await task!();expect(await readJson(store,'research/web-v1/latest.json')).toEqual(old);
 expect(JSON.stringify(await readJson(store,'research/web-v1/attempts/2026-09-14-post.json'))).not.toContain('secret');
});
