import {unstable_cache} from 'next/cache';
import {readJson,resolveRuntimeJsonStore} from './runtime-store';
import {DAILY_SCORES_PATH,type DailyScore} from './daily-score-history';
export const readDailyScores=unstable_cache(async()=>{
 const row=await readJson(resolveRuntimeJsonStore(),DAILY_SCORES_PATH) as {points:DailyScore[]}|null;
 return row?.points??[];
},['daily-close-scores-v1'],{revalidate:300});
