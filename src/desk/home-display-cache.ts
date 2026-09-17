import {readJson,writeJson,type RuntimeJsonStore} from './runtime-store';
import type {V2CommandCenterPageView} from './load-v2-home';
import {mergeScoreHistory,type ScorePoint} from './score-history';
const path=(lang:'en'|'zh')=>`home-display/v1/${lang}.json`;
export const HOME_DISPLAY_WRITE_INTERVAL_MS = 15 * 60 * 1000;
export async function readHomeDisplay(store:RuntimeJsonStore,lang:'en'|'zh',now=new Date()) {
 try {
  const row=await readJson(store,path(lang)) as {savedAt:string;view:V2CommandCenterPageView}|null;
  if(!row || !Number.isFinite(Date.parse(row.savedAt)) || now.getTime()-Date.parse(row.savedAt)>86400000 || !Array.isArray(row.view?.gamma) || !Array.isArray(row.view?.marketQuotes)) return null;
  return row;
 } catch {return null;}
}
export async function saveHomeDisplay(store:RuntimeJsonStore,lang:'en'|'zh',view:V2CommandCenterPageView,now=new Date()) {
 // Never persist fixtures or overwrite a useful page with an empty provider outage.
 if(view.decisionStatus!=='ready' || view.gamma.some(g=>g.isFixture)) return;
 // This cache is only for a faster next page render. At most one write per
 // language per 15-minute provider window, and only after someone visits.
 try {
  const existing=await readHomeDisplay(store,lang,now);
  if(existing && now.getTime()-Date.parse(existing.savedAt)<HOME_DISPLAY_WRITE_INTERVAL_MS) return;
  const raw=await readJson(store,path(lang)) as {history?:ScorePoint[]}|null;
  const history=mergeScoreHistory([...(raw?.history??[]),...(view.sessionDate?[{date:view.sessionDate,at:now.toISOString(),risk:view.riskScore,opportunity:view.opportunityScore??null,version:`risk-current/${view.opportunity?.version??'unknown'}`}]:[])]);
  await writeJson(store,path(lang),{savedAt:now.toISOString(),view,history},{allowOverwrite:true});
 } catch { /* Display caching must not break the page. */ }
}
