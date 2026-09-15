import { describe, it, expect, vi } from 'vitest';
import { loadZeroGex, parseZeroGex } from '../src/desk/zerogex';
import type { RuntimeJsonStore } from '../src/desk/runtime-store';
const data = {symbol:'SPY',as_of:'2026-09-15T03:01:00+00:00',data_tier:'free-delayed',market_phase:'closed',spot:760,regime:'short',net_gex_at_spot:-10,gamma_flip:null,call_wall:765,put_wall:750};
function store(){return {readText:vi.fn().mockResolvedValue(JSON.stringify(data)),writeText:vi.fn().mockResolvedValue(true)} as unknown as RuntimeJsonStore;}
describe('ZeroGEX reference',()=>{
 it('preserves missing levels and rejects wrong symbols',()=>{expect(parseZeroGex(data,'SPY').gamma_flip).toBeNull();expect(()=>parseZeroGex(data,'QQQ')).toThrow();});
 it('fetches again despite stored snapshot',async()=>{const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({result:{structuredContent:data}})));const result=await loadZeroGex('SPY',store(),fetcher);expect(result.fallback).toBe(false);expect(fetcher).toHaveBeenCalledOnce();expect(fetcher).toHaveBeenCalledWith('https://zerogex.io/mcp',expect.objectContaining({cache:'no-store'}));});
 it('keeps previous values on provider error without retry',async()=>{const fetcher=vi.fn().mockRejectedValue(new Error('offline'));const result=await loadZeroGex('SPY',store(),fetcher);expect(result.fallback).toBe(true);expect(result.data?.spot).toBe(760);expect(fetcher).toHaveBeenCalledOnce();});
 it('does not replace a newer stored snapshot with an older one',async()=>{const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({result:{structuredContent:{...data,as_of:'2026-09-14T20:00:00Z'}}})));expect((await loadZeroGex('SPY',store(),fetcher)).fallback).toBe(true);});
});

import {applyZeroGex} from '../src/desk/zerogex';
import type {V2GammaSummary} from '../src/desk/v2-command-center';
it('replaces old Gamma without relabeling old IV or keeping old levels on failure',()=>{
 const base={symbol:'SPY',freshness:'stale',sessionDate:'2026-09-11',spot:1,gammaFlip:2,netGex:100,regime:'positive',volMispricing:{status:'unavailable'}} as V2GammaSummary;
 const next=applyZeroGex(base,{data:parseZeroGex(data,'SPY'),fallback:false},new Date('2026-09-15T03:10:00Z'));
 expect(next.netGex).toBe(-10);expect(next.regime).toBe('negative');expect(next.gammaFlip).toBeNull();expect(next.freshness).toBe('fresh');expect(next.volFreshness).toBe('stale');
 const missing=applyZeroGex(base,{data:null,fallback:true},new Date());expect(missing.regime).toBeNull();expect(missing.spot).toBeNull();
 const stale=applyZeroGex(base,{data:parseZeroGex(data,'SPY'),fallback:true},new Date('2026-09-17T03:10:00Z'));expect(stale.freshness).toBe('stale');
});
