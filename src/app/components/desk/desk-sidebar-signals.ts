import type { AiStudyBriefing } from "@/contracts/ai-study-briefing";
import type { AlpacaMarketPanel } from "@/contracts/alpaca-market";
import type { CatalystFeed } from "@/contracts";
import type { DominantDriver } from "@/contracts";
import type { BoundedGammaDeskView, MacroDeskView } from "@/desk";
import {
  deriveAssetRiskLight,
  deriveCatalystRiskLight,
  deriveDriverRiskLight,
} from "@/desk/risk-lights";
import type { RiskLightKind } from "@/desk/risk-lights";
import { deriveBriefingStance } from "../signal-display";
import type { DeskSidebarSignals, SidebarItemSignal } from "./desk-panel-types";

function signal(kind: RiskLightKind, statusShort: string): SidebarItemSignal {
  return { kind, statusShort };
}

function worstKind(kinds: readonly RiskLightKind[]): RiskLightKind {
  const rank: Record<RiskLightKind, number> = {
    red: 0,
    yellow: 1,
    gray: 2,
    green: 3,
  };
  return kinds.reduce(
    (worst, k) => (rank[k] < rank[worst] ? k : worst),
    "green" as RiskLightKind,
  );
}

export function deriveMarketSidebarSignal(
  panel: AlpacaMarketPanel | null | undefined,
): SidebarItemSignal {
  if (!panel) return signal("gray", "No data");
  if (panel.status === "ready" || panel.status === "synthetic_demo") {
    return signal("green", "Quotes live");
  }
  if (panel.status === "partial") return signal("yellow", "Partial");
  if (panel.status === "not_configured") return signal("gray", "Not configured");
  return signal("red", "Unavailable");
}

export function deriveMacroSidebarSignal(
  driver: DominantDriver | null | undefined,
): SidebarItemSignal {
  if (!driver) return signal("gray", "No driver");
  const light = deriveDriverRiskLight({
    primaryRegime: driver.primaryRegime,
    riskDirection: driver.riskDirection,
    confidenceScore: driver.confidence.score,
    zeroedBy: driver.confidence.zeroedBy,
  });
  const short =
    driver.label.length > 22 ? `${driver.label.slice(0, 21)}…` : driver.label;
  return signal(light.kind, short);
}

export function deriveCatalystsSidebarSignal(
  feed: CatalystFeed | null | undefined,
): SidebarItemSignal {
  if (!feed || feed.catalysts.length === 0) {
    return signal("gray", "No events");
  }
  const kinds: RiskLightKind[] = feed.catalysts.map((catalyst) => {
    if (catalyst.status === "upcoming") {
      if (catalyst.importance === "critical" || catalyst.importance === "high") {
        return "red";
      }
      if (catalyst.importance === "medium") return "yellow";
      return "gray";
    }
    return deriveCatalystRiskLight({
      status: catalyst.status,
      equityBreadth: null,
      equityLeadershipStatus: null,
    }).kind;
  });
  const kind = worstKind(kinds);
  const upcoming = feed.catalysts.filter((c) => c.status === "upcoming").length;
  if (kind === "red") return signal("red", "High risk");
  if (kind === "yellow") return signal("yellow", `${upcoming} watch`);
  return signal("green", `${feed.catalysts.length} tracked`);
}

export function deriveCrossAssetSidebarSignal(
  driver: DominantDriver | null | undefined,
): SidebarItemSignal {
  if (!driver || driver.assets.length === 0) {
    return signal("gray", "No assets");
  }
  const kinds = driver.assets.map((asset) =>
    deriveAssetRiskLight({
      symbol: asset.symbol,
      zScore: asset.zScore,
      role: asset.role,
      staleDays: asset.staleDays,
    }).kind,
  );
  const kind = worstKind(kinds);
  const contra = driver.assets.filter((a) => a.role === "contradicting").length;
  if (kind === "red") return signal("red", `${contra} contra`);
  if (kind === "yellow") return signal("yellow", "Mixed");
  return signal("green", "Aligned");
}

export function deriveAiStudySidebarSignal(
  briefing: AiStudyBriefing | null | undefined,
): SidebarItemSignal {
  if (!briefing) return signal("gray", "No brief");
  const stance = deriveBriefingStance(briefing);
  return signal(stance.light.kind, stance.label);
}

export function deriveDataStatusSidebarSignal(input: {
  view: MacroDeskView;
  gammaPanels: readonly BoundedGammaDeskView[];
  catalystFeed: CatalystFeed | null | undefined;
  marketPanel: AlpacaMarketPanel | null | undefined;
  briefing: AiStudyBriefing | null | undefined;
}): SidebarItemSignal {
  const issues: RiskLightKind[] = [];
  if (input.view.error || input.view.status === "pipeline_error") {
    issues.push("red");
  }
  if (input.view.sessionStale) issues.push("yellow");
  if (input.gammaPanels.some((p) => p.status !== "ready")) {
    issues.push("yellow");
  }
  if (input.catalystFeed?.source.partialFailure) issues.push("yellow");
  if (input.marketPanel?.status === "error") issues.push("red");
  if (input.briefing?.status === "error") issues.push("red");
  if (issues.length === 0) return signal("green", "All OK");
  return signal(worstKind(issues), "Review");
}

export function buildDeskSidebarSignals(input: {
  view: MacroDeskView;
  driver: DominantDriver | null;
  catalystFeed: CatalystFeed | null | undefined;
  gammaPanels: readonly BoundedGammaDeskView[];
  marketPanel: AlpacaMarketPanel | null | undefined;
  briefing: AiStudyBriefing | null | undefined;
}): DeskSidebarSignals {
  return {
    market: deriveMarketSidebarSignal(input.marketPanel),
    macro: deriveMacroSidebarSignal(input.driver),
    catalysts: deriveCatalystsSidebarSignal(input.catalystFeed),
    crossAsset: deriveCrossAssetSidebarSignal(input.driver),
    aiStudy: deriveAiStudySidebarSignal(input.briefing),
    dataStatus: deriveDataStatusSidebarSignal(input),
  };
}
