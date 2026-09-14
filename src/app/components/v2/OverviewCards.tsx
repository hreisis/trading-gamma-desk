import type { V2CommandCenterPageView } from '@/desk/load-v2-home';
import type { V2Language } from '@/desk/v2-command-center';
import styles from './OverviewCards.module.css';

const num = (n: number | null | undefined) => n == null ? '—' : `${Math.round(n)}`;
const delta = (n: number | null | undefined) => n == null ? '—' : `${n > 0 ? '+' : ''}${n}`;
export function OverviewCards({view, lang}: {view: V2CommandCenterPageView; lang: V2Language}) {
 const t = (en: string, zh: string) => lang === 'zh' ? zh : en;
 const risk = view.riskScore;
 const angle = Math.PI * (1 - (risk ?? 50) / 100);
 const needle = {x: 100 + 65 * Math.cos(angle), y: 94 - 65 * Math.sin(angle)};
 const trend = view.riskDivergenceTrend;
 const exposure = view.exposure;
 const midpoint = exposure ? (exposure.min + exposure.max) / 2 : null;
 const hb = view.allocation?.highBeta;
 const spread = view.riskDivergence;
 const tilt = spread == null ? null : spread >= 15 ? -5 : spread >= 5 ? -2 : spread <= -15 ? 5 : spread <= -5 ? 2 : 0;
 const action = tilt == null || hb == null ? '—' : tilt < 0 ? t('TRIM','减配') : tilt > 0 ? t('ADD','增配') : t('HOLD','维持');
 const target = hb == null || tilt == null ? null : Math.round(Math.min(100, Math.max(0, hb + tilt)));
 const stance = view.decisionStatus !== 'ready' ? t('AWAITING INPUTS','等待数据') : view.stance === 'buy' ? t('BUY','买入') : view.stance === 'reduce' ? t('REDUCE','减仓') : t('HOLD','持有');
 const confidence = view.riskCoverage?.confidence;
 const confidenceText = confidence === 'high' ? t('High','高') : confidence === 'moderate' ? t('Moderate','中等') : confidence === 'limited' ? t('Limited','有限') : t('Unavailable','暂无');
 const gate = view.eventGate;
 const drivers = [
  {name:t('Event risk','事件风险'), value: gate?.stale ? t('Event snapshot is stale','事件快照已过期') : gate?.state === 'clear' ? t('No active shock window','当前无活跃冲击窗口') : gate?.activeEvents[0]?.headline ?? t('Event inputs unavailable','事件数据不足'), tone:!gate?.stale && gate?.state === 'clear' ? styles.good : styles.bad},
  {name:t('Macro','宏观'), value:view.macroSummary?.label ?? '—',tone:styles.neutral},
  {name:t('Breadth','市场宽度'),value:`SPY ${num(view.spyBreadth.percentAboveMA20)}% > MA20 · QQQ ${num(view.qqqBreadth.percentAboveMA20)}% > MA20`,tone:view.spyBreadth.breadthSignal === 'weak' ? styles.bad : styles.neutral},
  {name:t('Dealer structure','做市商结构'),value:view.gamma.map(g=>`${g.symbol}: ${g.regime == null ? '—' : t(g.regime, g.regime === 'negative' ? '负 Gamma' : g.regime === 'positive' ? '正 Gamma' : '接近零')}`).join(' · '),tone:styles.neutral},
 ];
 return <div className={styles.overview}>
  <div className={styles.dates}><b>{t('Daily inputs','日频输入')} · {view.sessionDate ?? '—'}</b><span>{t('Risk combines dated daily inputs with current event risk; not a real-time score.','Risk 综合日频快照与当前事件风险，并非实时风险分。')}</span><small>{t('Options','期权')}: {view.gamma.map(g=>`${g.symbol} ${g.sessionDate ?? '—'}`).join(' · ')} · {t('Event checked','事件评估')}: {gate?.asOf ? `${gate.asOf.slice(0,16).replace('T',' ')} UTC` : '—'}</small></div>
  <div className={styles.grid}>
   <article className={styles.card}><h3>{t('MARKET STANCE','市场操作')}</h3><strong className={styles.big}>{stance}</strong><p>{t('Risk model classification','风险模型判断')} · {view.macroSummary?.label ?? '—'}</p><small>{t('Gamma indicates amplification or compression, not direction.','Gamma 描述波动放大或抑制，不单独判断涨跌。')}</small></article>
   <article className={styles.card}><h3>{t('SENTIMENT / RISK','情绪／风险')}</h3><svg viewBox="0 0 200 145" role="img" aria-label={`${t('Structural risk','结构风险')} ${num(risk)} / 100`} className={styles.gauge}>
    <path d="M 20 94 A 80 80 0 0 1 180 94" pathLength="100" fill="none" stroke="#213446" strokeWidth="12"/>
    <path d="M 20 94 A 80 80 0 0 1 180 94" pathLength="100" fill="none" stroke="#2addb0" strokeWidth="12" strokeDasharray="34 66"/>
    <path d="M 20 94 A 80 80 0 0 1 180 94" pathLength="100" fill="none" stroke="#edb74b" strokeWidth="12" strokeDasharray="29 71" strokeDashoffset="-35"/>
    <path d="M 20 94 A 80 80 0 0 1 180 94" pathLength="100" fill="none" stroke="#ff7181" strokeWidth="12" strokeDasharray="35 65" strokeDashoffset="-65"/>
    {risk != null && <line x1="100" y1="94" x2={needle.x} y2={needle.y} stroke="#edf3ff" strokeWidth="3"/>}<text x="100" y="129" textAnchor="middle" fill="currentColor" fontSize="27" fontWeight="700">{num(risk)}</text><text x="15" y="114" fill="#a2bad4" fontSize="10">0</text><text x="173" y="114" fill="#a2bad4" fontSize="10">100</text>
   </svg><b>{risk == null ? '—' : risk < 35 ? t('Low','低') : risk < 65 ? t('Moderate','中等') : t('Elevated','偏高')}</b><small>{t('Change vs prior publication','较上次发布')} {delta(view.riskChange)}{view.riskChange == null ? t(' · history unavailable',' · 暂无可比历史') : ''}</small></article>
   <article className={styles.card}><h3>{t('RISK SNAPSHOT','风险快照')}</h3><b>QQQ − SPY {t('Risk Spread','风险差')}</b><strong className={`${styles.big} ${(view.riskDivergence ?? 0) > 0 ? styles.bad : styles.neutral}`}>{delta(view.riskDivergence)}</strong><b>{trend === 'widening' ? t('↗ WIDENING','↗ 扩大') : trend === 'narrowing' ? t('↘ NARROWING','↘ 收窄') : trend === 'stable' ? t('→ STABLE','→ 稳定') : t('Awaiting comparable history','等待可比历史')}</b><small>SPY {num(view.spyStructuralRiskScore)} · QQQ {num(view.qqqStructuralRiskScore)} · Δ {delta(view.riskDivergenceChange)}</small><p>High Beta: <b>{action}</b>{target == null ? '' : ` · ${t('Target','目标')} ${target}% · ${t('Tilt','调整')} ${delta(tilt)}`}</p><small>{t('Spread = risk-point difference, not price return. High Beta tilt: ±2 pts at spread ±5; ±5 pts at ±15.','Spread 是风险分之差，不是涨幅差；风险差达 ±5 时反向调整 2 点，达 ±15 时调整 5 点。')}</small></article>
   <article className={styles.card}><h3>{t('RECOMMENDED EXPOSURE','建议仓位')}</h3><strong className={styles.big}>{exposure ? `${exposure.min}–${exposure.max}%` : '—'}</strong><p>{t('Model exposure · scale 0–150%','模型仓位 · 刻度 0–150%')}</p><div className={styles.track}><i style={{width:`${(midpoint ?? 0)/150*100}%`}}/></div><div className={styles.bounds}><span>{t('Midpoint','中值')} {num(midpoint)}%</span><span>Min {num(exposure?.min)}%</span><span>Max {num(exposure?.max)}%</span></div></article>
   <article className={`${styles.card} ${styles.drivers}`}><h3>{t('KEY DRIVERS','关键驱动')}</h3><ul>{drivers.map(d=><li key={d.name}><b className={d.tone}>{d.name}</b><span>{d.value}</span></li>)}</ul><div className={styles.bounds}><b>{t('Input confidence','输入置信度')}</b><span>{confidenceText}</span></div><div className={styles.track}><i style={{width:`${(view.riskCoverage?.effectiveWeight ?? 0)/90*100}%`}}/></div><small>{t('Factor coverage','因子覆盖')} {num(view.riskCoverage?.effectiveWeight)} / 90</small></article>
  </div>
 </div>;
}
