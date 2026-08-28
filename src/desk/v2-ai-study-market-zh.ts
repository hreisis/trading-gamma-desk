/**
 * Display-only Chinese for the five /market AI Study qualitative sections.
 * Does not change prompts, schema, scoring, or fallback generation.
 */
import type { V2AiStudyInterpretation, V2Language } from "@/desk/v2-command-center";

export type MarketAiStudyQualitative = Pick<
  V2AiStudyInterpretation,
  | "hiddenRisk"
  | "reactionQuality"
  | "crossAssetConflict"
  | "whatChanged"
  | "whatMattersNext"
>;

export function localizeMarketAiStudySections(
  study: MarketAiStudyQualitative,
  lang: V2Language,
): MarketAiStudyQualitative {
  if (lang !== "zh") return study;
  return {
    hiddenRisk: translateMarketAiStudyBody(study.hiddenRisk),
    reactionQuality: translateMarketAiStudyBody(study.reactionQuality),
    crossAssetConflict: translateMarketAiStudyBody(study.crossAssetConflict),
    whatChanged: translateMarketAiStudyBody(study.whatChanged),
    whatMattersNext: translateMarketAiStudyBody(study.whatMattersNext),
  };
}

export function translateMarketAiStudyBody(text: string): string {
  let out = text;

  const exact: Record<string, string> = {
    "No off-model hidden risk is flagged in connected inputs.":
      "已接入输入未标出模型外的隐性风险。",
    "Reaction quality cannot be judged from connected inputs.":
      "已接入输入不足以判断市场反应质量。",
    "No cross-asset conflict is flagged in connected inputs.":
      "已接入输入未标出跨资产冲突。",
    "No session-to-session change evidence is in connected inputs.":
      "已接入输入没有交易日对比变化证据。",
    "No next observable is specified in connected inputs.":
      "已接入输入未给出下一步可观察条件。",
    "SPY gamma snapshot is incomplete, so wall/flip context may be understated in the score.":
      "SPY gamma 快照不完整，墙位/flip 结构在分数中可能被低估。",
    "SPY gamma is marked stale in connected inputs.":
      "已接入输入中 SPY gamma 被标记为过期。",
    "SPY breadth is stale, so participation may not match the scored session.":
      "SPY 广度数据过期，参与度可能与计分交易日不一致。",
    "Vol underpriced vs incomplete gamma snapshot.":
      "波动率偏低，但 gamma 快照不完整。",
    "Mixed macro risk vs sector leadership.":
      "宏观风险方向混杂，对比板块领导。",
  };
  const exactHit = exact[out];
  if (exactHit) return exactHit;
  for (const [en, zh] of Object.entries(exact)) {
    out = out.replaceAll(en, zh);
  }

  out = out.replace(
    /Event gate (\S+)( \(stale\))?: (.+) is in connected inputs, not a scored tape reaction\./g,
    (_m, state: string, stale: string | undefined, headline: string) =>
      `事件门控 ${state}${stale ? "（过期）" : ""}：${headline} 来自已接入输入，不是计入分数的盘面反应。`,
  );
  out = out.replace(
    /Event gate (\S+)( \(stale\))? is open in connected inputs\./g,
    (_m, state: string, stale: string | undefined) =>
      `事件门控 ${state}${stale ? "（过期）" : ""} 在已接入输入中处于开启状态。`,
  );
  out = out.replace(
    /SPY breadth is stale dated (\d{4}-\d{2}-\d{2}), so participation may not match the scored session\./g,
    "SPY 广度数据过期（$1），参与度可能与计分交易日不一致。",
  );
  out = out.replace(
    /Spot is below gamma flip ([0-9.]+) — amplification is a structure fact the headline score may compress\./g,
    "现价低于 gamma flip $1 — 放大是结构事实，头条分数可能把它压低。",
  );
  out = out.replace(/Missing inputs:/g, "缺失输入：");
  out = out.replace(
    /Breadth: Nasdaq \/ high-beta \/ semis/g,
    "广度：Nasdaq / 高贝塔 / 半导体",
  );
  out = out.replace(
    /VIX term structure and positioning/g,
    "VIX 期限结构与持仓",
  );
  out = out.replace(/Credit stress/g, "信用压力");
  out = out.replace(
    /Relative leadership \/ inferred rotation/g,
    "相对领导 / 推断轮动",
  );

  out = out.replace(/ \(dated breadth\)/g, "（广度数据过期）");
  out = out.replace(/ vs SPY breadth /g, " 对比 SPY 广度 ");
  out = out.replace(/CTA proxy /g, "CTA 代理 ");
  out = out.replace(/Sector leadership is narrow: /g, "板块领导面偏窄：");
  out = out.replace(/ weakening on 5D RS\./g, " 在 5 日相对强度上走弱。");
  out = out.replace(
    /Stabilizing \/ mean-reverting dealer flow/g,
    "稳定 / 均值回归做市商流向",
  );
  out = out.replace(
    /Amplifying \/ trend-following dealer flow/g,
    "放大 / 趋势跟随做市商流向",
  );
  out = out.replace(
    /Transition · dealer hedging near neutral/g,
    "过渡 · 做市商对冲接近中性",
  );

  out = out.replace(/SPY gamma regime /g, "SPY gamma 状态 ");
  out = out.replace(/SPY dealer flow /g, "SPY 做市商流向 ");
  out = out.replace(/ vs QQQ /g, " 对比 QQQ ");
  out = out.replace(/Gamma regime divergence: /g, "Gamma 状态分歧：");
  out = out.replace(/Breadth divergence: /g, "广度分歧：");
  out = out.replace(
    /QQQ−SPY structural risk divergence /g,
    "QQQ−SPY 结构风险分歧 ",
  );
  out = out.replace(/QQQ vs SPY 1D /g, "QQQ 相对 SPY 1 日 ");
  out = out.replace(/ · QQQ unavailable/g, " · QQQ 不可用");
  out = out.replace(/ · SPY unavailable/g, " · SPY 不可用");
  out = out.replace(/SPY unavailable · /g, "SPY 不可用 · ");
  out = out.replace(/QQQ unavailable · /g, "QQQ 不可用 · ");

  out = out.replace(
    / — credit risk appetite deteriorating \(not in the numeric risk score\)\./g,
    " — 信用风险偏好正在恶化（未计入风险分数）。",
  );
  out = out.replace(
    / — credit risk appetite deteriorating\./g,
    " — 信用风险偏好正在恶化。",
  );
  out = out.replace(
    / — equity stress not yet confirmed by credit\./g,
    " — 股市压力尚未被信用确认。",
  );
  out = out.replace(/ — HYG\/LQD improving\./g, " — HYG/LQD 改善。");
  out = out.replace(/ — HYG\/LQD stable\./g, " — HYG/LQD 稳定。");
  out = out.replace(/HYG\/LQD ratio /g, "HYG/LQD 比值 ");
  out = out.replace(/ vs SPY 1D /g, " 对比 SPY 1 日 ");
  out = out.replace(/Risk change /g, "风险变化 ");
  out = out.replace(/ vs previous session score /g, "，对比前一交易日分数 ");
  out = out.replace(/Factor moves: /g, "因子变化：");
  out = out.replace(/Risk eased:/g, "风险回落：");
  out = out.replace(/Risk rose:/g, "风险上升：");
  out = out.replace(/Risk unchanged:/g, "风险不变：");

  out = out.replace(
    /If SPY spot crosses from above gamma flip ([0-9.]+) to below → amplification \/ vol expansion risk (may|can) rise/g,
    "若 SPY 现价从 gamma flip $1 上方跌破并站上下方 → 放大 / 波动扩张风险可能上升",
  );
  out = out.replace(
    /If SPY spot reclaims and holds above gamma flip ([0-9.]+) → stabilizing \/ mean-reverting regime (may|can) resume/g,
    "若 SPY 现价重新站稳 gamma flip $1 上方 → 稳定 / 均值回归状态可能恢复",
  );
  out = out.replace(
    /If SPY reclaims and holds above put wall ([0-9.]+) → downside flush risk (may|can) ease/g,
    "若 SPY 重新站稳 put wall $1 上方 → 下行冲洗风险可能缓和",
  );
  out = out.replace(
    /If SPY breaks and holds below put wall ([0-9.]+) → downside instability \/ support removal (may|can) increase/g,
    "若 SPY 跌破并站稳 put wall $1 下方 → 下行不稳 / 支撑失效风险可能上升",
  );
  out = out.replace(
    /If SPY breaks and holds above call wall ([0-9.]+) → upside chase \/ hedge pressure (may|can) rise/g,
    "若 SPY 突破并站稳 call wall $1 上方 → 上行追涨 / 对冲压力可能上升",
  );
  out = out.replace(
    /If SPY fails to hold above call wall ([0-9.]+) → upside chase pressure (may|can) ease toward the flip band/g,
    "若 SPY 无法站稳 call wall $1 上方 → 上行追涨压力可能向 flip 区间回落",
  );
  out = out.replace(
    /If breadth improves from ([A-Za-z]+) to Strong → participation (may|can) broaden/g,
    "若广度从 $1 改善到 Strong → 参与度可能变宽",
  );
  out = out.replace(
    /If breadth weakens from ([A-Za-z]+) to Weak → narrow participation (may|can) persist/g,
    "若广度从 $1 弱化到 Weak → 窄幅参与可能持续",
  );
  out = out.replace(
    /If breadth improves from ([A-Za-z]+) to Mixed or Strong → participation (may|can) broaden/g,
    "若广度从 $1 改善到 Mixed 或 Strong → 参与度可能变宽",
  );
  out = out.replace(
    /If breadth weakens from ([A-Za-z]+) to Mixed or Weak → participation (may|can) narrow/g,
    "若广度从 $1 弱化到 Mixed 或 Weak → 参与度可能变窄",
  );
  out = out.replace(
    /If (.+) shifts risk tone → macro mix (may|can) change/g,
    "若 $1 改变风险基调 → 宏观组合可能变化",
  );
  out = out.replace(
    /If (.+) RS fades from ([+\-0-9.]+%) → cyclical leadership may narrow/g,
    "若 $1 相对强度从 $2 消退 → 周期领导面可能收窄",
  );

  out = out.replace(/\bBuying\b/g, "买入");
  out = out.replace(/\bSelling\b/g, "卖出");
  out = out.replace(/\bNeutral\b/g, "中性");
  out = out.replace(/\bStrong\b/g, "强");
  out = out.replace(/\bMixed\b/g, "混杂");
  out = out.replace(/\bWeak\b/g, "弱");
  out = out.replace(/\bnegative\b/g, "负");
  out = out.replace(/\bpositive\b/g, "正");
  out = out.replace(/\bnear_zero\b/g, "近零");
  out = out.replace(/\bnear zero\b/g, "近零");

  return out;
}
