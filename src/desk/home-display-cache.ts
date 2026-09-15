import {readJson,writeJson,type RuntimeJsonStore} from './runtime-store';
import type {V2CommandCenterPageView} from './load-v2-home';
const path=(lang:'en'|'zh')=>`home-display/v1/${lang}.json`;
export async function readHomeDisplay(store:RuntimeJsonStore,lang:'en'|'zh') {
 try {
  const row=await readJson(store,path(lang)) as {savedAt:string;view:V2CommandCenterPageView}|null;
  if(!row || !Number.isFinite(Date.parse(row.savedAt)) || Date.now()-Date.parse(row.savedAt)>86400000 || !Array.isArray(row.view?.gamma) || !Array.isArray(row.view?.marketQuotes)) return null;
  return row;
 } catch {return null;}
}
export async function saveHomeDisplay(store:RuntimeJsonStore,lang:'en'|'zh',view:V2CommandCenterPageView) {
 // Never persist fixtures or overwrite a useful page with an empty provider outage.
 if(view.decisionStatus!=='ready' || view.gamma.some(g=>g.isFixture)) return;
 try {await writeJson(store,path(lang),{savedAt:new Date().toISOString(),view},{allowOverwrite:true});} catch { /* Display caching must not break the page. */ }
}
