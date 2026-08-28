import { describe, expect, it } from "vitest";
import { interpretV2Policy } from "@/desk/v2-policy-interpretation";

describe("interpretV2Policy", () => {
  it("fills Chinese templates from live scores without hardcoding a session", () => {
    const lines = interpretV2Policy(
      {
        riskScore: 59,
        opportunityScore: 68,
        trend: "deteriorating",
        positioning: "TRIM / DEFENSIVE",
      },
      "zh",
    );
    expect(lines).toEqual([
      "风险 59：风险中等偏高，不能当作低风险环境。",
      "机会 68：当前存在一定战术性机会，但不是安全买点。",
      "趋势：恶化。风险结构正在继续变差。",
      "仓位建议：减仓 / 防守。当前更适合降低风险敞口，而不是因为机会分数较高就加仓。",
    ]);
  });

  it("uses a different risk band when the score is low", () => {
    const lines = interpretV2Policy(
      {
        riskScore: 35,
        opportunityScore: 40,
        trend: "stable",
        positioning: "HOLD / WAIT",
      },
      "en",
    );
    expect(lines[0]).toContain("Risk 35");
    expect(lines[0]?.toLowerCase()).toContain("low");
  });
});
