import {it,expect} from 'vitest';
import {buildHistoricalGammaCone} from '../src/desk/gamma-cone';
import type {V2GammaSummary} from '../src/desk/v2-command-center';
const summary={symbol:'SPY',spot:999,callWall:110,putWall:90,gammaFlip:105,regime:'negative',sessionDate:'2026-09-14',dealerFlowRegime:'Amplifying'} as V2GammaSummary;
const now=new Date('2026-09-15T03:00:00Z');
const dates:string[]=[];for(let d=new Date('2026-09-14T12:00:00Z');dates.length<21;d.setUTCDate(d.getUTCDate()-1)){if(d.getUTCDay()!==0&&d.getUTCDay()!==6)dates.unshift(d.toISOString().slice(0,10));}
const bars=dates.map((sessionDate,i)=>({sessionDate,close:i%2?100*Math.exp(.01):100}));
it('uses observed close and 1% daily sigma, with independent Gamma overlays',()=>{const c=buildHistoricalGammaCone({summary,bars,now});expect(c.fullSession.sigmaPoints).toBeCloseTo(1);expect(c.fullSession.expectedRange90?.upper).toBe(Math.round(101.64485));expect(c.spot).toBe(100);expect(c.structure.spot).toBe(999);expect(c.restOfDay.status).toBe('unavailable');});
it('withholds stale or insufficient history and ignores incomplete future sessions',()=>{expect(buildHistoricalGammaCone({summary,bars:bars.slice(0,-1),now}).status).toBe('unavailable');expect(buildHistoricalGammaCone({summary,bars:[...bars,{sessionDate:'2026-09-15',close:300}],now}).spot).toBe(100);});
