import type {RelativePair} from '@/desk/relative-pairs';
import type {V2Language} from '@/desk/v2-command-center';
import styles from './RelativePairs.module.css';
const fmt=(v:number)=>`${v>0?'+':''}${v.toFixed(2)}`;
export function RelativePairs({pairs,lang}:{pairs:readonly RelativePair[];lang:V2Language}){
 const t=(en:string,zh:string)=>lang==='zh'?zh:en;
 return <div className={styles.grid} data-testid="relative-pairs">{pairs.map(p=>{
 const crypto=p.left==='IBIT',left=crypto?t('Bitcoin ETF','比特币 ETF'):t('Hardware','硬件'),right=crypto?t('Technology stocks','科技股'):t('Software','软件');
 const five=p.horizons.find(h=>h.sessions===5),one=p.horizons.find(h=>h.sessions===1);
 const leader=!five?'—':Math.abs(five.spread)<.25?t('Recently matched','近期表现接近'):five.spread>0?`${left}${t(' leads over 5 sessions','近 5 日相对占优')}`:`${right}${t(' leads over 5 sessions','近 5 日相对占优')}`;
 const values=p.points.map(x=>x.value),min=Math.min(100,...values),max=Math.max(100,...values),span=Math.max(max-min,1),low=min-span*.1,high=max+span*.1;
 const y=(v:number)=>120-(v-low)/(high-low)*105;
 const path=p.points.map((point,i)=>`${i===0?'M':'L'} ${10+i/(p.points.length-1)*380} ${y(point.value)}`).join(' ');
 return <section className={styles.pair} key={p.left}><div className={styles.kicker}>{crypto?t('CRYPTO / TECH','CRYPTO／科技股'):t('HARDWARE / SOFTWARE','硬件／软件')}<span>{p.left} / {p.right}</span></div><h3>{leader}</h3>
 {p.status==='ready'?<><p className={styles.explanation}>{t('5-session return difference','5 日收益差')} <b>{fmt(five!.spread)} {t('pp','个百分点')}</b>{one&&one.leftReturn<0&&one.rightReturn<0?t(' · Both fell today; relative strength is not an absolute gain.',' · 今日双方均下跌，相对占优不等于上涨。'):t(' · Relative performance, not a paired trade instruction.',' · 比较相对表现，不是配对交易指令。')}</p>
 <svg viewBox="0 0 400 145" role="img" aria-label={t(`${p.left}/${p.right} ratio, rebased to 100 over 20 sessions`,`${p.left}/${p.right} 比值走势，20 个交易日前归一为 100`)}><line x1="10" x2="390" y1={y(100)} y2={y(100)} stroke="#36516a" strokeDasharray="3 5"/><path d={path} fill="none" stroke="#7aaff0" strokeWidth="2"/><text x="10" y="141">{p.points[0]!.date}</text><text x="390" y="141" textAnchor="end">{p.sessionDate}</text></svg>
 <div className={styles.caption}>{t(`Rising: ${p.left} stronger · Falling: ${p.right} stronger · Start = 100`,`向上：${p.left} 更强 · 向下：${p.right} 更强 · 起点 = 100`)}</div>
 <table><thead><tr><th>{t('Sessions','交易日')}</th><th>{p.left}</th><th>{p.right}</th><th>{t('Difference (pp)','收益差（点）')}</th></tr></thead><tbody>{p.horizons.map(h=><tr key={h.sessions}><td>{h.sessions}D</td><td>{fmt(h.leftReturn)}%</td><td>{fmt(h.rightReturn)}%</td><td>{fmt(h.spread)}</td></tr>)}</tbody></table></>:<p className={styles.empty}>{t('Waiting for 21 matching daily closes. No mismatched-date comparison.','等待双方 21 个同日收盘数据，不混用不同日期计算。')}</p>}
 <footer>{p.sessionDate} · {crypto?t('IBIT is a Bitcoin ETF proxy; US market sessions only, excluding weekend crypto moves.','IBIT 为比特币 ETF 代理；仅比较美股交易时段，不包含周末币价变化。'):t('SMH represents semiconductors, not all AI hardware.','SMH 代表半导体，不代表全部 AI 硬件。')}</footer></section>;
 })}</div>;
}
