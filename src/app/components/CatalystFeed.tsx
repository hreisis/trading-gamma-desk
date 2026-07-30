import type {
  Catalyst,
  CatalystFeedResponse,
  OfficialBrief,
  OfficialDocument,
  ReleaseResult,
} from "@/catalyst";

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

function providerLabel(provider: string): string {
  if (provider === "federal_reserve") return "Federal Reserve";
  if (provider === "bls") return "BLS";
  if (provider === "bea") return "BEA";
  return provider;
}

function OfficialBriefBlock({
  brief,
  documentUrl,
  provider,
}: {
  brief: OfficialBrief;
  documentUrl?: string;
  provider: string;
}) {
  const topFacts = brief.facts.slice(0, 4);
  return (
    <div className="catalyst-official-brief" data-testid="catalyst-official-brief">
      <p className="catalyst-release-meta">
        Official brief · Rule-based summary · {providerLabel(provider)}
      </p>
      <p className="catalyst-release-meta">
        Status: {brief.status}
        {brief.referencePeriod ? ` · ref ${brief.referencePeriod}` : ""}
      </p>
      <p className="catalyst-headline">{brief.headline}</p>
      <ul className="catalyst-release-obs">
        {topFacts.map((f) => (
          <li key={f.id}>
            <span>{f.text}</span>
            <details>
              <summary>Evidence excerpt</summary>
              <p className="catalyst-release-meta" data-testid="catalyst-brief-evidence">
                “{f.evidence.excerpt}”
              </p>
            </details>
          </li>
        ))}
      </ul>
      {brief.warnings.length > 0 ? (
        <p className="catalyst-release-meta">
          Warnings: {brief.warnings.length} (cross-check / extraction)
        </p>
      ) : null}
      {documentUrl ? (
        <p className="catalyst-release-meta">
          <a href={documentUrl} target="_blank" rel="noopener noreferrer">
            View official document
          </a>
        </p>
      ) : null}
      <p className="catalyst-release-meta">
        Rule-based fact extract — not official prose and not AI interpretation.
        Does not replace the full release.
      </p>
    </div>
  );
}

function OfficialDocumentBlock({
  docs,
  briefsByDocId,
}: {
  docs: NonNullable<Catalyst["officialDocuments"]>;
  briefsByDocId: ReadonlyMap<string, OfficialBrief>;
}) {
  return (
    <div className="catalyst-official-doc" data-testid="catalyst-official-doc">
      {docs.map((d) => {
        const brief = briefsByDocId.get(d.id);
        return (
          <div key={d.id} className="catalyst-official-doc-item">
            <p className="catalyst-release-meta">
              Official release · {providerLabel(d.provider)}
            </p>
            <p className="catalyst-release-meta">
              Published {formatWhen(d.publishedAt)}
            </p>
            {d.summaryFromSource ? (
              <p className="catalyst-release-meta">{d.summaryFromSource}</p>
            ) : null}
            <p className="catalyst-release-meta">
              <a
                href={d.canonicalUrl}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="catalyst-official-doc-link"
              >
                View official document
              </a>
            </p>
            {brief ? (
              <OfficialBriefBlock
                brief={brief}
                documentUrl={d.canonicalUrl}
                provider={d.provider}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function OfficialUpdates({
  documents,
  briefs,
}: {
  documents: readonly OfficialDocument[];
  briefs: readonly OfficialBrief[];
}) {
  if (documents.length === 0 && briefs.length === 0) return null;
  const briefsByDoc = new Map(briefs.map((b) => [b.documentId, b]));
  return (
    <div className="catalyst-official-updates" data-testid="catalyst-official-updates">
      <h3>Official Updates</h3>
      <p className="desk-section-note">
        Source release documents and rule-based briefs from the last 30 days —
        evidence only, not additional macro catalysts. Briefs are rule-based
        fact extracts, not AI interpretation.
      </p>
      <ul className="catalyst-list">
        {documents.map((d) => {
          const brief = briefsByDoc.get(d.id);
          return (
            <li key={d.id} className="catalyst-row">
              <div className="catalyst-when">{formatWhen(d.publishedAt)}</div>
              <div className="catalyst-main">
                <p className="catalyst-headline">{d.title}</p>
                <p className="catalyst-meta">
                  <span>{providerLabel(d.provider)}</span>
                  <span>{d.documentType}</span>
                  {d.referencePeriod ? (
                    <span>ref {d.referencePeriod}</span>
                  ) : null}
                </p>
                {d.summaryFromSource ? (
                  <p className="catalyst-release-meta">{d.summaryFromSource}</p>
                ) : null}
                <p className="catalyst-release-meta">
                  <a
                    href={d.canonicalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    View official document
                  </a>
                </p>
                {brief ? (
                  <OfficialBriefBlock
                    brief={brief}
                    documentUrl={d.canonicalUrl}
                    provider={d.provider}
                  />
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function CatalystRow({
  c,
  briefsByDocId,
}: {
  c: Catalyst;
  briefsByDocId: ReadonlyMap<string, OfficialBrief>;
}) {
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
        {c.officialDocuments && c.officialDocuments.length > 0 ? (
          <OfficialDocumentBlock
            docs={c.officialDocuments}
            briefsByDocId={briefsByDocId}
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
  const briefsByDocId = new Map(
    (feed.briefs ?? []).map((b) => [b.documentId, b]),
  );

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
        {feed.source.documents
          ? ` · documents:${feed.source.documents.status ?? (feed.source.documents.available ? "ok" : "missing")}`
          : ""}
        {feed.source.briefs
          ? ` · briefs:${feed.source.briefs.status ?? (feed.source.briefs.available ? "ok" : "missing")}`
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
        linked BLS series show actuals only (no consensus/surprise). Official
        release documents are source evidence only.
      </p>

      {feed.mode === "live_unavailable" ? (
        <p className="desk-section-note" data-testid="catalyst-empty">
          No official calendar cache. Run{" "}
          <code>npm run catalyst:fetch</code> locally (not available in public
          demo). Optional: <code>npm run catalyst:results:fetch</code>,{" "}
          <code>npm run catalyst:documents:fetch</code>.
        </p>
      ) : feed.catalysts.length === 0 ? (
        <p className="desk-section-note" data-testid="catalyst-empty">
          No catalysts match the current filters.
        </p>
      ) : (
        <ul className="catalyst-list" data-testid="catalyst-list">
          {feed.catalysts.map((c) => (
            <CatalystRow key={c.id} c={c} briefsByDocId={briefsByDocId} />
          ))}
        </ul>
      )}

      {(feed.documents && feed.documents.length > 0) ||
      (feed.briefs && feed.briefs.length > 0) ? (
        <OfficialUpdates
          documents={feed.documents ?? []}
          briefs={feed.briefs ?? []}
        />
      ) : null}

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
      {feed.source.documents?.archiveDocumentCount !== undefined ? (
        <p className="desk-section-note" data-testid="catalyst-documents-archive">
          Documents archive: {feed.source.documents.archiveDocumentCount}; feed
          window: {feed.source.documents.feedDocumentCount ?? 0}; linked:{" "}
          {feed.source.documents.linkedCount ?? 0}. No AI summaries.
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
