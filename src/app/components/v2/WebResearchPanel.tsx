import type { WebResearch } from '@/ai-study/web-research-contract';
import { researchSlot } from '@/ai-study/web-research-contract';
import type { V2Language } from '@/desk/v2-command-center';
import styles from './WebResearchPanel.module.css';
export function WebResearchPanel({research,lang}:{research:WebResearch|null;lang:V2Language}) {
 const t=(en:string,zh:string)=>lang==='zh'?zh:en;
 if(!research)return <section id="ai-study" className={styles.panel}><div className={styles.kicker}>AI STUDY · {t('MARKET RESEARCH','市场研究')}</div><h2>{t('Preparing the market view','正在准备市场研判')}</h2><p>{t('No published web research yet. This area will show the latest successful research, with sources and a publication time.','尚无已发布的联网研究。完成后这里会显示市场主线、后续催化剂及来源，并标明研究时间。')}</p></section>;
 const {content}=research;const stale=research.slot!==researchSlot(new Date());
 const titles={drivers:t('MARKET DRIVERS','市场主线'),watch:t('WHAT TO WATCH','接下来关注'),invalidation:t('WHAT CHANGES THE VIEW','什么会改变判断')};
 return <section id="ai-study" className={styles.panel}>
  <div className={styles.kicker}>AI STUDY · {t('WEB RESEARCH','联网研究')}</div>
  <div className={styles.date}>{research.generatedAt.slice(0,16).replace('T',' ')} UTC{stale?` · ${t('Previous edition','上一版研究')}`:''}</div>
  <h2>{content.headline[lang]}</h2><p className={styles.summary}>{content.summary[lang]}</p>
  <a className={styles.jump} href="#study-drivers">{t('Evidence & sources ↓','查看依据与来源 ↓')}</a>
  {content.sections.map((section,i)=><section className={styles.section} id={`study-${section.kind}`} key={section.kind}>
   <div className={styles.kicker}>{String(i+1).padStart(2,'0')} · {titles[section.kind]}</div><h3>{section.title[lang]}</h3><p>{section.body[lang]}</p>
   {section.kind==='watch' && research.event && <p className={styles.event}><b>{research.event.headline}</b> · {research.event.et}<br/><a href={research.event.sourceUrl} target="_blank" rel="noopener noreferrer">{t('Official calendar ↗','官方日历 ↗')}</a></p>}
   <div className={styles.sources}>{section.sources.map(source=><a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer">{source.title} ↗{source.publishedAt&&<small> · {source.publishedAt}</small>}</a>)}</div>
  </section>)}
  <details className={styles.limits}><summary>{t('Research context','研究口径')}</summary><p>{content.limitations[lang]}</p><p>{t('Daily data session','日频数据日期')}: {research.inputSession??'—'}</p></details>
 </section>;
}
