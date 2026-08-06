"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition, type ReactNode } from "react";
import { RiskTrafficLight } from "../RiskTrafficLight";
import { RISK_LIGHT_BY_KIND } from "@/desk/risk-lights";
import type { DeskPanelId, DeskSidebarSignals } from "./desk-panel-types";
import { parseDeskPanelId } from "./desk-panel-types";

type SidebarEntry = {
  readonly id: DeskPanelId;
  readonly title: string;
  readonly signal: DeskSidebarSignals[keyof DeskSidebarSignals];
};

function SidebarButton({
  entry,
  active,
  onSelect,
}: {
  entry: SidebarEntry;
  active: boolean;
  onSelect: (id: DeskPanelId) => void;
}) {
  const light = RISK_LIGHT_BY_KIND[entry.signal.kind];
  return (
    <button
      type="button"
      className={`desk-sidebar-item${active ? " is-active" : ""}`}
      onClick={() => onSelect(entry.id)}
      aria-current={active ? "page" : undefined}
      data-testid={`desk-panel-nav-${entry.id}`}
    >
      <span className="desk-sidebar-item-title">{entry.title}</span>
      <span className="desk-sidebar-item-signal">
        <RiskTrafficLight light={light} compact testId={`sidebar-light-${entry.id}`} />
        <span className="desk-sidebar-item-status">{entry.signal.statusShort}</span>
      </span>
    </button>
  );
}

export function DeskWorkspace({
  signals,
  gamma,
  panels,
  initialPanel,
  demoMode,
}: {
  signals: DeskSidebarSignals;
  gamma: ReactNode;
  panels: Record<DeskPanelId, ReactNode>;
  initialPanel?: DeskPanelId | null;
  demoMode?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const activePanel =
    parseDeskPanelId(searchParams.get("panel")) ?? initialPanel ?? null;

  const selectPanel = useCallback(
    (id: DeskPanelId) => {
      const next = activePanel === id ? null : id;
      const params = new URLSearchParams(searchParams.toString());
      if (next) params.set("panel", next);
      else params.delete("panel");
      const base = demoMode ? "/demo" : "/";
      const qs = params.toString();
      startTransition(() => {
        router.push(qs ? `${base}?${qs}` : base, { scroll: false });
      });
    },
    [activePanel, demoMode, router, searchParams],
  );

  const today: SidebarEntry[] = [
    { id: "market", title: "Market", signal: signals.market },
    { id: "macro", title: "Macro", signal: signals.macro },
    { id: "catalysts", title: "Catalysts", signal: signals.catalysts },
    { id: "cross-asset", title: "Cross Asset", signal: signals.crossAsset },
  ];
  const research: SidebarEntry[] = [
    { id: "ai-study", title: "AI Study", signal: signals.aiStudy },
  ];
  const system: SidebarEntry[] = [
    { id: "data-status", title: "Data Status", signal: signals.dataStatus },
  ];

  return (
    <div className="desk-workspace" data-testid="desk-workspace">
      <aside className="desk-sidebar" aria-label="Desk navigation">
        <p className="desk-sidebar-group">Today</p>
        {today.map((entry) => (
          <SidebarButton
            key={entry.id}
            entry={entry}
            active={activePanel === entry.id}
            onSelect={selectPanel}
          />
        ))}
        <p className="desk-sidebar-group">Research</p>
        {research.map((entry) => (
          <SidebarButton
            key={entry.id}
            entry={entry}
            active={activePanel === entry.id}
            onSelect={selectPanel}
          />
        ))}
        <p className="desk-sidebar-group">System</p>
        {system.map((entry) => (
          <SidebarButton
            key={entry.id}
            entry={entry}
            active={activePanel === entry.id}
            onSelect={selectPanel}
          />
        ))}
      </aside>

      <div className="desk-workspace-main">
        <section className="desk-gamma-zone" aria-label="Gamma structure">
          {gamma}
        </section>
        {activePanel ? (
          <section
            className="desk-panel-zone"
            data-testid={`desk-panel-${activePanel}`}
            aria-label={activePanel}
          >
            {panels[activePanel]}
          </section>
        ) : null}
      </div>
    </div>
  );
}
