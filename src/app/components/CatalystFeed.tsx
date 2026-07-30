import type { CatalystFeedResponse } from "@/catalyst";

function formatWhen(iso: string): string {
  // Display the contract timestamp as-is (already normalized); keep short.
  return iso.replace("T", " ").replace(/\.\d+/, "");
}

function sourceLabel(feed: CatalystFeedResponse, synthetic: boolean): string {
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

/**
 * Read-only catalyst list. Does not classify, score regimes, or advise trades.
 */
export function CatalystFeed({ feed }: { feed: CatalystFeedResponse }) {
  const bannerClass =
    feed.mode === "synthetic_demo"
      ? "desk-banner desk-banner-demo"
      : feed.mode === "live_unavailable" || feed.mode === "stale_calendar"
        ? "desk-banner desk-banner-warn"
        : "desk-banner";

  return (
    <section className="desk-section" aria-labelledby="catalyst-heading">
      <h2 id="catalyst-heading">Catalyst feed</h2>
      <p className={bannerClass} data-testid="catalyst-banner">
        {feed.banner}
      </p>
      <p className="desk-section-note" data-testid="catalyst-disclaimer">
        {feed.disclaimer}
      </p>
      <p className="desk-section-note" data-testid="catalyst-source-meta">
        Mode: {feed.mode}
        {feed.source.fetchedAt ? ` · cache ${feed.source.fetchedAt}` : ""}
        {feed.source.sources && feed.source.sources.length > 0
          ? ` · ${feed.source.sources
              .map(
                (s) =>
                  `${s.id}:${s.status}${s.mappedEventCount !== undefined ? `(${s.mappedEventCount})` : ""}`,
              )
              .join(" ")}`
          : ""}
      </p>
      <p className="desk-section-note">
        Events that may change the market&apos;s driver — independent of the
        regime score above. Classification confidence is uncalibrated and is not
        a market-up probability. Calendar rows are scheduled release times only.
      </p>

      {feed.mode === "live_unavailable" ? (
        <p className="desk-section-note" data-testid="catalyst-empty">
          No official calendar cache. Run{" "}
          <code>npm run catalyst:fetch</code> locally (not available in public
          demo).
        </p>
      ) : feed.catalysts.length === 0 ? (
        <p className="desk-section-note" data-testid="catalyst-empty">
          No catalysts match the current filters.
        </p>
      ) : (
        <ul className="catalyst-list" data-testid="catalyst-list">
          {feed.catalysts.map((c) => (
            <li key={c.id} className="catalyst-row">
              <div className="catalyst-when">{formatWhen(c.occurredAt)}</div>
              <div className="catalyst-main">
                <p className="catalyst-headline">{c.headline}</p>
                <p className="catalyst-meta">
                  <span>{c.category}</span>
                  <span>{c.importance}</span>
                  <span>{c.direction}</span>
                  <span>{c.status}</span>
                </p>
                <p className="catalyst-assets">
                  {c.affectedAssets.length > 0
                    ? c.affectedAssets.join(", ")
                    : "—"}
                </p>
              </div>
              <div className="catalyst-source">
                <span
                  className={
                    c.synthetic
                      ? "desk-source desk-source-fixture"
                      : "desk-source desk-source-live"
                  }
                >
                  {c.synthetic
                    ? `synthetic · ${c.sourceName}`
                    : `schedule · ${c.sourceName}`}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {feed.mode !== "live_unavailable" ? (
        <p className="desk-section-note" data-testid="catalyst-feed-source">
          Feed source: {sourceLabel(feed, feed.source.synthetic)}
        </p>
      ) : null}

      {feed.validationErrors.length > 0 ? (
        <p className="desk-section-note" data-testid="catalyst-validation">
          Validation: {feed.validationErrors.length} issue(s) recorded
          (malformed rows kept out of the feed).
        </p>
      ) : null}
    </section>
  );
}
