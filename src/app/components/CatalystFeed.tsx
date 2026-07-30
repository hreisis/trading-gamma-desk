import type { Catalyst, CatalystFeedResponse, ReleaseResult } from "@/catalyst";

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

function formatObservation(o: ReleaseResult["observations"][number]): string {
  const prelim = o.preliminary ? " · preliminary" : "";
  const revised = ""; // revision flag is at feed/cache level; per-obs uses preliminary
  return `${o.metric}: ${o.actual} ${o.unit} (${o.transformation}${prelim}${revised})`;
}

function ReleaseResultBlock({
  result,
  synthetic,
}: {
  result: ReleaseResult;
  synthetic: boolean;
}) {
  return (
    <div className="catalyst-release" data-testid="catalyst-release-result">
      <p className="catalyst-release-period">
        Reference period: {result.referencePeriod}
      </p>
      <ul className="catalyst-release-obs">
        {result.observations.map((o) => (
          <li key={`${o.metric}-${o.sourcePeriod}`}>
            {formatObservation(o)}
            {o.preliminary ? (
              <span className="catalyst-release-flag"> preliminary</span>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="catalyst-release-meta">Consensus unavailable</p>
      <p className="catalyst-release-meta">Surprise unavailable</p>
      <p className="catalyst-release-meta">
        {synthetic ? "synthetic BLS-shaped source" : "official BLS source"} ·{" "}
        {result.sourceName}
      </p>
    </div>
  );
}

function CatalystRow({ c }: { c: Catalyst }) {
  return (
    <li key={c.id} className="catalyst-row">
      <div className="catalyst-when">{formatWhen(c.occurredAt)}</div>
      <div className="catalyst-main">
        <p className="catalyst-headline">{c.headline}</p>
        <p className="catalyst-meta">
          <span>{c.category}</span>
          <span>{c.importance}</span>
          <span>{c.direction}</span>
          <span>{c.status}</span>
          {c.referencePeriod ? (
            <span>ref {c.referencePeriod}</span>
          ) : null}
        </p>
        <p className="catalyst-assets">
          {c.affectedAssets.length > 0 ? c.affectedAssets.join(", ") : "—"}
        </p>
        {c.releaseResult ? (
          <ReleaseResultBlock
            result={c.releaseResult}
            synthetic={c.synthetic}
          />
        ) : null}
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
            : c.releaseResult
              ? `released · ${c.sourceName}`
              : `schedule · ${c.sourceName}`}
        </span>
      </div>
    </li>
  );
}

/**
 * Read-only catalyst list. Does not classify, score regimes, or advise trades.
 * Does not invent beat/miss, hot/cold, or market direction from prints.
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
        {feed.source.results
          ? ` · results:${feed.source.results.status ?? (feed.source.results.available ? "ok" : "missing")}`
          : ""}
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
        a market-up probability. Calendar rows are scheduled release times;
        linked BLS series show actuals only (no consensus/surprise).
      </p>

      {feed.mode === "live_unavailable" ? (
        <p className="desk-section-note" data-testid="catalyst-empty">
          No official calendar cache. Run{" "}
          <code>npm run catalyst:fetch</code> locally (not available in public
          demo). Optional results: <code>npm run catalyst:results:fetch</code>.
        </p>
      ) : feed.catalysts.length === 0 ? (
        <p className="desk-section-note" data-testid="catalyst-empty">
          No catalysts match the current filters.
        </p>
      ) : (
        <ul className="catalyst-list" data-testid="catalyst-list">
          {feed.catalysts.map((c) => (
            <CatalystRow key={c.id} c={c} />
          ))}
        </ul>
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
          . Historical archive periods are not duplicated as feed items.
        </p>
      ) : null}
      {feed.source.results?.archiveReleaseCount !== undefined ? (
        <p className="desk-section-note" data-testid="catalyst-results-archive">
          Results archive: {feed.source.results.archiveReleaseCount} period
          record(s); feed standalones:{" "}
          {feed.source.results.materializedStandaloneCount ?? 0}; linked:{" "}
          {feed.source.results.linkedCount ?? 0}. Consensus unavailable ·
          Surprise unavailable.
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
