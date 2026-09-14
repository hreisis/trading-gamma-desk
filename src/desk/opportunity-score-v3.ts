/** Daily tactical setup, independent of Risk. Heuristic weights, not calibrated probabilities. */
export interface OpportunityV3 {
  version: 'daily-v3';
  score: number | null;
  coverage: number;
  sessionDate: string;
  confirmation: 'unavailable' | 'unconfirmed' | 'recovering' | 'broadening';
  eventBlocked: boolean;
  factors: { id: 'dislocation' | 'washout' | 'selloff'; weight: number; score: number }[];
}
type Bar = { sessionDate: string; close: number };
const clamp = (n: number) => Math.max(0, Math.min(100, n));
const sd = (xs: number[]) => { const mean=xs.reduce((a,b)=>a+b,0)/xs.length; return Math.sqrt(xs.reduce((a,b)=>a+(b-mean)**2,0)/xs.length); };
export function deriveOpportunityV3(input: {
  sessionDate: string;
  bars?: ReadonlyMap<string, readonly Bar[]>;
  breadth: { stale: boolean; marketSessionDate: string | null; advancingPct: number | null };
  eventBlocked: boolean;
}): OpportunityV3 {
  const samples: {dislocation:number;repair:number;selloff:number}[]=[];
  for (const symbol of ['SPY','QQQ']) {
    const bars=[...(input.bars?.get(symbol)??[])].filter(b=>b.sessionDate<=input.sessionDate).sort((a,b)=>a.sessionDate.localeCompare(b.sessionDate)).slice(-21);
    if(bars.length!==21 || bars.at(-1)?.sessionDate!==input.sessionDate || new Set(bars.map(b=>b.sessionDate)).size!==21 || bars.some(b=>!Number.isFinite(b.close)||b.close<=0)) continue;
    const prices=bars.map(b=>b.close), returns=prices.slice(1).map((p,i)=>Math.log(p/prices[i]!));
    const sigma=sd(returns.slice(0,-1)); if(sigma<1e-6)continue;
    const last=prices.at(-1)!, prior=prices.at(-2)!, mean=prices.slice(0,20).reduce((a,b)=>a+b,0)/20;
    const recent=prices.slice(-5), low=Math.min(...recent), high=Math.max(...recent);
    // Distance below the prior MA20, normalized by daily realized volatility.
    const dislocation=clamp(Math.log(mean/last)/sigma*25);
    // Positive daily recovery and distance off the five-session closing low.
    const repair=clamp(50*Math.max(0,Math.log(last/prior)/sigma)+50*(high>low?(last-low)/(high-low):0));
    const selloff=clamp(-Math.log(last/prior)/sigma*25);
    samples.push({dislocation,repair,selloff});
  }
  const factors:OpportunityV3['factors']=[];
  const avg=(key:keyof typeof samples[number])=>samples.reduce((a,b)=>a+b[key],0)/samples.length;
  const breadth=input.breadth;
  const advancing=!breadth.stale && breadth.marketSessionDate===input.sessionDate && breadth.advancingPct!==null && Number.isFinite(breadth.advancingPct) && breadth.advancingPct>=0 && breadth.advancingPct<=100 ? breadth.advancingPct:null;
  // Require both indices; missing constituents must not silently change the model universe.
  if(samples.length===2){
    factors.push({id:'dislocation',weight:40,score:Math.round(avg('dislocation'))});
    factors.push({id:'selloff',weight:30,score:Math.round(avg('selloff'))});
  }
  if(advancing!==null)factors.push({id:'washout',weight:30,score:Math.round(100-advancing)});
  const coverage=factors.reduce((a,b)=>a+b.weight,0);
  const score=coverage===100?Math.round(factors.reduce((a,b)=>a+b.score*b.weight,0)/100):null;
  const confirmation = samples.length!==2 || advancing===null ? 'unavailable'
    : avg('repair')<50 ? 'unconfirmed' : advancing>=60 ? 'broadening' : 'recovering';
  return {version:'daily-v3',score,coverage,sessionDate:input.sessionDate,confirmation,eventBlocked:input.eventBlocked,factors};
}
