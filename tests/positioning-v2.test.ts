import { describe, expect, it } from "vitest";
import { derivePositioningV2 } from "@/desk/positioning-v2";

describe("derivePositioningV2", () => {
  it("maps low risk by opportunity band", () => {
    expect(
      derivePositioningV2({ riskScore: 38, opportunityScore: 70, trend: "stable" }),
    ).toBe("ADD");
    expect(
      derivePositioningV2({ riskScore: 40, opportunityScore: 45, trend: "stable" }),
    ).toBe("SELECTIVE ADD");
    expect(
      derivePositioningV2({ riskScore: 35, opportunityScore: 39, trend: "improving" }),
    ).toBe("HOLD / WAIT");
  });

  it("maps mid risk with trend first, then tactical add", () => {
    expect(
      derivePositioningV2({
        riskScore: 62,
        opportunityScore: 69,
        trend: "deteriorating",
      }),
    ).toBe("TRIM / DEFENSIVE");
    expect(
      derivePositioningV2({
        riskScore: 50,
        opportunityScore: 70,
        trend: "improving",
      }),
    ).toBe("TACTICAL ADD");
    expect(
      derivePositioningV2({ riskScore: 50, opportunityScore: 70, trend: "stable" }),
    ).toBe("HOLD");
  });

  it("maps high risk to reduce, with a rebound overlay when opportunity is high", () => {
    expect(
      derivePositioningV2({ riskScore: 68, opportunityScore: 96, trend: "deteriorating" }),
    ).toBe("REDUCE CORE / TACTICAL REBOUND");
    expect(
      derivePositioningV2({ riskScore: 66, opportunityScore: 40, trend: "stable" }),
    ).toBe("REDUCE");
  });

  it("waits when risk or opportunity is missing", () => {
    expect(
      derivePositioningV2({ riskScore: null, opportunityScore: 69, trend: "stable" }),
    ).toBe("HOLD / WAIT");
  });
});
