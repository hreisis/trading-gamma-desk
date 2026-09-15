import type { V2CommandCenterPageView } from '@/desk/load-v2-home';
import type { V2Language } from '@/desk/v2-command-center';
import styles from './OverviewCards.module.css';

const num = (n: number | null | undefined) => n == null ? '—' : `${Math.round(n)}`;
const delta = (n: number | null | undefined) => n == null ? '—' : `${n > 0 ? '+' : ''}${n}`;
export function OverviewCards({view, lang}: {view: V2CommandCenterPageView; lang: V2Language}) {
 const t = (en: string, zh: string) => lang === 'zh' ? zh : en;
 const risk = view.riskScore;
 const trend = view.riskDivergenceTrend;
 const exposure = view.exposure;
 const midpoint = exposure ? (exposure.min + exposure.max) / 2 : null;
 const hb = view.allocation?.highBeta;
 const spread = view.riskDivergence;
 const tilt = spread == null ? null : spread >= 15 ? -5 : spread >= 5 ? -2 : spread <= -15 ? 5 : spread <= -5 ? 2 : 0;
 const action = tilt == null || hb == null ? '—' : tilt < 0 ? t('TRIM','减配') : tilt > 0 ? t('ADD','增配') : t('HOLD','维持');
 const target = hb == null || tilt == null ? null : Math.round(Math.min(100, Math.max(0, hb + tilt)));
 const gate = view.eventGate;
 const drivers = [
  {name:t('Event risk','事件风险'), value: gate?.stale ? t('Event snapshot is stale','事件快照已过期') : gate?.state === 'clear' ? t('No active shock window','当前无活跃冲击窗口') : gate?.activeEvents[0]?.headline ?? t('Event inputs unavailable','事件数据不足'), tone:!gate?.stale && gate?.state === 'clear' ? styles.good : styles.bad},
  {name:t('Macro','宏观'), value:view.macroSummary?.label ?? '—',tone:styles.neutral},
  {name:t('Breadth','市场宽度'),value:`SPY ${num(view.spyBreadth.percentAboveMA20)}% > MA20 · QQQ ${num(view.qqqBreadth.percentAboveMA20)}% > MA20`,tone:view.spyBreadth.breadthSignal === 'weak' ? styles.bad : styles.neutral},
  {name:t('Dealer structure','做市商结构'),value:view.gamma.map(g=>`${g.symbol}: ${g.regime == null ? '—' : t(g.regime, g.regime === 'negative' ? '负 Gamma' : g.regime === 'positive' ? '正 Gamma' : '接近零')}`).join(' · '),tone:styles.neutral},
 ];
 return <div className={styles.overview}>

  <div className={styles.grid}>
   <article className={styles.card}><h3>{t('STRUCTURAL RISK','结构风险')}</h3><ScoreScale value={risk} label={t('Structural risk','结构风险')} labels={[t('Low','低'),t('Moderate','中等'),t('High','高')]} risk /><b>{risk == null ? '—' : risk < 35 ? t('Low','低') : risk < 65 ? t('Moderate','中等') : t('Elevated','偏高')}</b><small>{t('Change vs prior publication','较上次发布')} {delta(view.riskChange)}{view.riskChange == null ? t(' · history unavailable',' · 暂无可比历史') : ''}</small></article>
   <article className={styles.card}><h3>{t('TACTICAL OPPORTUNITY','回撤机会')}</h3><ScoreScale value={view.opportunityScore} label={t('Tactical opportunity','回撤机会')} labels={[t('Limited','有限'),t('Moderate','中等'),t('High','高')]} /><b>{t('Confirmation','修复确认')}: {view.opportunity?.confirmation==='broadening'?t('Broadening','参与扩大'):view.opportunity?.confirmation==='recovering'?t('Recovery starting','修复启动'):view.opportunity?.confirmation==='unconfirmed'?t('Unconfirmed','尚未确认'):t('Unavailable','暂无数据')}</b>{view.opportunity?.eventBlocked&&<small>{t('Event conditions require review','事件条件待评估')}</small>}</article>
   <article className={styles.card}><h3>{t('RISK SNAPSHOT','风险快照')}</h3><b>QQQ − SPY {t('Risk Spread','风险差')}</b><strong className={`${styles.big} ${(view.riskDivergence ?? 0) > 0 ? styles.bad : styles.neutral}`}>{delta(view.riskDivergence)}</strong><b>{trend === 'widening' ? t('↗ WIDENING','↗ 扩大') : trend === 'narrowing' ? t('↘ NARROWING','↘ 收窄') : trend === 'stable' ? t('→ STABLE','→ 稳定') : t('Awaiting comparable history','等待可比历史')}</b><small>SPY {num(view.spyStructuralRiskScore)} · QQQ {num(view.qqqStructuralRiskScore)} · Δ {delta(view.riskDivergenceChange)}</small><p>High Beta: <b>{action}</b>{target == null ? '' : ` · ${t('Target','目标')} ${target}% · ${t('Tilt','调整')} ${delta(tilt)}`}</p><small>{t('Spread = risk-point difference, not price return. High Beta tilt: ±2 pts at spread ±5; ±5 pts at ±15.','Spread 是风险分之差，不是涨幅差；风险差达 ±5 时反向调整 2 点，达 ±15 时调整 5 点。')}</small></article>
   <article className={styles.card}><h3>{t('RECOMMENDED EXPOSURE','建议仓位')}</h3><strong className={styles.big}>{exposure ? `${exposure.min}–${exposure.max}%` : '—'}</strong><p>{t('Model exposure · scale 0–150%','模型仓位 · 刻度 0–150%')}</p><div className={styles.track}><i style={{width:`${(midpoint ?? 0)/150*100}%`}}/></div><div className={styles.bounds}><span>{t('Midpoint','中值')} {num(midpoint)}%</span><span>Min {num(exposure?.min)}%</span><span>Max {num(exposure?.max)}%</span></div></article>
   <article className={`${styles.card} ${styles.drivers}`}><h3>{t('KEY DRIVERS','关键驱动')}</h3><ul>{drivers.map(d=><li key={d.name}><b className={d.tone}>{d.name}</b><span>{d.value}</span></li>)}</ul><div className={styles.bounds}><b>{t('Input coverage','输入覆盖')}</b><span>{num(view.riskCoverage?.effectiveWeight)} / 90</span></div><div className={styles.track}><i style={{width:`${(view.riskCoverage?.effectiveWeight ?? 0)/90*100}%`}}/></div><small>{t('Factor coverage','因子覆盖')} {num(view.riskCoverage?.effectiveWeight)} / 90</small></article>
  </div>
  <div className={styles.dates}><b>{t('Daily inputs','日频输入')} · {view.sessionDate ?? '—'}</b><span>{t('Risk combines dated daily inputs with current event risk; not a real-time score.','Risk 综合日频快照与当前事件风险，并非实时风险分。')}</span><small>{t('Options','期权')}: {view.gamma.map(g=>`${g.symbol} ${g.sessionDate ?? '—'}`).join(' · ')} · {t('Event checked','事件评估')}: {gate?.asOf ? `${gate.asOf.slice(0,16).replace('T',' ')} UTC` : '—'}</small></div>
  <details className={styles.details}><summary>{t('Score methodology & option sensitivity','评分依据与期权敏感性')}</summary><p>{t('Opportunity is an uncalibrated daily heuristic, independent of Risk. Both indices and same-session breadth are required. Confirmation does not add to the score; event constraints are separate.','机会分是尚未校准的日频规则，独立于 Risk；需要双指数与同日宽度齐全。修复确认不加分，事件限制单独显示。')}</p><ul>{view.opportunity?.factors.map(f=><li key={f.id}>{f.id==='dislocation'?t('Distance below prior MA20 / daily volatility','低于此前 MA20 的幅度／日波动'):f.id==='washout'?t('Breadth washout','宽度洗盘'):t('Daily decline / prior volatility','单日跌幅／此前波动')}: {f.score}/100 · {f.weight}%</li>)}</ul><p>{t('Opportunity coverage','机会分覆盖')} {view.opportunity?.coverage??0}/100 · {view.opportunity?.sessionDate??'—'}</p><p>{t('Excluding options (diagnostic only)','排除期权（仅诊断）')}: Risk {num(view.optionSensitivity?.riskWithoutOptions)} · Spread {num(view.optionSensitivity?.spreadWithoutOptions)}. {t('A dash means insufficient remaining coverage.','横线表示剩余覆盖不足。')}</p><ul>{view.optionSensitivity?.factors.map(f=><li key={f.id}>{f.id}: {f.score} · {t('weight','权重')} {f.effectiveWeight}</li>)}</ul></details>

 </div>;
}

function ScoreScale({value,label,labels,risk=false}:{value:number|null;label:string;labels:[string,string,string];risk?:boolean}) {
 const position=value==null?null:Math.max(0,Math.min(100,value));
 const color=position==null?'#a2bad4':position<35?(risk?'#32bf8b':'#cd6470'):position<65?'#d6ac49':(risk?'#cd6470':'#32bf8b');
 return <div className={styles.scoreScale}>
  <strong className={styles.scoreNumber} style={{color}}>{num(value)}<small> / 100</small></strong>
  <div className={`${styles.scoreRail} ${risk?styles.riskRail:''}`} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={position??undefined} aria-valuetext={position==null?'Unavailable':String(position)}>
   {position!=null&&<i style={{left:`${position}%`,background:color}}/>}
  </div><div className={styles.scaleLabels}><span>{labels[0]} · 0</span><span>{labels[1]} · 50</span><span>{labels[2]} · 100</span></div>
 </div>;
}
