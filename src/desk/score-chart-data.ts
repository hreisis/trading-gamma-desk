import type {ScorePoint} from './score-history';
export function legacyScorePoint(raw:unknown):ScorePoint|null {
 if(!raw||typeof raw!=='object')return null;
 const r=raw as {sessionDate?:string;generatedAt?:string;riskScore?:number|null;marketAction?:{inputs?:{opportunity?:number|null}};schemaVersion?:string};
 if(!r.sessionDate||!r.generatedAt)return null;
 return {date:r.sessionDate,at:r.generatedAt,risk:r.riskScore??null,opportunity:r.marketAction?.inputs?.opportunity??null,version:`legacy-unverified/${r.schemaVersion??'unknown'}/${r.sessionDate}`};
}
export type PricePoint={date:string;close:number};
export function relativePrices(points:PricePoint[],start:number,end:number) {
 const rows=points.filter(p=>Date.parse(p.date)>=start&&Date.parse(p.date)<=end&&Number.isFinite(p.close)&&p.close>0).sort((a,b)=>a.date.localeCompare(b.date));
 const base=rows[0]?.close;
 return base?rows.map(p=>({date:p.date,value:(p.close/base-1)*100})):[];
}
