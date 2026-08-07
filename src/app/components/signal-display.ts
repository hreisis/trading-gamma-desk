import type { AiStudyBriefing, AiStudyInputProvenance } from "@/contracts/ai-study-briefing";
import type { RiskTrafficLight } from "@/desk/risk-lights";
import { RISK_LIGHT_BY_KIND } from "@/desk/risk-lights";

/** UI-only short labels for scan rows (not contract changes). */
export function riskLightScanLabel(light: RiskTrafficLight): string {
  switch (light.kind) {
    case "green":
      return "Supportive";
    case "yellow":
      return "Watch";
    case "red":
      return "High Risk";
    case "gray":
      return "—";
  }
}

export function gammaRegimeRiskLight(
  regime: "positive" | "negative" | "near_zero" | "unavailable",
): RiskTrafficLight {
  switch (regime) {
    case "positive":
      return RISK_LIGHT_BY_KIND.green;
    case "negative":
      return RISK_LIGHT_BY_KIND.red;
    case "near_zero":
      return RISK_LIGHT_BY_KIND.yellow;
    case "unavailable":
      return RISK_LIGHT_BY_KIND.gray;
  }
}

export function gammaRegimeScanLabel(
  regime: "positive" | "negative" | "near_zero" | "unavailable",
): string {
  switch (regime) {
    case "positive":
      return "Positive Gamma";
    case "negative":
      return "Negative Gamma";
    case "near_zero":
      return "Near Flip";
    case "unavailable":
      return "Unavailable";
  }
}

/** Upcoming catalyst scan light from existing importance field only. */
export function upcomingCatalystImportanceLight(
  importance: string,
): RiskTrafficLight {
  if (importance === "critical" || importance === "high") {
    return RISK_LIGHT_BY_KIND.red;
  }
  if (importance === "medium") {
    return RISK_LIGHT_BY_KIND.yellow;
  }
  return RISK_LIGHT_BY_KIND.gray;
}

export function upcomingCatalystScanLabel(importance: string): string {
  if (importance === "critical" || importance === "high") return "High Risk";
  return "Watch";
}

export function catalystStatusTimeLabel(status: string): string {
  if (status === "released" || status === "resolved") return "Released";
  if (status === "developing") return "Developing";
  return "";
}

const CATEGORY_SHORT: Readonly<Record<string, string>> = {
  inflation: "CPI",
  "monetary-policy": "FOMC",
  labor: "Payrolls",
  employment: "Payrolls",
  gdp: "GDP",
  earnings: "Earnings",
};

export function catalystShortTitle(category: string, headline: string): string {
  const mapped = CATEGORY_SHORT[category];
  if (mapped) return mapped;
  const first = headline.split(/[—–:-]/)[0]?.trim();
  if (first && first.length <= 24) return first;
  return formatCategoryShort(category);
}

function formatCategoryShort(category: string): string {
  const words = category.replace(/-/g, " ").split(/\s+/);
  if (words.length === 1) return words[0]!.toUpperCase();
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

export function assetShortSymbol(symbol: string): string {
  const map: Record<string, string> = {
    USD: "DXY",
    US10Y: "10Y",
    US2Y: "2Y",
    GOLD: "Gold",
    OIL: "Oil",
  };
  return map[symbol] ?? symbol;
}

export function deriveInputDisplayLight(
  input: AiStudyInputProvenance,
): RiskTrafficLight {
  if (input.status === "unavailable") return RISK_LIGHT_BY_KIND.gray;
  if (input.status === "partial" || input.freshness === "stale") {
    return RISK_LIGHT_BY_KIND.yellow;
  }
  if (input.freshness === "fixture" || input.status === "fixture") {
    return RISK_LIGHT_BY_KIND.yellow;
  }
  if (input.status === "available") return RISK_LIGHT_BY_KIND.green;
  return RISK_LIGHT_BY_KIND.gray;
}

const INPUT_SCAN_LABELS: Readonly<Record<AiStudyInputProvenance["id"], string>> =
  {
    macro: "Macro",
    catalysts: "Catalyst Risk",
    gamma_structure: "Gamma",
    market_quotes: "Market Trend",
  };

export function inputScanLabel(id: AiStudyInputProvenance["id"]): string {
  return INPUT_SCAN_LABELS[id];
}

export function deriveBriefingStance(briefing: AiStudyBriefing): {
  light: RiskTrafficLight;
  label: string;
} {
  if (
    briefing.status === "error" ||
    briefing.status === "unavailable" ||
    briefing.status === "session_conflict"
  ) {
    return { light: RISK_LIGHT_BY_KIND.gray, label: "UNAVAILABLE" };
  }
  if (briefing.status === "partial" || briefing.status === "synthetic_demo") {
    return { light: RISK_LIGHT_BY_KIND.yellow, label: "CAUTION" };
  }
  const hasGap = briefing.inputs.some(
    (i) =>
      i.status === "unavailable" ||
      i.status === "partial" ||
      i.freshness === "stale",
  );
  if (hasGap) {
    return { light: RISK_LIGHT_BY_KIND.yellow, label: "CAUTION" };
  }
  if (briefing.status === "ready") {
    return { light: RISK_LIGHT_BY_KIND.green, label: "CLEAR" };
  }
  return { light: RISK_LIGHT_BY_KIND.yellow, label: "CAUTION" };
}

/** First sentence / clause for glanceable headline — UI trim only. */
export function briefHeadline(text: string, maxLen = 140): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) return trimmed;
  const sentence = trimmed.match(/^[^.!?]+[.!?]?/)?.[0]?.trim() ?? trimmed;
  if (sentence.length <= maxLen) return sentence;
  return `${sentence.slice(0, maxLen - 1).trim()}…`;
}

export function driverStanceLabel(light: RiskTrafficLight): string {
  switch (light.kind) {
    case "green":
      return "SUPPORTIVE";
    case "yellow":
      return "CAUTION";
    case "red":
      return "WARNING";
    case "gray":
      return "UNAVAILABLE";
  }
}
