import {it,expect} from 'vitest';
import {evaluateUniverseFreshness, tradingSessionLag} from '@/desk/breadth/universe/session-lag';
it('accepts a Sunday holdings effective date without changing market-session validation',()=>{
 const r=evaluateUniverseFreshness({universeAsOf:'2026-09-13',targetMarketSessionDate:'2026-09-14'});
 expect(r.status).toBe('available');expect(r.sessionLag).toBe(1);expect(r.stale).toBe(false);
 expect(tradingSessionLag('2026-09-13','2026-09-14')).toBeNull();
 expect(evaluateUniverseFreshness({universeAsOf:'2026-09-20',targetMarketSessionDate:'2026-09-14'}).status).toBe('unavailable');
 expect(evaluateUniverseFreshness({universeAsOf:'2026-08-01',targetMarketSessionDate:'2026-09-14'}).status).toBe('unavailable');
});
