import type { CatalystFeed as CatalystFeedDto } from "@/contracts";
import { deriveCatalystFeedUiStatus } from "@/catalyst/feed-view";
import { CatalystEventCard } from "./CatalystEventCard";

function sourceLabel(feed: CatalystFeedDto, synthetic: boolean): string {
  if (feed.mode === "synthetic_demo" || synthetic) {
    return `Synthetic · ${feed.source.name}`;
  }
  const freshness = feed.source.stale
    ? "stale"
    : feed.source.fetchedAt
      ? `fetched ${feed.source.fetchedAt.replace("T", " ").replace(/\.\d+Z$/, "Z")}`
      : "official";
  const partial = feed.source.partialFailure ? " · partial failure" : "";
  return `Official calendar · ${freshness}${partial}`;
}

function LayerStatusStrip({ feed }: { feed: CatalystFeedDto }) {
  const chips: string[] = [`Mode ${feed.mode.replace(/_/g, " ")}`];
  const push = (label: string, layer?: { available?: boolean; status?: string }) => {
    if (!layer) return;
    chips.push(
      `${label}: ${(layer.status ?? (layer.available ? "ok" : "missing")).replace(/_/g, " ")}`,
    );
  };
  push("Results", feed.source.results);
  push("Docs", feed.source.documents);
  push("Briefs", feed.source.briefs);
  push("Market context", feed.source.marketContext);
  push("Reactions", feed.source.marketReactions);
  return (
    <p className="cf-layer-strip" data-testid="catalyst-source-meta">
      {chips.join(" · ")}
    </p>
  );
}

export function CatalystFeedSkeleton() {
  return (
    <section className="signal-section cf-feed" aria-labelledby="catalyst-heading">
      <h2 id="catalyst-heading" className="signal-section-label">
        Catalysts
      </h2>
      <div className="cf-state cf-state-loading" data-testid="catalyst-loading">
        <div className="desk-skeleton desk-skeleton-title" />
        <div className="desk-skeleton desk-skeleton-line" />
      </div>
    </section>
  );
}

/**
 * Information-dense catalyst event feed (M3-1 / M3-1.5).
 * Read-only — does not classify markets or invent beat/miss language.
 */
export function CatalystFeed({
  feed,
  suppressDemoChrome,
}: {
  feed: CatalystFeedDto | null | undefined;
  /** When true, skip duplicate demo banner (merged into page chrome). */
  suppressDemoChrome?: boolean;
}) {
  if (feed === undefined) {
    return <CatalystFeedSkeleton />;
  }

  const uiStatus = deriveCatalystFeedUiStatus(feed);
  const demo = feed?.mode === "synthetic_demo" || feed?.isPublicDemo;
  const hideDemoChrome =
    Boolean(suppressDemoChrome) &&
    (feed?.mode === "synthetic_demo" || feed?.isPublicDemo);

  if (feed === null || uiStatus === "error") {
    return (
      <section className="signal-section cf-feed" aria-labelledby="catalyst-heading">
        <h2 id="catalyst-heading" className="signal-section-label">
          Catalysts
        </h2>
        <div className="cf-state cf-state-error" data-testid="catalyst-error">
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
      ? "desk-banner desk-banner-demo desk-banner-compact"
      : uiStatus === "partial" || feed.mode === "stale_calendar"
        ? "desk-banner desk-banner-warn desk-banner-compact"
        : "desk-banner desk-banner-compact";

  return (
    <section className="signal-section cf-feed" aria-labelledby="catalyst-heading">
      <h2 id="catalyst-heading" className="signal-section-label">
        Catalysts
      </h2>

      {uiStatus === "empty" ? (
        <div className="cf-state cf-state-empty" data-testid="catalyst-empty">
          <p className="desk-section-note">No catalysts match the current view.</p>
        </div>
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
        {!hideDemoChrome ? (
          <p className={bannerClass} data-testid="catalyst-banner">
            {feed.banner}
          </p>
        ) : null}
        <p className="desk-section-note" data-testid="catalyst-disclaimer">
          {feed.disclaimer}
        </p>
        {uiStatus === "partial" ? (
          <p className="cf-state-banner cf-state-partial" data-testid="catalyst-partial">
            Partial data — some layers missing or stale. Market reaction may read
            Awaiting market data.
          </p>
        ) : null}
        <LayerStatusStrip feed={feed} />
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
      </details>
    </section>
  );
}
