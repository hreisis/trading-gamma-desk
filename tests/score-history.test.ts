import {it,expect} from 'vitest';
import {mergeScoreHistory,scoreColor} from '@/desk/score-history';
it('retains latest daily scores without inventing missing opportunity',()=>{
 const p={date:'2026-09-16',at:'2026-09-16T14:00:00Z',risk:71,opportunity:null,version:'v1'};
 expect(mergeScoreHistory([p,{...p,at:'2026-09-16T20:00:00Z',risk:60}])).toEqual([{...p,at:'2026-09-16T20:00:00Z',risk:60}]);
 expect(mergeScoreHistory([{...p,risk:101}])).toEqual([]);
});
it('uses the same opposing color scales as current scores',()=>{
 expect(scoreColor(20,true)).toBe('#32bf8b');expect(scoreColor(20)).toBe('#cd6470');expect(scoreColor(50)).toBe('#d6ac49');expect(scoreColor(80)).toBe('#32bf8b');
});
