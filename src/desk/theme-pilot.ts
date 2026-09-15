/** Experimental daily theme policy. Does not change portfolio action or sizing. */
export interface ThemePilotRow {
 symbol:string; name:{en:string;zh:string}; sessionDate:string;
 status:'ready'|'unavailable';reason:string;
 return1d:number|null;rs5:number|null;rs20:number|null;
 trend:'up'|'mixed'|'down'|null;opportunity:number|null;recovering:boolean|null;
 setup:'BUY'|'HOLD'|'SELL'|null;action:'BUY'|'HOLD'|'SELL'|null;marketGated:boolean;
}
export const PILOT_THEMES=[
 {symbol:'SMH',name:{en:'Semiconductors',zh:'半导体'},members:['SMH']},
 {symbol:'IGV',name:{en:'Software',zh:'软件'},members:['IGV']},
 {symbol:'MAG7',name:{en:'Mega-cap technology',zh:'大型科技'},members:['AAPL','MSFT','NVDA','AMZN','META','GOOGL','TSLA']},
] as const;
type Bar={sessionDate:string;close:number};
const mean=(xs:number[])=>xs.reduce((a,b)=>a+b,0)/xs.length;
const clamp=(x:number)=>Math.max(0,Math.min(100,x));
const round=(x:number)=>Math.round(x*100)/100 || 0;
export function buildThemePilot(input:{bars:ReadonlyMap<string,readonly Bar[]>;sessionDate:string;risk:number|null;eventBlocked:boolean}):ThemePilotRow[]{
 const spy=[...(input.bars.get('SPY')??[])].filter(b=>b.sessionDate<=input.sessionDate).sort((a,b)=>a.sessionDate.localeCompare(b.sessionDate)).slice(-55);
 const dates=spy.map(b=>b.sessionDate);
 const validSpy=spy.length===55&&dates.at(-1)===input.sessionDate&&new Set(dates).size===55&&spy.every(b=>Number.isFinite(b.close)&&b.close>0);
 return PILOT_THEMES.map(theme=>{
 const empty:ThemePilotRow={symbol:theme.symbol,name:theme.name,sessionDate:input.sessionDate,status:'unavailable',reason:'Requires 55 aligned sessions for SPY and every member',return1d:null,rs5:null,rs20:null,trend:null,opportunity:null,recovering:null,setup:null,action:null,marketGated:false};
 if(!validSpy)return empty;
 const series=theme.members.map(symbol=>{
 const raw=(input.bars.get(symbol)??[]).filter(b=>dates.includes(b.sessionDate));
 if(raw.length!==55||new Set(raw.map(b=>b.sessionDate)).size!==55)return null;
 const byDate=new Map(raw.map(b=>[b.sessionDate,b.close]));
 const values=dates.map(d=>byDate.get(d));
 return values.every(v=>v!==undefined&&Number.isFinite(v)&&v>0)?values as number[]:null;
 });
 if(series.some(s=>s===null))return empty;
 // Daily-rebalanced equal weights, full constituent coverage, fixed research basket.
 const prices=[100];for(let i=1;i<55;i++)prices.push(prices[i-1]!*(1+mean(series.map(s=>s![i]!/s![i-1]!-1))));
 const last=prices[54]!,prior=prices[53]!,ma20=mean(prices.slice(-20)),ma50=mean(prices.slice(-50)),priorMa20=mean(prices.slice(-25,-5));
 const returns=prices.slice(-21,-1).map((p,i)=>Math.log(p/prices[33+i]!));
 const sigma=Math.sqrt(mean(returns.map(r=>(r-mean(returns))**2)));
 if(sigma<1e-6)return {...empty,reason:'Insufficient realized variation for volatility normalization'};
 const ret=(p:number[],n:number)=>(p.at(-1)!/p[p.length-1-n]!-1)*100;
 const benchmark=spy.map(b=>b.close),rs5=round(ret(prices,5)-ret(benchmark,5)),rs20=round(ret(prices,20)-ret(benchmark,20));
 const trend=last>=ma20&&ma20>=ma50&&ma20>=priorMa20?'up':last<ma20&&ma20<ma50&&ma20<priorMa20?'down':'mixed';
 const opportunity=Math.round(.6*clamp(Math.log(mean(prices.slice(-21,-1))/last)/sigma*25)+.4*clamp(-Math.log(last/prior)/sigma*25));
 const recent=prices.slice(-5),low=Math.min(...recent),high=Math.max(...recent);
 const recovering=last>prior&&high>low&&(last-low)/(high-low)>=.5;
 const setup=trend==='down'&&rs5<0&&rs20<0?'SELL':opportunity>=45&&trend!=='down'&&recovering?'BUY':'HOLD';
 const marketGated=setup==='BUY'&&(input.risk===null||input.risk>65||input.eventBlocked);
 return {...empty,status:'ready',reason:setup==='SELL'?'Trend and relative strength are deteriorating':setup==='BUY'?'Dip opportunity with price recovery':'No aligned entry or exit conditions',return1d:round(ret(prices,1)),rs5,rs20,trend,opportunity,recovering,setup,action:marketGated?'HOLD':setup,marketGated};
 });
}

/** Diagnostic replay: intrinsic theme setup only; historical market gates are not reconstructed. */
export function replayThemePilot(input:{bars:ReadonlyMap<string,readonly Bar[]>;sessionDate:string;count?:number}){
 const dates=[...new Set((input.bars.get('SPY')??[]).filter(b=>b.sessionDate<=input.sessionDate).map(b=>b.sessionDate))].sort().slice(-(input.count??10));
 return dates.map(sessionDate=>{
  const result=buildThemePilot({...input,sessionDate,risk:null,eventBlocked:true}).find(r=>r.symbol==='SMH')!;
  const closes=(input.bars.get('SMH')??[]).filter(b=>b.sessionDate<=sessionDate).sort((a,b)=>a.sessionDate.localeCompare(b.sessionDate)).map(b=>b.close);
  const ma20=closes.length>=20?mean(closes.slice(-20)):null;
  return {sessionDate,status:result.status,setup:result.setup,return1d:result.return1d,rs5:result.rs5,rs20:result.rs20,trend:result.trend,opportunity:result.opportunity,belowMa20Pct:ma20&&closes.at(-1)!>0?round((closes.at(-1)!/ma20-1)*100):null};
 });
}
