import type { CatalystFeed as CatalystFeedDto } from "@/contracts";
import { deriveCatalystFeedUiStatus } from "@/catalyst/feed-view";
import { CatalystEventCard } from "./CatalystEventCard";

function sourceLabel(feed: CatalystFeedDto, synthetic: boolean): string {
  if (feed.mode === "synthetic_demo" || synthetic) {
    return `synthetic · ${feed.source.name}`;
  }
  const freshness = feed.source.stale
    ? "stale"
    : feed.source.fetchedAt
      ? `fetched ${feed.source.fetchedAt.replace("T", " ").replace(/\.\d+Z$/, "Z")}`
      : "official";
  const partial = feed.source.partialFailure ? " · partial failure" : "";
  return `official calendar · ${freshness}${partial}`;
}

function LayerStatusStrip({ feed }: { feed: CatalystFeedDto }) {
  const chips: string[] = [`mode:${feed.mode}`];
  const push = (key: string, layer?: { available?: boolean; status?: string }) => {
    if (!layer) return;
    chips.push(`${key}:${layer.status ?? (layer.available ? "ok" : "missing")}`);
  };
  push("results", feed.source.results);
  push("docs", feed.source.documents);
  push("briefs", feed.source.briefs);
  push("mctx", feed.source.marketContext);
  push("mrxn", feed.source.marketReactions);
  return (
    <p className="cf-layer-strip" data-testid="catalyst-source-meta">
      {chips.join(" · ")}
    </p>
  );
}

export function CatalystFeedSkeleton() {
  return (
    <section className="desk-section cf-feed" aria-labelledby="catalyst-heading">
      <h2 id="catalyst-heading">Catalyst feed</h2>
      <div className="cf-state cf-state-loading" data-testid="catalyst-loading">
        <div className="desk-skeleton desk-skeleton-title" />
        <div className="desk-skeleton desk-skeleton-line" />
        <div className="desk-skeleton desk-skeleton-line short" />
      </div>
    </section>
  );
}

/**
 * Information-dense catalyst event feed (M3-1).
 * Read-only — does not classify markets or invent beat/miss language.
 */
export function CatalystFeed({
  feed,
}: {
  feed: CatalystFeedDto | null | undefined;
}) {
  if (feed === undefined) {
    return <CatalystFeedSkeleton />;
  }

  const uiStatus = deriveCatalystFeedUiStatus(feed);
  const demo = feed?.mode === "synthetic_demo" || feed?.isPublicDemo;

  if (feed === null || uiStatus === "error") {
    return (
      <section className="desk-section cf-feed" aria-labelledby="catalyst-heading">
        <h2 id="catalyst-heading">Catalyst feed</h2>
        <div className="cf-state cf-state-error" data-testid="catalyst-error">
          <p className="desk-banner desk-banner-warn">{feed?.banner}</p>
          <p className="desk-section-note">{feed?.disclaimer}</p>
          <p className="desk-section-note" data-testid="catalyst-empty">
            Official calendar cache unavailable. Run{" "}
            <code>npm run catalyst:fetch</code> locally (not in public demo).
          </p>
        </div>
      </section>
    );
  }

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

  const bannerClass =
    feed.mode === "synthetic_demo"
      ? "desk-banner desk-banner-demo"
      : uiStatus === "partial" || feed.mode === "stale_calendar"
        ? "desk-banner desk-banner-warn"
        : "desk-banner";

  return (
    <section className="desk-section cf-feed" aria-labelledby="catalyst-heading">
      <h2 id="catalyst-heading">Catalyst feed</h2>
      <p className={bannerClass} data-testid="catalyst-banner">
        {feed.banner}
      </p>
      <p className="desk-section-note" data-testid="catalyst-disclaimer">
        {feed.disclaimer}
      </p>

      {uiStatus === "partial" ? (
        <p className="cf-state-banner cf-state-partial" data-testid="catalyst-partial">
          Partial data — some layers missing or stale. Events below show what is
          available; market reaction may read Awaiting market data.
        </p>
      ) : null}

      <LayerStatusStrip feed={feed} />

      <p className="desk-section-note">
        Events that may change the market&apos;s driver — independent of the
        regime score above. Scheduled times are not confirmed prints until
        official results/documents link.
      </p>

      {uiStatus === "empty" ? (
        <div className="cf-state cf-state-empty" data-testid="catalyst-empty">
          <p className="desk-section-note">No catalysts match the current view.</p>
        </div>
      ) : (
        <div className="cf-card-list" data-testid="catalyst-list">
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

      {feed.mode !== "live_unavailable" ? (
        <p className="desk-section-note" data-testid="catalyst-feed-source">
          Feed source: {sourceLabel(feed, feed.source.synthetic)}
        </p>
      ) : null}

      {feed.linkingWarnings && feed.linkingWarnings.length > 0 ? (
        <p className="desk-section-note" data-testid="catalyst-linking">
          Linking:{" "}
          {feed.linkingWarnings
            .map(
              (w) =>
                `${w.releaseFamily ?? "?"} ${w.referencePeriod ?? "?"}${w.reason ? ` (${w.reason})` : ""}`,
            )
            .join("; ")}
        </p>
      ) : null}

      {feed.validationIssueCount > 0 ? (
        <p className="desk-section-note" data-testid="catalyst-validation">
          Validation: {feed.validationIssueCount} issue(s) recorded (malformed
          rows excluded).
        </p>
      ) : null}
    </section>
  );
}
