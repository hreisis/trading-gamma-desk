import type { RiskLightKind } from "@/desk/risk-lights";

export type DeskPanelId =
  | "market"
  | "macro"
  | "catalysts"
  | "cross-asset"
  | "ai-study"
  | "data-status";

export type SidebarItemSignal = {
  readonly kind: RiskLightKind;
  readonly statusShort: string;
};

export type DeskSidebarSignals = {
  readonly market: SidebarItemSignal;
  readonly macro: SidebarItemSignal;
  readonly catalysts: SidebarItemSignal;
  readonly crossAsset: SidebarItemSignal;
  readonly aiStudy: SidebarItemSignal;
  readonly dataStatus: SidebarItemSignal;
};

export function parseDeskPanelId(value: string | null | undefined): DeskPanelId | null {
  if (
    value === "market" ||
    value === "macro" ||
    value === "catalysts" ||
    value === "cross-asset" ||
    value === "ai-study" ||
    value === "data-status"
  ) {
    return value;
  }
  return null;
}
