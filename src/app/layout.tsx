import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { SITE_DESCRIPTION, SITE_TITLE } from "@/desk/public-demo";
import { RiskGaugeEnhancer } from "@/app/components/v2/RiskGaugeEnhancer";
import "./globals.css";
import "./preview-overrides.css";

const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-sans",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    type: "website",
  },
};

const previewLanguageScript = `
(() => {
  const apply = () => {
    const params = new URLSearchParams(window.location.search);
    const lang = params.get('lang') === 'zh' ? 'zh' : 'en';
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    document.documentElement.dataset.previewLang = lang;

    const settings = document.querySelector('.pv-settings');
    if (settings) {
      const base = window.location.pathname || '/';
      const makeHref = (nextLang) => {
        const next = new URLSearchParams(window.location.search);
        next.set('lang', nextLang);
        return base + '?' + next.toString();
      };
      settings.outerHTML = '<div class="pv-language-switch" aria-label="Language"><a class="' + (lang === 'en' ? 'active' : '') + '" href="' + makeHref('en') + '">EN</a><span>|</span><a class="' + (lang === 'zh' ? 'active' : '') + '" href="' + makeHref('zh') + '">中文</a></div>';
    }

    if (lang !== 'zh') return;

    const exact = new Map([
      ['Overview', '总览'],
      ['Market Structure', '市场结构'],
      ['Flow / Participation', '流向 / 参与度'],
      ['Rotation', '板块轮动'],
      ['AI Study', 'AI 研究'],
      ['Daily Review', '每日复盘'],
      ['OVERVIEW', '总览'],
      ['MARKET STANCE', '市场立场'],
      ['SENTIMENT / RISK', '情绪 / 风险'],
      ['RISK SNAPSHOT', '风险快照'],
      ['RECOMMENDED EXPOSURE', '建议仓位'],
      ['KEY DRIVERS', '关键驱动'],
      ['MARKET STRUCTURE', '市场结构'],
      ['FLOW / PARTICIPATION', '流向 / 参与度'],
      ['SECTOR ROTATION', '板块轮动'],
      ['TECHNOLOGY INTERNAL', '科技内部强弱'],
      ['TECH LEADERS & LAGGARDS', '科技领涨 / 落后'],
      ['AI STUDY / INSIGHTS', 'AI 研究 / 洞察'],
      ['AI VIEW', 'AI 观点'],
      ['KEY LEVELS TO WATCH', '关键价位'],
      ['BULL CASE', '多头情景'],
      ['BEAR CASE', '空头情景'],
      ['CONFIDENCE', '置信度'],
      ['DAILY REVIEW', '每日复盘'],
      ['Morning stance', '早盘立场'],
      ['Actual outcome', '实际结果'],
      ['What worked', '有效部分'],
      ['Tomorrow watch', '明日关注'],
      ['Market Open', '市场开盘'],
      ['QQQ vs SPY Spread', 'QQQ vs SPY 风险差'],
      ['of max risk', '最大风险仓位'],
      ['Confidence', '置信度'],
      ['Participation:', '参与度：'],
      ['Tech Strength:', '科技强度：'],
      ['Top 5 Leaders', '前 5 领涨'],
      ['Top 5 Laggards', '前 5 落后'],
      ['HOLD', '持有'],
      ['BUY', '买入'],
      ['REDUCE', '减仓'],
      ['Neutral / Moderate', '中性 / 中等'],
      ['Low / Supportive', '低 / 支撑'],
      ['Elevated / Defensive', '偏高 / 防御'],
      ['Scheduled Risk', '预定风险'],
      ['Active Shock', '事件冲击中'],
      ['Supportive', '支撑'],
      ['Expanding', '扩张'],
      ['Outperforming', '跑赢'],
      ['Underperforming', '跑输'],
      ['Pending', '待生成'],
      ['Unavailable', '不可用'],
    ]);

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const raw = node.nodeValue || '';
      const trimmed = raw.trim();
      if (!trimmed) continue;
      if (exact.has(trimmed)) {
        node.nodeValue = raw.replace(trimmed, exact.get(trimmed));
      }
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply, { once: true });
  } else {
    apply();
  }
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${mono.variable}`}
      style={{ background: "#fff" }}
      suppressHydrationWarning
    >
      <body style={{ background: "#fff" }}>
        {children}
        <RiskGaugeEnhancer />
        <script dangerouslySetInnerHTML={{ __html: previewLanguageScript }} />
      </body>
    </html>
  );
}
