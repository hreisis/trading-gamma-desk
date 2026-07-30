import type { CatalystFeedResponse } from "@/catalyst";

function formatWhen(iso: string): string {
  // Display the contract timestamp as-is (already normalized); keep short.
  return iso.replace("T", " ").replace(/\.\d+/, "");
}

/**
 * Read-only catalyst list. Does not classify, score regimes, or advise trades.
 */
export function CatalystFeed({ feed }: { feed: CatalystFeedResponse }) {
  return (
    <section className="desk-section" aria-labelledby="catalyst-heading">
      <h2 id="catalyst-heading">Catalyst feed</h2>
      <p className="desk-banner desk-banner-demo" data-testid="catalyst-banner">
        {feed.banner}
      </p>
      <p className="desk-section-note" data-testid="catalyst-disclaimer">
        {feed.disclaimer}
      </p>
      <p className="desk-section-note">
        Events that may change the market&apos;s driver — independent of the
        regime score above. Classification confidence is uncalibrated and is not
        a market-up probability.
      </p>

      {feed.catalysts.length === 0 ? (
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
                <span className="desk-source desk-source-fixture">
                  synthetic · {c.sourceName}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {feed.validationErrors.length > 0 ? (
        <p className="desk-section-note" data-testid="catalyst-validation">
          Fixture validation: {feed.validationErrors.length} raw row(s) rejected
          (malformed kept out of the feed).
        </p>
      ) : null}
    </section>
  );
}
