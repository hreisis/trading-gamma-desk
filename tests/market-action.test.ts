import {it,expect} from 'vitest';
import {deriveMarketAction} from '@/desk/market-action';
import type {OpportunityV3} from '@/desk/opportunity-score-v3';
const run=(risk:number|null,opportunity:number|null,confirmation:OpportunityV3['confirmation']='unconfirmed',eventBlocked=false)=>deriveMarketAction({risk,opportunity,confirmation,eventBlocked});
it('permits early low-risk entries but requires recovery at moderate risk',()=>{
 expect(run(40,65).rule).toBe('early_entry');expect(run(41,65).action).toBe('HOLD');
 expect(run(41,65,'recovering').rule).toBe('tactical_recovery');
 expect(run(40,45,'broadening').rule).toBe('recovery');
 expect(run(40,44,'broadening').action).toBe('HOLD');
});
it('prioritizes defense and event restrictions over opportunity',()=>{
 expect(run(66,100,'broadening').action).toBe('SELL');
 expect(run(65,65,'recovering').action).toBe('BUY');
 expect(run(20,100,'broadening',true).action).toBe('HOLD');
 expect(run(80,100,'broadening',true).action).toBe('SELL');
});
it('handles missing inputs without pretending they are zero',()=>{
 expect(run(null,100).action).toBeNull();expect(run(NaN,100).action).toBeNull();
 expect(run(20,null).action).toBe('HOLD');expect(run(80,null).action).toBe('SELL');
 expect(run(20,100,'unavailable').action).toBe('HOLD');
});
it('records policy inputs and reasons for later review without changing them',()=>{
 const input={risk:30,opportunity:70,confirmation:'unconfirmed' as const,eventBlocked:false};
 const r=deriveMarketAction(input);expect(r.inputs).toEqual(input);expect(r.version).toBe('action-v1');expect(r.reason.zh).toContain('试探');
});
