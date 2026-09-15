import {it,expect} from 'vitest';
import {buildRelativePairs} from '@/desk/relative-pairs';
const dates=Array.from({length:21},(_,i)=>`2026-08-${String(i+1).padStart(2,'0')}`);
const rows=(rate:number)=>dates.map((sessionDate,i)=>({sessionDate,close:100*(1+rate)**i}));
it('aligns ETF closes and calculates ratio and return differences separately',()=>{
 const bars=new Map([['QQQ',rows(.01)],['IBIT',rows(.02)],['SMH',rows(-.01)],['IGV',rows(-.02)]]);
 const r=buildRelativePairs(bars,dates[20]!);
 expect(r[1]?.points[0]?.value).toBe(100);expect(r[1]?.horizons[0]?.spread).toBeCloseTo(1);
 expect(r[0]?.horizons[0]?.leftReturn).toBeLessThan(0);expect(r[0]?.horizons[0]?.spread).toBeGreaterThan(0);
});
it('withholds missing or mismatched dates instead of shortening the lookback',()=>{
 const bars=new Map([['QQQ',rows(.01)],['IBIT',rows(.02).slice(1)]]);
 expect(buildRelativePairs(bars,dates[20]!)[1]?.status).toBe('unavailable');
 bars.set('IBIT',rows(.02));expect(buildRelativePairs(bars,'2026-09-01')[1]?.status).toBe('unavailable');
});
