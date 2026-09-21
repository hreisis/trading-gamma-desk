import {resolveCurrentMarketSessionDate,resolveLastCompletedMarketSessionDate} from '@/ai-study/session';
import {defaultSessionCalendar} from '@/macro/calendar';
import {readJson,writeJson,type RuntimeJsonStore} from './runtime-store';
import type {V2CommandCenterPageView} from './load-v2-home';
import type {ScorePoint} from './score-history';

export const DAILY_SCORES_PATH='scores/daily-v1.json';
export interface DailyScore extends ScorePoint {
 source:'daily-close';
 closes:Record<string,number|null>;
 inputSessionDate:string|null;
 gamma:unknown;
 coverage:unknown;
}
export function completedToday(now:Date):string|null {
 const date=resolveCurrentMarketSessionDate(now);
 return defaultSessionCalendar.isSession(date)&&resolveLastCompletedMarketSessionDate(now)===date?date:null;
}
export async function captureDailyScores(input:{
 store:RuntimeJsonStore;now:Date;
 load:()=>Promise<{view:V2CommandCenterPageView;closes:Record<string,number|null>}>;
}) {
 const date=completedToday(input.now);
 if(!date)return {status:'skipped',reason:'not_after_session_close'};
 const existing=(await readJson(input.store,DAILY_SCORES_PATH) as {points:DailyScore[]}|null)?.points??[];
 if(existing.some(p=>p.date===date))return {status:'already_recorded',date};
 const {view,closes}=await input.load();
 // Do not date yesterday's computed score as today's observation.
 if(view.sessionDate!==date||view.decisionStatus!=='ready'||view.gamma.some(g=>g.isFixture)
  ||[view.riskScore,view.opportunityScore].some(n=>typeof n!=='number'||!Number.isFinite(n)||n<0||n>100)
  ||!Number.isFinite(closes.QQQ)||!(closes.QQQ!>0)) {
  return {status:'unavailable',date,reason:'missing_or_unaligned_inputs'};
 }
 const point:DailyScore={date,at:input.now.toISOString(),risk:view.riskScore,opportunity:view.opportunityScore??null,
  version:`risk-current/${view.opportunity?.version??'unknown'}`,source:'daily-close',closes,
  inputSessionDate:view.sessionDate,gamma:view.gamma,coverage:{risk:view.riskCoverage,opportunity:view.opportunity}};
 await writeJson(input.store,DAILY_SCORES_PATH,{points:[...existing,point].sort((a,b)=>a.date.localeCompare(b.date)).slice(-730)},{allowOverwrite:true});
 return {status:'recorded',date};
}
