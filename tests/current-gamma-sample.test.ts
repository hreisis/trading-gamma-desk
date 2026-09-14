import { describe, it, expect } from 'vitest';
import { currentGammaSample } from '@/gamma/marketdata-app/current-sample';
import { planBoundedStrikeRange } from '@/gamma/marketdata-app/strikes';
import { runBoundedGammaProvider } from '@/gamma/marketdata-app/run';
import { readFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
describe('current-chain repair', () => {
  it('bounds both symbol samples to 60 contracts total and avoids same-day expiry', () => {
    for (const spot of [764.29, 714.88]) {
      const s = currentGammaSample(spot, '2026-09-14');
      expect(s.expiration).toBe('2026-09-18');
      expect(planBoundedStrikeRange({ ...s, strikeStep: 5, maxExpectedContracts: 30 }).estimatedMaxContracts).toBe(30);
    }
    expect(currentGammaSample(764, '2026-09-18').expiration).toBe('2026-09-25');
  });
  it('omits date, accepts 203 and keeps the vendor session; refuses null Greeks without writes', async () => {
    const body = JSON.parse(readFileSync('fixtures/gamma/providers/marketdata-app/spy-minimal.ok.json', 'utf8'));
    let url = '';
    const fetchImpl = (async (u: string | URL | Request) => {url = String(u); return new Response(JSON.stringify(body), {status:203});}) as typeof fetch;
    const dataRoot = mkdtempSync(join(tmpdir(), 'gamma-repair-'));
    const args = {symbol:'SPY', expiration:'2026-08-07', strikeMin:700, strikeMax:710, strikeStep:5, token:'test', fetchImpl, dataRoot, write:false};
    const good = await runBoundedGammaProvider(args);
    expect(new URL(url).searchParams.has('date')).toBe(false);
    expect(good.ok).toBe(true);
    body.gamma = body.gamma.map(() => null);
    const bad = await runBoundedGammaProvider({...args, write:true});
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.code).toBe('no_usable_greeks');
    expect(existsSync(join(dataRoot, 'SPY-bounded-latest.json'))).toBe(false);
  });
});
