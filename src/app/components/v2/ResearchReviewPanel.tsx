import type {ResearchReview} from '@/desk/research-review';
import type {V2Language} from '@/desk/v2-command-center';
import styles from './WebResearchPanel.module.css';
export function ResearchReviewPanel({review,lang,hidden=false}:{review:ResearchReview|null;lang:V2Language;hidden?:boolean}){
 if(hidden)return null;
 const t=(en:string,zh:string)=>lang==='zh'?zh:en;
 return <section className={styles.panel} id="daily-review"><div className={styles.kicker}>DAILY REVIEW · {t('THESIS → OUTCOME','事前判断 → 实际结果')}</div>
 {!review?<><h2>{t('Awaiting a completed review','等待首期复盘')}</h2><p>{t('The next edition appears after both closing bars arrive. Without a recorded pre-open thesis, it is a closing summary only.','双指数收盘数据到齐后发布；没有事前观点记录时，仅做收盘总结。')}</p></>:<>
 <div className={styles.date}>{t('Reviewed session','复盘交易日')} {review.sessionDate} · {t('Published','发布')} {review.generatedAt.slice(0,16).replace('T',' ')} UTC · {review.source==='openai'?t('AI-assisted','AI 辅助'):t('Rule-based summary','规则总结')}</div>
 <h2>{review.thesis?.action?.action??t('Closing summary','收盘总结')}</h2><p className={styles.summary}>{review.content.summary[lang]}</p>
 <p className={styles.date}>{review.outcomes.map(o=>`${o.symbol} ${o.returnPct>0?'+':''}${o.returnPct}%`).join(' · ')} · {t('Open to close','开盘至收盘')}</p>
 {(['direction','timing','riskControl','tomorrow'] as const).map((key,i)=><div className={styles.section} key={key}><div className={styles.kicker}>0{i+1}</div><h3>{key==='direction'?t('Direction check','方向核对'):key==='timing'?t('Entry timing','参与时机'):key==='riskControl'?t('Risk control','风险控制'):t('Archived watch conditions','原观点的后续验证条件')}</h3><p>{review.content[key][lang]}</p></div>)}
 <details className={styles.limits}><summary>{t('Original thesis & evidence limits','事前观点与证据范围')}</summary><p>{review.thesis?t(`Recorded ${review.thesis.recordedAt}; inputs ${review.thesis.inputSession}.`,`记录于 ${review.thesis.recordedAt}；输入日期 ${review.thesis.inputSession}。`):t('No eligible pre-open record.','没有合格的开盘前记录。')}</p><p>{review.thesis?.action?.reason[lang]}</p><p>{review.thesis?.research?.content.summary[lang]}</p>{review.thesis?.research?.content.sections.map(s=><div key={s.kind}><b>{s.title[lang]}</b><p>{s.body[lang]}</p><div className={styles.sources}>{s.sources.map((r,i)=><a href={r.url} key={`${r.url}-${i}`} target="_blank" rel="noreferrer">{r.title}</a>)}</div></div>)}<p>{t('Daily equity bars only. News causality and sector/breadth conditions are not independently reverified. This is not a portfolio return or execution backtest. Archived sources are those available to the original thesis.','仅使用股票日线核对；新闻因果、板块和宽度条件尚未独立复核。这不是组合收益或成交回测，来源为原观点当时引用的资料。')}</p></details>
 </>}
 </section>;
}
