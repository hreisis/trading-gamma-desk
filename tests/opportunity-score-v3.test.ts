import {expect,it} from 'vitest';
import {deriveOpportunityV3} from '@/desk/opportunity-score-v3';
const dates=Array.from({length:21},(_,i)=>`2026-08-${String(i+1).padStart(2,'0')}`);
const base=dates.map((sessionDate,i)=>({sessionDate,close:100+(i%2?0.5:-0.5)}));
function run(last:number, advancingPct=10,eventBlocked=false){
 const bars=base.map((b,i)=>({...b,close:i===20?last:b.close}));
 return deriveOpportunityV3({sessionDate:dates[20]!,bars:new Map([['SPY',bars],['QQQ',bars]]),breadth:{marketSessionDate:dates[20]!,stale:false,advancingPct},eventBlocked});
}
it('recognizes a severe selloff without requiring a rebound',()=>{
 const r=run(94);expect(r.score).toBeGreaterThan(75);expect(r.confirmation).toBe('unconfirmed');
});
it('keeps confirmation and event conditions independent of potential opportunity',()=>{
 const rebound=run(101,75);expect(rebound.confirmation).toBe('broadening');expect(rebound.score).toBeLessThan(run(94).score!);
 expect(run(94,10,true).score).toBe(run(94).score);expect(run(94,10,true).eventBlocked).toBe(true);
});
it('withholds instead of rescaling stale or missing data',()=>{
 const r=deriveOpportunityV3({sessionDate:dates[20]!,bars:new Map([['SPY',base]]),breadth:{marketSessionDate:dates[19]!,stale:true,advancingPct:10},eventBlocked:false});
 expect(r.score).toBeNull();expect(r.confirmation).toBe('unavailable');
});
it('does not label rising prices as a strong dip opportunity',()=>{expect(run(104,85).score).toBeLessThan(20);});
