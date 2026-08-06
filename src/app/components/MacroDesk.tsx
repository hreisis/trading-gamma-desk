import { Suspense } from "react";
import type { AiStudyBriefing } from "@/contracts/ai-study-briefing";
import type { AlpacaMarketPanel } from "@/contracts/alpaca-market";
import type { CatalystFeed as CatalystFeedDto } from "@/contracts";
import type { BoundedGammaDeskView, MacroDeskView } from "@/desk";
import { DeskChrome } from "./DeskChrome";
import { DeskStatusBanners } from "./DeskStatusBanners";
import { DeskWorkspace } from "./desk/DeskWorkspace";
import type { DeskPanelId } from "./desk/desk-panel-types";
import { buildDeskSidebarSignals } from "./desk/desk-sidebar-signals";
import { AiStudyWorkspacePanel } from "./desk/panels/AiStudyWorkspacePanel";
import { CatalystsWorkspacePanel } from "./desk/panels/CatalystsWorkspacePanel";
import { CrossAssetWorkspacePanel } from "./desk/panels/CrossAssetWorkspacePanel";
import { DataStatusWorkspacePanel } from "./desk/panels/DataStatusWorkspacePanel";
import { MacroWorkspacePanel } from "./desk/panels/MacroWorkspacePanel";
import { MarketWorkspacePanel } from "./desk/panels/MarketWorkspacePanel";
import { GammaDesk } from "./gamma/GammaDesk";

function WorkspaceFallback() {
  return (
    <div className="desk-workspace desk-workspace-loading" data-testid="desk-workspace-loading">
      <div className="desk-skeleton desk-skeleton-title" />
      <div className="desk-skeleton desk-skeleton-line" />
    </div>
  );
}

function UnavailablePanel({ title }: { title: string }) {
  return (
    <div className="workspace-panel">
      <h2 className="workspace-panel-title">{title}</h2>
      <p className="desk-section-note">Unavailable for this session.</p>
    </div>
  );
}

function GammaRow({ panels }: { panels: readonly BoundedGammaDeskView[] }) {
  if (panels.length === 0) {
    return (
      <p className="desk-section-note" data-testid="gamma-missing">
        No bounded gamma snapshots loaded.
      </p>
    );
  }
  return (
    <div className="desk-gamma-grid" data-testid="desk-gamma-grid">
      {panels.map((panel) => (
        <GammaDesk
          key={panel.snapshot?.symbol ?? panel.sourceLabel}
          view={panel}
          compact
        />
      ))}
    </div>
  );
}

function MacroDeskWorkspace({
  view,
  catalystFeed,
  gammaPanels,
  marketPanel,
  aiBriefing,
  initialPanel,
  demoMode,
}: {
  view: MacroDeskView;
  catalystFeed?: CatalystFeedDto | null;
  gammaPanels: readonly BoundedGammaDeskView[];
  marketPanel?: AlpacaMarketPanel | null;
  aiBriefing?: AiStudyBriefing | null;
  initialPanel?: DeskPanelId | null;
  demoMode?: boolean;
}) {
  const driver = view.driver;
  const signals = buildDeskSidebarSignals({
    view,
    driver,
    catalystFeed,
    gammaPanels,
    marketPanel,
    briefing: aiBriefing,
  });

  return (
    <DeskWorkspace
      demoMode={demoMode}
      signals={signals}
      initialPanel={initialPanel}
      gamma={<GammaRow panels={gammaPanels} />}
      panels={{
        market: marketPanel ? (
          <MarketWorkspacePanel panel={marketPanel} />
        ) : (
          <UnavailablePanel title="Market" />
        ),
        macro: driver ? (
          <MacroWorkspacePanel
            driver={driver}
            sourceLabel={view.sourceLabel ?? "unknown"}
            isPublicDemo={view.isPublicDemo}
          />
        ) : (
          <UnavailablePanel title="Macro" />
        ),
        catalysts: catalystFeed ? (
          <CatalystsWorkspacePanel
            feed={catalystFeed}
            suppressDemoChrome={view.isPublicDemo}
          />
        ) : (
          <UnavailablePanel title="Catalysts" />
        ),
        "cross-asset": driver ? (
          <CrossAssetWorkspacePanel driver={driver} />
        ) : (
          <UnavailablePanel title="Cross Asset" />
        ),
        "ai-study": aiBriefing ? (
          <AiStudyWorkspacePanel briefing={aiBriefing} />
        ) : (
          <UnavailablePanel title="AI Study" />
        ),
        "data-status": (
          <DataStatusWorkspacePanel
            view={view}
            gammaPanels={gammaPanels}
            catalystFeed={catalystFeed}
            marketPanel={marketPanel}
            briefing={aiBriefing}
          />
        ),
      }}
    />
  );
}

export function MacroDesk({
  view,
  catalystFeed,
  gammaView,
  gammaViews,
  demoMode,
  marketPanel,
  aiBriefing,
  initialPanel,
}: {
  view: MacroDeskView;
  catalystFeed?: CatalystFeedDto | null;
  gammaView?: BoundedGammaDeskView | null;
  gammaViews?: readonly BoundedGammaDeskView[];
  demoMode?: boolean;
  marketPanel?: AlpacaMarketPanel | null;
  aiBriefing?: AiStudyBriefing | null;
  initialPanel?: DeskPanelId | null;
}) {
  const gammaPanels = gammaViews ?? (gammaView ? [gammaView] : []);

  const workspace = (
    <Suspense fallback={<WorkspaceFallback />}>
      <MacroDeskWorkspace
        view={view}
        catalystFeed={catalystFeed}
        gammaPanels={gammaPanels}
        marketPanel={marketPanel}
        aiBriefing={aiBriefing}
        initialPanel={initialPanel}
        demoMode={demoMode}
      />
    </Suspense>
  );

  if (view.status === "live_unavailable") {
    return (
      <DeskChrome demoMode={demoMode}>
        <DeskStatusBanners view={view} />
        <section className="terminal-state" data-testid="state-live-unavailable">
          <h1 className="terminal-page-title">Live data unavailable</h1>
          <p className="terminal-state-copy">
            {view.error?.message ??
              "This deployment does not serve live drivers for this request."}
          </p>
        </section>
      </DeskChrome>
    );
  }

  if (view.status === "empty" || (view.driver === null && !view.error)) {
    return (
      <DeskChrome demoMode={demoMode}>
        <DeskStatusBanners view={view} />
        {workspace}
        <section className="terminal-state" data-testid="state-empty">
          <p className="terminal-state-copy">
            {view.error?.message ??
              "No live driver and fixture fallback is disabled."}
          </p>
        </section>
      </DeskChrome>
    );
  }

  if (view.driver === null) {
    return (
      <DeskChrome demoMode={demoMode}>
        <DeskStatusBanners view={view} />
        {workspace}
        <section className="terminal-state" data-testid={`state-${view.status}`}>
          <p className="terminal-state-copy">
            {view.error?.message ?? "The desk cannot render a DominantDriver payload."}
          </p>
        </section>
      </DeskChrome>
    );
  }

  return (
    <DeskChrome demoMode={demoMode}>
      <DeskStatusBanners view={view} />
      <div data-testid={`state-${view.status}`}>{workspace}</div>
    </DeskChrome>
  );
}

export function DeskLoading() {
  return (
    <DeskChrome>
      <p className="terminal-session-strip" data-testid="state-loading">
        Loading macro desk…
      </p>
      <WorkspaceFallback />
    </DeskChrome>
  );
}
