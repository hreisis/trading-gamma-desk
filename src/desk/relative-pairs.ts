/** Descriptive relative returns, not trading signals. Same-session ETF closes only. */
export const RELATIVE_PAIRS=[['SMH','IGV'],['IBIT','QQQ']] as const;
type Bar={sessionDate:string;close:number};
export interface RelativePair {
 left:string;right:string;sessionDate:string;status:'ready'|'unavailable';
 points:{date:string;value:number}[];
 horizons:{sessions:number;leftReturn:number;rightReturn:number;spread:number}[];
}
export function buildRelativePairs(bars:ReadonlyMap<string,readonly Bar[]>,sessionDate:string):RelativePair[]{
 const reference=[...(bars.get('QQQ')??[])].filter(b=>b.sessionDate<=sessionDate).sort((a,b)=>a.sessionDate.localeCompare(b.sessionDate)).slice(-21);
 const dates=reference.map(b=>b.sessionDate);
 return RELATIVE_PAIRS.map(([left,right])=>{
 const empty:RelativePair={left,right,sessionDate,status:'unavailable',points:[],horizons:[]};
 if(dates.length!==21||dates.at(-1)!==sessionDate||new Set(dates).size!==21)return empty;
 const series=[left,right].map(symbol=>{
 const raw=(bars.get(symbol)??[]).filter(b=>dates.includes(b.sessionDate));
 if(raw.length!==21||new Set(raw.map(b=>b.sessionDate)).size!==21)return null;
 const m=new Map(raw.map(b=>[b.sessionDate,b.close])),values=dates.map(d=>m.get(d));
 return values.every(v=>v!==undefined&&Number.isFinite(v)&&v>0)?values as number[]:null;
 });
 const [a,b]=series;if(!a||!b)return empty;
 const firstRatio=a[0]!/b[0]!;
 return {...empty,status:'ready',points:dates.map((date,i)=>({date,value:(a[i]!/b[i]!)/firstRatio*100})),horizons:[1,5,20].map(sessions=>{
 const leftReturn=(a[20]!/a[20-sessions]!-1)*100,rightReturn=(b[20]!/b[20-sessions]!-1)*100;
 return {sessions,leftReturn,rightReturn,spread:leftReturn-rightReturn};
 })};
 });
}
