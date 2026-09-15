import {expect,it} from 'vitest';
import {buildThemePilot,PILOT_THEMES} from '@/desk/theme-pilot';
const dates=Array.from({length:55},(_,i)=>new Date(Date.UTC(2026,4,1+i)).toISOString().slice(0,10));
const series=(slope:number)=>dates.map((sessionDate,i)=>({sessionDate,close:100*Math.exp(slope*i+.002*(i%2))}));
function data(){return new Map(['SPY',...PILOT_THEMES.flatMap(t=>[...t.members])].map(s=>[s,series(s==='SMH'?-.004:.002)]));}
it('differentiates a persistently weak theme from market strength',()=>{
 const r=buildThemePilot({bars:data(),sessionDate:dates.at(-1)!,risk:60,eventBlocked:false});
 expect(r[0]?.action).toBe('SELL');expect(r[0]?.rs20).toBeLessThan(0);expect(r[1]?.action).toBe('HOLD');
});
it('withholds incomplete baskets and misaligned benchmark history',()=>{
 const bars=data();bars.delete('TSLA');expect(buildThemePilot({bars,sessionDate:dates.at(-1)!,risk:40,eventBlocked:false})[2]?.status).toBe('unavailable');
 expect(buildThemePilot({bars,sessionDate:'2027-01-01',risk:40,eventBlocked:false}).every(r=>r.status==='unavailable')).toBe(true);
});
it('computes equal-weight returns rather than averaging constituent share prices',()=>{
 const bars=data();bars.set('AAPL',bars.get('AAPL')!.map(b=>({...b,close:b.close*100})));
 const r=buildThemePilot({bars,sessionDate:dates.at(-1)!,risk:40,eventBlocked:false});
 expect(r[2]?.return1d).toBe(r[1]?.return1d);expect(r[2]?.rs5).toBe(0);
});

it('replay ignores all rows after each evaluation date',async()=>{
 const {replayThemePilot}=await import('@/desk/theme-pilot');
 const bars=data();const cutoff=dates.at(-1)!;
 const expected=replayThemePilot({bars,sessionDate:cutoff,count:1});
 for(const [symbol,rows] of bars)bars.set(symbol,[...rows,{sessionDate:'2027-01-01',close:999999}]);
 expect(replayThemePilot({bars,sessionDate:cutoff,count:1})).toEqual(expected);
});
