import type { CatalystFeed as CatalystFeedDto } from "@/contracts";
import { CatalystEventCard } from "../../catalyst-feed/CatalystEventCard";
import { deriveCatalystsSidebarSignal } from "../desk-sidebar-signals";
import { RiskTrafficLight } from "../../RiskTrafficLight";
import { RISK_LIGHT_BY_KIND } from "@/desk/risk-lights";

export function CatalystsWorkspacePanel({
  feed,
  suppressDemoChrome,
}: {
  feed: CatalystFeedDto;
  suppressDemoChrome?: boolean;
}) {
  const signal = deriveCatalystsSidebarSignal(feed);
  const light = RISK_LIGHT_BY_KIND[signal.kind];

  const briefsByDocId = new Map(
    (feed.briefs ?? []).map((b) => [b.documentId, b]),
  );
  const aiByBriefId = new Map(
    (feed.aiBriefs ?? []).map((b) => [b.inputBriefId, b]),
  );
  const marketByCatalystId = new Map(
    (feed.marketContext ?? []).map((s) => [s.catalystId, s]),
  );
  const reactionByCatalystId = new Map(
    (feed.marketReactions ?? []).map((r) => [r.catalystId, r]),
  );
  const aiReactionByCatalystId = new Map(
    (feed.aiMarketReactions ?? []).map((n) => [n.catalystId, n]),
  );
  const demo = feed.mode === "synthetic_demo" || feed.isPublicDemo;

  return (
    <div className="workspace-panel cf-feed" data-testid="workspace-catalysts">
      <header className="workspace-panel-head">
        <h2 id="catalyst-heading" className="workspace-panel-title">
          Catalysts
        </h2>
        <RiskTrafficLight light={light} testId="catalysts-panel-light" />
        <span className="workspace-panel-signal-label">{signal.statusShort}</span>
      </header>

      {feed.catalysts.length === 0 ? (
        <p className="desk-section-note" data-testid="catalyst-empty">
          No catalysts match the current view.
        </p>
      ) : (
        <div className="cf-signal-list" data-testid="catalyst-list">
          {feed.catalysts.map((c) => (
            <CatalystEventCard
              key={c.id}
              catalyst={c}
              feed={feed}
              briefsByDocId={briefsByDocId}
              aiByBriefId={aiByBriefId}
              marketContext={marketByCatalystId.get(c.id)}
              reaction={reactionByCatalystId.get(c.id)}
              aiReaction={aiReactionByCatalystId.get(c.id)}
              demo={demo}
            />
          ))}
        </div>
      )}

      <details className="desk-fold cf-feed-diagnostics" data-testid="catalyst-feed-diagnostics">
        <summary>Feed diagnostics</summary>
        {!suppressDemoChrome ? (
          <p className="desk-banner desk-banner-compact" data-testid="catalyst-banner">
            {feed.banner}
          </p>
        ) : null}
        <p className="desk-section-note" data-testid="catalyst-disclaimer">
          {feed.disclaimer}
        </p>
        <p className="desk-section-note" data-testid="catalyst-feed-source">
          Catalyst feed · {feed.source.name}
        </p>
      </details>
    </div>
  );
}
