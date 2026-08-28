import { describe, expect, it } from "vitest";
import {
  localizeMarketAiStudySections,
  translateMarketAiStudyBody,
} from "@/desk/v2-ai-study-market-zh";

describe("localizeMarketAiStudySections", () => {
  const english = {
    hiddenRisk:
      "SPY gamma snapshot is incomplete, so wall/flip context may be understated in the score. Missing inputs: Breadth: Nasdaq / high-beta / semis; VIX term structure and positioning.",
    reactionQuality: "Reaction quality cannot be judged from connected inputs.",
    crossAssetConflict: "Gamma regime divergence: SPY negative · QQQ unavailable.",
    whatChanged: "No session-to-session change evidence is in connected inputs.",
    whatMattersNext:
      "If SPY spot reclaims and holds above gamma flip 745.9 → stabilizing / mean-reverting regime may resume. If SPY reclaims and holds above put wall 743 → downside flush risk may ease",
  };

  it("leaves English unchanged", () => {
    expect(localizeMarketAiStudySections(english, "en")).toEqual(english);
  });

  it("translates titles-paired fallback bodies in 中文 mode without dropping levels", () => {
    const zh = localizeMarketAiStudySections(english, "zh");
    expect(zh.hiddenRisk).toContain("SPY gamma 快照不完整");
    expect(zh.hiddenRisk).toContain("缺失输入：");
    expect(zh.hiddenRisk).toContain("Nasdaq");
    expect(zh.reactionQuality).toBe("已接入输入不足以判断市场反应质量。");
    expect(zh.crossAssetConflict).toContain("Gamma 状态分歧");
    expect(zh.crossAssetConflict).toContain("QQQ 不可用");
    expect(zh.whatChanged).toBe("已接入输入没有交易日对比变化证据。");
    expect(zh.whatMattersNext).toContain("gamma flip 745.9");
    expect(zh.whatMattersNext).toContain("put wall 743");
    expect(zh.whatMattersNext).toContain("若 SPY 现价重新站稳");
  });

  it("preserves numbers in risk-change fallback", () => {
    expect(
      translateMarketAiStudyBody(
        "Risk change +6 vs previous session score 49 (2026-08-21) — Risk rose: breadth worsened.",
      ),
    ).toContain("风险变化 +6");
    expect(
      translateMarketAiStudyBody(
        "Risk change +6 vs previous session score 49 (2026-08-21) — Risk rose: breadth worsened.",
      ),
    ).toContain("49");
    expect(
      translateMarketAiStudyBody(
        "Risk change +6 vs previous session score 49 (2026-08-21) — Risk rose: breadth worsened.",
      ),
    ).toContain("2026-08-21");
  });
});
