'use client';
import {useEffect,useId,useState} from 'react';
import {mergeScoreHistory,scoreColor,type ScorePoint} from '@/desk/score-history';
export function ScoreHistory({current,lang,demo=false}:{current:ScorePoint|null;lang:'en'|'zh';demo?:boolean}) {
 const [history,setHistory]=useState<ScorePoint[]>([]),[range,setRange]=useState(30);
 const id=useId().replace(/:/g,'');const zh=lang==='zh';
 useEffect(()=>{if(demo)return;let active=true;fetch('/api/scores/history').then(r=>r.ok?r.json():null).then(r=>{if(active&&Array.isArray(r?.points))setHistory(mergeScoreHistory(r.points));}).catch(()=>{});return()=>{active=false;};},[demo]);
 const all=mergeScoreHistory([...history,...(current?[current]:[])]);
 const end=all.length?Date.parse(all[all.length-1]!.date+'T00:00:00Z'):Date.now();
 const start=range?end-(range-1)*86400000:Math.min(end-86400000,...all.map(p=>Date.parse(p.date+'T00:00:00Z')));
 const points=all.filter(p=>Date.parse(p.date+'T00:00:00Z')>=start);
 const x=(date:string)=>48+(Date.parse(date+'T00:00:00Z')-start)/Math.max(86400000,end-start)*844;
 const y=(v:number)=>220-v*1.8;
 return <section style={{gridColumn:'1 / -1',borderTop:'1px solid #294252',padding:'24px 0',minWidth:0}} aria-label={zh?'风险与机会历史':'Risk and opportunity history'}>
  <div style={{display:'flex',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}><h3 style={{margin:0}}>{zh?'结构风险 × 回撤机会':'Structural risk × Dip opportunity'}</h3><div>{[[7,zh?'日 · 7天':'Days · 7D'],[30,zh?'月 · 1个月':'Month · 1M'],[90,zh?'3个月':'3M'],[0,zh?'全部':'All']].map(([n,label])=><button key={n} onClick={()=>setRange(Number(n))} aria-pressed={range===n} style={{background:'none',color:range===n?'#72baff':'#a2bad4',border:0,padding:8,cursor:'pointer'}}>{label}</button>)}</div></div>
  <p style={{fontSize:12,color:'#a2bad4'}}>{zh?'折线：结构风险 · 渐变面积：回撤机会 · 每日原值，不取月均值':'Line: risk · Gradient area: opportunity · Daily values, no monthly averaging'}</p>
  <svg viewBox="0 0 920 265" style={{width:'100%',display:'block'}} role="img" aria-label={zh?'0–100 分历史图':'Historical scores from 0 to 100'}>
   {[0,25,50,75,100].map(v=><g key={v}><line x1="48" x2="892" y1={y(v)} y2={y(v)} stroke="#294252" strokeDasharray="3 5"/><text x="32" y={y(v)+4} textAnchor="end" fill="#a2bad4" fontSize="11">{v}</text></g>)}
   {points.map((p,i)=>{const prev=points[i-1];const connected=prev&&prev.version===p.version&&(Date.parse(p.date)-Date.parse(prev.date))/86400000<=3;const color=scoreColor(p.opportunity??0);return <g key={p.date}>
    <defs><linearGradient id={`${id}-${i}`} x1="0" y1="0" x2="0" y2="1"><stop stopColor={color} stopOpacity=".55"/><stop offset="1" stopColor={color} stopOpacity=".02"/></linearGradient></defs>
    {p.opportunity!==null&&(connected&&prev.opportunity!==null?<path d={`M ${x(prev.date)} 220 L ${x(prev.date)} ${y(prev.opportunity)} L ${x(p.date)} ${y(p.opportunity)} L ${x(p.date)} 220 Z`} fill={`url(#${id}-${i})`}/>:<rect x={x(p.date)-3} y={y(p.opportunity)} width="6" height={220-y(p.opportunity)} fill={`url(#${id}-${i})`}/>)}
   </g>;})}
   {points.map((p,i)=>{const prev=points[i-1];return <g key={p.date}><title>{`${p.date}\n${zh?'结构风险':'Risk'}: ${p.risk??'—'}\n${zh?'回撤机会':'Opportunity'}: ${p.opportunity??'—'}\n${p.version}`}</title>{p.risk!==null&&<>{prev?.risk!=null&&prev.version===p.version&&(Date.parse(p.date)-Date.parse(prev.date))/86400000<=3&&<polyline points={`${x(prev.date)},${y(prev.risk)} ${x(p.date)},${y(p.risk)}`} fill="none" stroke={scoreColor(p.risk,true)} strokeWidth="2.5"/>}<circle cx={x(p.date)} cy={y(p.risk)} r="4" fill={scoreColor(p.risk,true)}/></>}{p.opportunity!==null&&<circle cx={x(p.date)} cy={y(p.opportunity)} r="3" fill={scoreColor(p.opportunity)}/>}<rect x={x(p.date)-7} y="35" width="14" height="190" fill="transparent"/></g>;})}
   {[0,.25,.5,.75,1].map(t=><text key={t} x={48+t*844} y="247" textAnchor="middle" fill="#a2bad4" fontSize="11">{new Date(start+t*(end-start)).toISOString().slice(5,10)}</text>)}
  </svg>
  <small style={{color:'#a2bad4'}}>{zh?`已保存 ${points.length} 个日期；缺失不补值，颜色沿用当日评分。历史从本功能启用后累积。`:`${points.length} recorded dates; missing values are not filled. Colors follow each day's scores. History accumulates from activation.`}</small>
 </section>;
}
