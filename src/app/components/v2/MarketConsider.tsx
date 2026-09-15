import type { V2CommandCenterPageView } from '@/desk/load-v2-home';
import type { V2Language } from '@/desk/v2-command-center';
import styles from './DarkCommandCenter.module.css';

export function MarketConsider({view, lang}: {view: V2CommandCenterPageView; lang: V2Language}) {
 const t = (en: string, zh: string) => lang === 'zh' ? zh : en;
 const ready = view.marketAction ? view.marketAction.action !== null : view.decisionStatus === 'ready';
 const stance = view.marketAction ? (view.marketAction.action === 'SELL' ? 'reduce' : view.marketAction.action === 'BUY' ? 'buy' : 'hold') : view.stance;
 const weak = view.spyBreadth.breadthSignal === 'weak';
 const negative = view.gamma.filter(g => g.status === 'ready' && g.regime === 'negative').map(g=>g.symbol);
 const event = view.eventGate;
 const title = !ready ? t('Wait for a clearer picture before taking a new position.','信息尚不完整，先等待更清晰的判断。') : stance === 'reduce' ? t('Reduce exposure; the structure calls for caution.','先收缩风险敞口，当前结构需要谨慎。') : stance === 'buy' ? t('Conditions support measured additions.','条件支持分步增加敞口。') : t('Hold selectively; wait for broader confirmation.','选择性持有，等待更广泛的确认。');
 const reasons = [
  weak ? t('Weak SPY breadth suggests that strength is not widely shared across stocks.','SPY 市场宽度偏弱，指数表现尚未得到多数成分股的支持。') : view.spyBreadth.breadthSignal === 'strong' ? t('Strong SPY breadth gives the market move broader support.','SPY 市场宽度较强，行情得到更多成分股支持。') : t('Breadth does not yet provide a strong directional confirmation.','市场宽度尚未提供明确的方向确认。'),
  negative.length ? t(`${negative.join(' / ')} negative Gamma can amplify moves in either direction; it is not a bearish forecast.`,`${negative.join(' / ')} 为负 Gamma，可能放大双向波动，不能单独据此判断下跌。`) : t('Use the option levels below to assess where the current structure may change.','结合下方期权关键位，观察结构可能在哪里发生变化。'),
 ];
 const watch = weak ? t('Look for breadth to improve alongside price, then reassess exposure.','观察价格修复是否伴随市场宽度改善，再重新评估仓位。') : t('Watch whether participation holds as price approaches the option levels.','观察价格接近期权关键位时，市场参与度能否维持。');
 const risk = !event || event.stale ? t('Event coverage is incomplete or stale; the event backdrop remains uncertain.','事件信息缺失或过期，当前事件背景仍有不确定性。') : event.state !== 'clear' ? t('An event risk window is active. Reassess after the release and market response.','存在事件风险窗口，需结合事件公布及市场反应重新评估。') : t('No active event shock window is flagged. A deterioration in breadth or Gamma structure would still require reassessment.','目前未标记活跃事件冲击窗口；若市场宽度或 Gamma 结构恶化，仍需重新评估。');
 if (view.webResearch) {const r=view.webResearch;return <section className={styles.consider} aria-labelledby="market-consider-title"><div className={styles.considerMeta}><span>MARKET CONSIDER · {t('THE DESK VIEW','今日研判')}</span><span>{t('Research published','研究发布')} {r.generatedAt.slice(0,16).replace('T',' ')} UTC</span></div><h2 id="market-consider-title">{r.content.headline[lang]}</h2><p className={styles.considerLead}>{r.content.summary[lang]}</p><a href="#ai-study">{t('Read the research & sources →','阅读完整研判与来源 →')}</a></section>;}
 return <section className={styles.consider} aria-labelledby="market-consider-title">
  <div className={styles.considerMeta}><span>MARKET CONSIDER · {t('THE DESK VIEW','今日研判')}</span><span>{t('Daily inputs','日频输入')} {view.sessionDate ?? '—'}</span></div>
  <h2 id="market-consider-title">{title}</h2>
  <p className={styles.considerLead}>{ready ? reasons.join(' ') : t('The available inputs are not sufficient for a reliable stance. The sections below show what is known and what is missing.','现有输入不足以形成可靠的操作判断。下方会展示已知信息与缺失部分。')}</p>
  <div className={styles.considerColumns}><div><h3>{t('WHAT TO WATCH','接下来看什么')}</h3><p>{watch}</p></div><div><h3>{t('WHAT COULD CHANGE THE VIEW','什么会改变判断')}</h3><p>{risk}</p></div></div>
  <small>{t('Rule-based synthesis of dated inputs; the deeper AI study loads separately.','基于标注日期的数据综合研判；右侧 AI 研究独立加载。')}</small>
 </section>;
}
