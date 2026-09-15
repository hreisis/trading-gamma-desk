import {readJson,writeJson,type RuntimeJsonStore} from './runtime-store';
import type {V2CommandCenterPageView} from './load-v2-home';
const path=(lang:'en'|'zh')=>`home-display/v1/${lang}.json`;
export const HOME_DISPLAY_WRITE_INTERVAL_MS = 15 * 60 * 1000;
export async function readHomeDisplay(store:RuntimeJsonStore,lang:'en'|'zh') {
 try {
  const row=await readJson(store,path(lang)) as {savedAt:string;view:V2CommandCenterPageView}|null;
  if(!row || !Number.isFinite(Date.parse(row.savedAt)) || Date.now()-Date.parse(row.savedAt)>86400000 || !Array.isArray(row.view?.gamma) || !Array.isArray(row.view?.marketQuotes)) return null;
  return row;
 } catch {return null;}
}
export async function saveHomeDisplay(store:RuntimeJsonStore,lang:'en'|'zh',view:V2CommandCenterPageView,now=new Date()) {
 // Never persist fixtures or overwrite a useful page with an empty provider outage.
 if(view.decisionStatus!=='ready' || view.gamma.some(g=>g.isFixture)) return;
 // This cache is only for a faster next page render. At most one write per
 // language per 15-minute provider window, and only after someone visits.
 try {
  const existing=await readHomeDisplay(store,lang);
  if(existing && now.getTime()-Date.parse(existing.savedAt)<HOME_DISPLAY_WRITE_INTERVAL_MS) return;
  await writeJson(store,path(lang),{savedAt:now.toISOString(),view},{allowOverwrite:true});
 } catch { /* Display caching must not break the page. */ }
}
