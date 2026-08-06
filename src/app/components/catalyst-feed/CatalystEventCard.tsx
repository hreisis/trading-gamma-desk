import type {
  Catalyst,
  CatalystFeed as CatalystFeedDto,
  OfficialBrief,
  PublicAiMarketReactionNarrative,
  PublicEventMarketContext,
  PublicEventMarketReaction,
  PublicOfficialAiBrief,
  ReleaseResult,
} from "@/contracts";
import {
  formatCategoryLabel,
  formatDirectionLabel,
  formatImportanceLabel,
  formatReleaseStatusLabel,
  providerLabel,
} from "@/catalyst/feed-view";
import { deriveCatalystRiskLight } from "@/desk/risk-lights";
import { RiskTrafficLight } from "../RiskTrafficLight";
import {
  catalystShortTitle,
  catalystStatusTimeLabel,
  riskLightScanLabel,
  upcomingCatalystImportanceLight,
  upcomingCatalystScanLabel,
} from "../signal-display";
import { formatScheduledAtEt, formatScheduledShort } from "./format";
import { MarketReactionSection } from "./MarketReactionSection";
import { OfficialBriefSection } from "./OfficialBriefSection";

function formatObservation(o: ReleaseResult["observations"][number]): string {
  const prelim = o.preliminary ? " · preliminary" : "";
  return `${o.metric}: ${o.actual} ${o.unit} (${o.transformation}${prelim})`;
}

function ReleaseResultPanel({
  result,
  synthetic,
}: {
  result: ReleaseResult;
  synthetic: boolean;
}) {
  return (
    <div className="cf-panel cf-panel-compact" data-testid="catalyst-release-result">
      <h4 className="cf-panel-title">Official print</h4>
      <p className="cf-panel-note">Reference period {result.referencePeriod}</p>
      <ul className="cf-citations">
        {result.observations.map((o) => (
          <li key={`${o.metric}-${o.sourcePeriod}`}>
            <span className="cf-citation-text">{formatObservation(o)}</span>
          </li>
        ))}
      </ul>
      <p className="cf-panel-note">
        Consensus unavailable · Surprise unavailable ·{" "}
        {synthetic ? "synthetic source" : result.sourceName}
      </p>
    </div>
  );
}

function catalystScanSignal(
  catalyst: Catalyst,
  reactionLight: ReturnType<typeof deriveCatalystRiskLight>,
): { light: typeof reactionLight; label: string } {
  if (
    catalyst.status === "released" ||
    catalyst.status === "developing" ||
    catalyst.status === "resolved"
  ) {
    const statusLabel = catalystStatusTimeLabel(catalyst.status);
    if (reactionLight.kind === "gray") {
      return { light: reactionLight, label: statusLabel || "—" };
    }
    return { light: reactionLight, label: riskLightScanLabel(reactionLight) };
  }
  return {
    light: upcomingCatalystImportanceLight(catalyst.importance),
    label: upcomingCatalystScanLabel(catalyst.importance),
  };
}

function catalystTimeLabel(catalyst: Catalyst): string {
  const status = catalystStatusTimeLabel(catalyst.status);
  if (status) return status;
  return formatScheduledShort(catalyst.occurredAt);
}

export function CatalystEventCard({
  catalyst,
  feed,
  briefsByDocId,
  aiByBriefId,
  marketContext,
  reaction,
  aiReaction,
  demo,
}: {
  catalyst: Catalyst;
  feed: CatalystFeedDto;
  briefsByDocId: ReadonlyMap<string, OfficialBrief>;
  aiByBriefId: ReadonlyMap<string, PublicOfficialAiBrief>;
  marketContext?: PublicEventMarketContext;
  reaction?: PublicEventMarketReaction;
  aiReaction?: PublicAiMarketReactionNarrative;
  demo?: boolean;
}) {
  const coreWindow =
    reaction?.windows.find((w) => w.window === "30m") ??
    reaction?.windows.find((w) => w.window === "5m") ??
    reaction?.windows[0];

  const reactionLight = deriveCatalystRiskLight({
    status: catalyst.status,
    equityBreadth: coreWindow?.equityBreadth,
    equityLeadershipStatus: coreWindow?.equityLeadership.status,
  });
  const scan = catalystScanSignal(catalyst, reactionLight);
  const title = catalystShortTitle(catalyst.category, catalyst.headline);

  return (
    <article
      className="cf-signal-card"
      data-testid="catalyst-event-card"
      data-catalyst-id={catalyst.id}
    >
      <div className="cf-scan-row">
        <RiskTrafficLight
          light={scan.light}
          compact
          testId={`catalyst-risk-light-${catalyst.id}`}
        />
        <span className="cf-scan-title">{title}</span>
        <span className="cf-scan-signal">{scan.label}</span>
        <time className="cf-scan-time" dateTime={catalyst.occurredAt}>
          {catalystTimeLabel(catalyst)}
        </time>
      </div>

      <details className="cf-details cf-card-details" data-testid="catalyst-card-details">
        <summary>Details &amp; citations</summary>

        <header className="cf-card-header">
          <div className="cf-badges">
            <span
              className={`cf-badge cf-badge-status cf-status-${catalyst.status}`}
            >
              {formatReleaseStatusLabel(catalyst.status)}
            </span>
            <span
              className={`cf-badge cf-badge-importance cf-importance-${catalyst.importance}`}
            >
              {formatImportanceLabel(catalyst.importance)}
            </span>
            {catalyst.synthetic ? (
              <span className="cf-badge cf-badge-demo">Demo</span>
            ) : null}
          </div>
          <time className="cf-scheduled" dateTime={catalyst.occurredAt}>
            {formatScheduledAtEt(catalyst.occurredAt)}
          </time>
        </header>

        <h3 className="cf-card-title">{catalyst.headline}</h3>

        <OfficialBriefSection
          catalyst={catalyst}
          briefsByDocId={briefsByDocId}
          aiByBriefId={aiByBriefId}
          demo={demo}
        />

        <MarketReactionSection
          feed={feed}
          catalystStatus={catalyst.status}
          context={marketContext}
          reaction={reaction}
          ai={aiReaction}
          demo={demo}
        />

        <p className="cf-card-meta">
          <span>{formatCategoryLabel(catalyst.category)}</span>
          <span>{formatDirectionLabel(catalyst.direction)}</span>
          {catalyst.referencePeriod ? (
            <span>ref {catalyst.referencePeriod}</span>
          ) : null}
          <span>
            {catalyst.affectedAssets.length > 0
              ? catalyst.affectedAssets.join(", ")
              : "—"}
          </span>
          <span className="cf-card-source">
            {catalyst.synthetic
              ? `synthetic · ${catalyst.sourceName}`
              : catalyst.releaseResult
                ? `released · ${catalyst.sourceName}`
                : `schedule · ${catalyst.sourceName}`}
          </span>
        </p>

        {catalyst.releaseResult ? (
          <ReleaseResultPanel
            result={catalyst.releaseResult}
            synthetic={catalyst.synthetic}
          />
        ) : null}

        {catalyst.officialDocuments && catalyst.officialDocuments.length > 0 ? (
          <p className="cf-panel-note cf-card-footer">
            Linked docs:{" "}
            {catalyst.officialDocuments
              .map((d) => providerLabel(d.provider))
              .join(", ")}
          </p>
        ) : null}
      </details>
    </article>
  );
}
