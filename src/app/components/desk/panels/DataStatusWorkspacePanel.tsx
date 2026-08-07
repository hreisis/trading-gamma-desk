import type { AiStudyBriefing } from "@/contracts/ai-study-briefing";
import type { AlpacaMarketPanel } from "@/contracts/alpaca-market";
import type { CatalystFeed } from "@/contracts";
import type { BoundedGammaDeskView, MacroDeskView } from "@/desk";
import { gammaAvailabilityLabel } from "@/desk/format-gamma";
import { DeskStatusBanners } from "../../DeskStatusBanners";

export function DataStatusWorkspacePanel({
  view,
  gammaPanels,
  catalystFeed,
  marketPanel,
  briefing,
}: {
  view: MacroDeskView;
  gammaPanels: readonly BoundedGammaDeskView[];
  catalystFeed: CatalystFeed | null | undefined;
  marketPanel: AlpacaMarketPanel | null | undefined;
  briefing: AiStudyBriefing | null | undefined;
}) {
  return (
    <div className="workspace-panel" data-testid="workspace-data-status">
      <header className="workspace-panel-head">
        <h2 className="workspace-panel-title">Data Status</h2>
      </header>

      <ul className="workspace-status-list">
        <li>
          <span>Macro driver</span>
          <strong>{view.status}</strong>
        </li>
        <li>
          <span>Market quotes</span>
          <strong>{marketPanel?.status ?? "—"}</strong>
        </li>
        <li>
          <span>Catalyst feed</span>
          <strong>{catalystFeed?.mode ?? "—"}</strong>
        </li>
        <li>
          <span>AI Study</span>
          <strong>{briefing?.status ?? "—"}</strong>
        </li>
        {gammaPanels.map((panel) => (
          <li key={panel.snapshot?.symbol ?? panel.sourceLabel}>
            <span>Gamma {panel.snapshot?.symbol ?? "—"}</span>
            <strong>
              {panel.snapshot
                ? gammaAvailabilityLabel(panel.snapshot.status)
                : panel.status}
            </strong>
          </li>
        ))}
      </ul>

      <details className="desk-fold" open>
        <summary>Banners &amp; diagnostics</summary>
        <DeskStatusBanners view={view} />
        {catalystFeed?.linkingWarnings?.length ? (
          <p className="desk-section-note" data-testid="catalyst-linking">
            Linking: {catalystFeed.linkingWarnings.length} warning(s)
          </p>
        ) : null}
      </details>
    </div>
  );
}
