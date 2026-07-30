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
  formatReleaseStatusLabel,
  providerLabel,
} from "@/catalyst/feed-view";
import { formatScheduledAt } from "./format";
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
  return (
    <article
      className="cf-card"
      data-testid="catalyst-event-card"
      data-catalyst-id={catalyst.id}
    >
      <header className="cf-card-header">
        <div className="cf-badges">
          <span className="cf-badge cf-badge-category">
            {formatCategoryLabel(catalyst.category)}
          </span>
          <span
            className={`cf-badge cf-badge-importance cf-importance-${catalyst.importance}`}
          >
            {catalyst.importance}
          </span>
          <span
            className={`cf-badge cf-badge-status cf-status-${catalyst.status}`}
          >
            {formatReleaseStatusLabel(catalyst.status)}
          </span>
          {catalyst.synthetic ? (
            <span className="cf-badge cf-badge-demo">demo</span>
          ) : null}
        </div>
        <time className="cf-scheduled" dateTime={catalyst.occurredAt}>
          {formatScheduledAt(catalyst.occurredAt)}
        </time>
      </header>

      <h3 className="cf-card-title">{catalyst.headline}</h3>

      <p className="cf-card-meta">
        <span>{catalyst.direction}</span>
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

      {catalyst.officialDocuments && catalyst.officialDocuments.length > 0 ? (
        <p className="cf-panel-note cf-card-footer">
          Linked docs:{" "}
          {catalyst.officialDocuments
            .map((d) => providerLabel(d.provider))
            .join(", ")}
        </p>
      ) : null}
    </article>
  );
}
