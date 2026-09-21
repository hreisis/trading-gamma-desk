export interface ScorePoint {date:string;at:string;risk:number|null;opportunity:number|null;version:string;source?:'daily-close'}
export function scoreColor(value:number,risk=false) {return value<35?(risk?'#32bf8b':'#cd6470'):value<65?'#d6ac49':(risk?'#cd6470':'#32bf8b');}
export function mergeScoreHistory(points:ScorePoint[]):ScorePoint[] {
 const dates=new Map<string,ScorePoint>();
 for(const p of points) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(p.date)||!Number.isFinite(Date.parse(p.at)))continue;
  if([p.risk,p.opportunity].some(n=>n!==null&&(typeof n!=='number'||!Number.isFinite(n)||n<0||n>100)))continue;
  const previous=dates.get(p.date);
  if(!previous||(p.source==='daily-close'&&previous.source!=='daily-close')
    ||(p.source===previous.source&&previous.at<p.at))dates.set(p.date,p);
 }
 return [...dates.values()].sort((a,b)=>a.date.localeCompare(b.date)).slice(-730);
}
