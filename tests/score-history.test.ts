import {it,expect} from 'vitest';
import {mergeScoreHistory,scoreColor} from '@/desk/score-history';
import {legacyScorePoint,relativePrices} from '@/desk/score-chart-data';
it('imports only saved legacy values and preserves timestamp',()=>{
 expect(legacyScorePoint({sessionDate:'2026-09-14',generatedAt:'2026-09-15T14:00:00Z',riskScore:56,marketAction:{inputs:{opportunity:null}}})).toMatchObject({date:'2026-09-14',at:'2026-09-15T14:00:00Z',risk:56,opportunity:null});
 expect(legacyScorePoint(null)).toBeNull();
});
it('normalizes actual closes within the chosen range without filling missing dates',()=>{
 expect(relativePrices([{date:'2026-09-14',close:100},{date:'2026-09-16',close:110}],Date.parse('2026-09-14'),Date.parse('2026-09-16')).map(p=>[p.date,Math.round(p.value)])).toEqual([['2026-09-14',0],['2026-09-16',10]]);
});
it('retains latest daily scores without inventing missing opportunity',()=>{
 const p={date:'2026-09-16',at:'2026-09-16T14:00:00Z',risk:71,opportunity:null,version:'v1'};
 expect(mergeScoreHistory([p,{...p,at:'2026-09-16T20:00:00Z',risk:60}])).toEqual([{...p,at:'2026-09-16T20:00:00Z',risk:60}]);
 expect(mergeScoreHistory([{...p,risk:101}])).toEqual([]);
});
it('uses the same opposing color scales as current scores',()=>{
 expect(scoreColor(20,true)).toBe('#32bf8b');expect(scoreColor(20)).toBe('#cd6470');expect(scoreColor(50)).toBe('#d6ac49');expect(scoreColor(80)).toBe('#32bf8b');
});
