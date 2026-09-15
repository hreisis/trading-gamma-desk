import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFilesystemRuntimeJsonStore } from '@/desk/runtime-store';
import { loadPriorRiskSpread, saveRiskSpread } from '@/desk/risk-spread-history';
import type { RiskDecisionV1_1Result } from '@/desk/risk-decision-v1-1';
const ready = (divergence: number | null) => ({spyStructuralRisk:{status:'ready',riskScore:60},qqqStructuralRisk:{status:'ready',riskScore:70},riskDivergence:divergence}) as RiskDecisionV1_1Result;
describe('durable spread comparisons', () => {
 it('compares the prior trading session, preserves its first snapshot and rejects different sources', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'spread-'));
  try {
   const store = createFilesystemRuntimeJsonStore({dataRoot:dir});
   await saveRiskSpread(store,'2026-09-11','bounded',ready(10));
   await saveRiskSpread(store,'2026-09-11','bounded',ready(20));
   expect(await loadPriorRiskSpread(store,'2026-09-14','bounded')).toBe(10);
   expect(await loadPriorRiskSpread(store,'2026-09-11','bounded')).toBeNull();
   expect(await loadPriorRiskSpread(store,'2026-09-14','manual')).toBeNull();
   expect(await loadPriorRiskSpread(store,'2026-09-15','bounded')).toBeNull();
  } finally {rmSync(dir,{recursive:true,force:true});}
 });
 it('does not publish missing spread and tolerates unavailable history storage', async () => {
  const dir=mkdtempSync(join(tmpdir(),'spread-'));
  try {
   const store=createFilesystemRuntimeJsonStore({dataRoot:dir});
   await saveRiskSpread(store,'2026-09-11','bounded',ready(null));
   expect(await loadPriorRiskSpread(store,'2026-09-14','bounded')).toBeNull();
   const broken={...store,readText:async()=>{throw new Error('offline')},writeText:async()=>{throw new Error('offline')}};
   expect(await loadPriorRiskSpread(broken,'2026-09-14','bounded')).toBeNull();
   await expect(saveRiskSpread(broken,'2026-09-11','bounded',ready(10))).resolves.toBeUndefined();
  }finally{rmSync(dir,{recursive:true,force:true});}
 });
});
