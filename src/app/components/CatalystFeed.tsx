import type {
  Catalyst,
  CatalystFeedResponse,
  EventMarketContext,
  EventMarketReaction,
  OfficialAiBrief,
  OfficialBrief,
  OfficialDocument,
  ReleaseResult,
} from "@/catalyst";
import {
  formatCrossAssetSignatureText,
  formatLeadershipText,
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

function OfficialAiBriefBlock({
  ai,
  brief,
  documentUrl,
  demo,
}: {
  ai: OfficialAiBrief;
  brief: OfficialBrief;
  documentUrl?: string;
  demo?: boolean;
}) {
  const factsById = new Map(brief.facts.map((f) => [f.id, f]));
  return (
    <div
      className="catalyst-official-ai-brief"
      data-testid="catalyst-official-ai-brief"
    >
      <p className="catalyst-release-meta">
        {demo
          ? "Demo AI brief · Synthetic data"
          : "AI official brief · Generated from cited official facts"}
      </p>
      <p className="catalyst-release-meta">
        AI-generated · Status: {ai.status}
        {brief.referencePeriod ? ` · ref ${brief.referencePeriod}` : ""}
      </p>
      <p className="catalyst-headline">{ai.headline}</p>
      <ul className="catalyst-release-obs">
        {ai.bullets.map((b) => (
          <li key={b.id}>
            <span>{b.text}</span>
            <details>
              <summary>Cited facts / evidence</summary>
              {b.factIds.map((fid) => {
                const f = factsById.get(fid);
                if (!f) return null;
                return (
                  <p
                    key={fid}
                    className="catalyst-release-meta"
                    data-testid="catalyst-ai-brief-evidence"
                  >
                    {f.label}: “{f.evidence.excerpt}”
                  </p>
                );
              })}
            </details>
          </li>
        ))}
      </ul>
      {documentUrl ? (
        <p className="catalyst-release-meta">
          <a href={documentUrl} target="_blank" rel="noopener noreferrer">
            View official document
          </a>
        </p>
      ) : null}
      <p className="catalyst-release-meta">
        AI-generated narrative over cited facts — not official prose, not a
        source-provided summary.
      </p>
    </div>
  );
}

function OfficialBriefBlock({
  brief,
  aiBrief,
  documentUrl,
  provider,
  demo,
}: {
  brief: OfficialBrief;
  aiBrief?: OfficialAiBrief;
  documentUrl?: string;
  provider: string;
  demo?: boolean;
}) {
  const topFacts = brief.facts.slice(0, 4);
  const showAi =
    aiBrief &&
    (aiBrief.status === "complete" || aiBrief.status === "partial") &&
    aiBrief.validation.errors.length === 0;

  return (
    <div className="catalyst-official-brief" data-testid="catalyst-official-brief">
      {showAi ? (
        <OfficialAiBriefBlock
          ai={aiBrief}
          brief={brief}
          documentUrl={documentUrl}
          demo={demo}
        />
      ) : null}
      <details open={!showAi}>
        <summary>
          Rule-based facts · {providerLabel(provider)}
          {showAi ? " (grounding)" : ""}
        </summary>
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
                <p
                  className="catalyst-release-meta"
                  data-testid="catalyst-brief-evidence"
                >
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
          Rule-based fact extract — not official prose.
          {showAi
            ? ""
            : " AI brief unavailable/rejected — showing rule-based facts."}{" "}
          Does not replace the full release.
        </p>
      </details>
    </div>
  );
}

function OfficialDocumentBlock({
  docs,
  briefsByDocId,
  aiByBriefId,
  demo,
}: {
  docs: NonNullable<Catalyst["officialDocuments"]>;
  briefsByDocId: ReadonlyMap<string, OfficialBrief>;
  aiByBriefId: ReadonlyMap<string, OfficialAiBrief>;
  demo?: boolean;
}) {
  return (
    <div className="catalyst-official-doc" data-testid="catalyst-official-doc">
      {docs.map((d) => {
        const brief = briefsByDocId.get(d.id);
        const ai = brief ? aiByBriefId.get(brief.id) : undefined;
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
                aiBrief={ai}
                documentUrl={d.canonicalUrl}
                provider={d.provider}
                demo={demo}
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
  aiBriefs,
  demo,
}: {
  documents: readonly OfficialDocument[];
  briefs: readonly OfficialBrief[];
  aiBriefs: readonly OfficialAiBrief[];
  demo?: boolean;
}) {
  if (documents.length === 0 && briefs.length === 0) return null;
  const briefsByDoc = new Map(briefs.map((b) => [b.documentId, b]));
  const aiByBriefId = new Map(aiBriefs.map((b) => [b.inputBriefId, b]));
  return (
    <div className="catalyst-official-updates" data-testid="catalyst-official-updates">
      <h3>Official Updates</h3>
      <p className="desk-section-note">
        Source release documents, rule-based facts, and AI briefs (when
        validated) from the last 30 days — evidence only, not additional macro
        catalysts. AI rewrites cited facts only; rejected AI falls back to
        rule-based facts.
      </p>
      <ul className="catalyst-list">
        {documents.map((d) => {
          const brief = briefsByDoc.get(d.id);
          const ai = brief ? aiByBriefId.get(brief.id) : undefined;
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
                    aiBrief={ai}
                    documentUrl={d.canonicalUrl}
                    provider={d.provider}
                    demo={demo}
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

function formatPct(pct: number | null | undefined): string {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return "—";
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

function MarketContextBlock({
  ctx,
  demo,
}: {
  ctx: EventMarketContext;
  demo?: boolean;
}) {
  return (
    <div
      className="catalyst-market-context"
      data-testid="catalyst-market-context"
    >
      <p className="catalyst-release-meta">
        {demo
          ? "Demo market context · Synthetic ETF bars"
          : "Market context · Observed ETF moves around the release"}
      </p>
      <p className="catalyst-release-meta">
        Provider {ctx.provider} · feed {ctx.feed} · status {ctx.status}
        {ctx.session.isHoliday ? " · holiday" : ""}
        {ctx.session.isEarlyClose ? " · early close" : ""}
        {ctx.session.eventInPremarket ? " · premarket event" : ""}
      </p>
      <p className="catalyst-release-meta">
        Event {formatWhen(ctx.eventTimestamp)} (UTC) · ET date{" "}
        {ctx.session.easternDate}
      </p>
      <table className="catalyst-mctx-table" data-testid="catalyst-mctx-table">
        <thead>
          <tr>
            <th>ETF proxy</th>
            <th>Baseline</th>
            <th>+5m</th>
            <th>+30m</th>
            <th>+2h</th>
            <th>Close</th>
          </tr>
        </thead>
        <tbody>
          {ctx.symbols.map((s) => {
            const byKind = new Map(s.windows.map((w) => [w.kind, w]));
            return (
              <tr key={s.symbol}>
                <td>
                  <span>{s.symbol}</span>
                  <span className="catalyst-release-meta">
                    {" "}
                    · {s.instrumentLabel}
                  </span>
                </td>
                <td>
                  {s.baseline ? s.baseline.price.toFixed(2) : "—"}
                </td>
                <td>{formatPct(byKind.get("plus5m")?.pctChange)}</td>
                <td>{formatPct(byKind.get("plus30m")?.pctChange)}</td>
                <td>{formatPct(byKind.get("plus2h")?.pctChange)}</td>
                <td>{formatPct(byKind.get("sessionClose")?.pctChange)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="catalyst-release-meta" data-testid="catalyst-mctx-disclaimer">
        ETF proxies only (not DXY, not Treasury yields, not official index
        levels). Observed movement does not establish causation.
      </p>
    </div>
  );
}

function windowShort(w: string): string {
  if (w === "5m") return "+5m";
  if (w === "30m") return "+30m";
  if (w === "2h") return "+2h";
  if (w === "session_close") return "close";
  return w;
}

function MarketReactionBlock({
  reaction,
  demo,
}: {
  reaction: EventMarketReaction;
  demo?: boolean;
}) {
  return (
    <div
      className="catalyst-market-reaction"
      data-testid="catalyst-market-reaction"
    >
      <p className="catalyst-release-meta">
        {demo
          ? "Demo reaction pattern · Synthetic data"
          : "Observed reaction pattern · Rule-based classification of ETF proxy moves"}
      </p>
      <p className="catalyst-release-meta">
        Status {reaction.status} · rules {reaction.reactionRulesVersion} ·{" "}
        {reaction.provider}/{reaction.feed}
      </p>
      <p className="catalyst-release-meta">
        Event {formatWhen(reaction.eventTimestamp)} (UTC)
      </p>
      <table className="catalyst-mctx-table" data-testid="catalyst-mrxn-table">
        <thead>
          <tr>
            <th>Window</th>
            <th>Equities</th>
            <th>Leadership</th>
            <th>Cross-asset signature</th>
          </tr>
        </thead>
        <tbody>
          {reaction.windows.map((w) => (
            <tr key={w.window}>
              <td>{windowShort(w.window)}</td>
              <td>{w.equityBreadth.replace(/_/g, " ")}</td>
              <td>{w.equityLeadership.status.replace(/_/g, " ")}</td>
              <td className="catalyst-release-meta">
                {formatCrossAssetSignatureText(w.crossAssetSignature)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="catalyst-release-meta">
        Development: 5m→30m {reaction.development.from5mTo30m} · 30m→2h{" "}
        {reaction.development.from30mTo2h} · into close{" "}
        {reaction.development.intoSessionClose}
      </p>
      {reaction.observations.length > 0 ? (
        <ul className="catalyst-release-obs" data-testid="catalyst-mrxn-obs">
          {reaction.observations.map((o) => (
            <li key={o.id}>
              <span>{o.text}</span>
              <span className="catalyst-release-meta"> · {o.ruleId}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <details data-testid="catalyst-mrxn-details">
        <summary>Classification details (deadbands / pct / timestamps)</summary>
        {reaction.windows.map((w) => (
          <div key={w.window} className="catalyst-mrxn-detail">
            <p className="catalyst-release-meta">
              {windowShort(w.window)} · coverage {w.coverage.available}/
              {w.coverage.expected}
              {w.coverage.missingSymbols.length
                ? ` · missing ${w.coverage.missingSymbols.join(",")}`
                : ""}
            </p>
            <p className="catalyst-release-meta">
              {formatLeadershipText(w.equityLeadership)}
            </p>
            <ul className="catalyst-release-obs">
              {w.instruments.map((i) => (
                <li key={i.symbol}>
                  {i.symbol}: {i.direction}
                  {i.changePct !== undefined
                    ? ` ${formatPct(i.changePct)}`
                    : ""}{" "}
                  (deadband {i.deadbandPct}%) · {i.proxyLabel}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </details>
      <p className="catalyst-release-meta" data-testid="catalyst-mrxn-disclaimer">
        Deterministic display deadbands — not statistical significance. ETF
        proxies ≠ index / DXY / yields. Observed movement does not establish
        causation. Mixed/insufficient are conservative classifications, not
        errors.
      </p>
    </div>
  );
}

function CatalystRow({
  c,
  briefsByDocId,
  aiByBriefId,
  marketByCatalystId,
  reactionByCatalystId,
  demo,
}: {
  c: Catalyst;
  briefsByDocId: ReadonlyMap<string, OfficialBrief>;
  aiByBriefId: ReadonlyMap<string, OfficialAiBrief>;
  marketByCatalystId: ReadonlyMap<string, EventMarketContext>;
  reactionByCatalystId: ReadonlyMap<string, EventMarketReaction>;
  demo?: boolean;
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
        {marketByCatalystId.get(c.id) ? (
          <MarketContextBlock
            ctx={marketByCatalystId.get(c.id)!}
            demo={demo}
          />
        ) : null}
        {reactionByCatalystId.get(c.id) ? (
          <MarketReactionBlock
            reaction={reactionByCatalystId.get(c.id)!}
            demo={demo}
          />
        ) : null}
        {c.officialDocuments && c.officialDocuments.length > 0 ? (
          <OfficialDocumentBlock
            docs={c.officialDocuments}
            briefsByDocId={briefsByDocId}
            aiByBriefId={aiByBriefId}
            demo={demo}
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
  const aiByBriefId = new Map(
    (feed.aiBriefs ?? []).map((b) => [b.inputBriefId, b]),
  );
  const marketByCatalystId = new Map(
    (feed.marketContext ?? []).map((s) => [s.catalystId, s]),
  );
  const reactionByCatalystId = new Map(
    (feed.marketReactions ?? []).map((r) => [r.catalystId, r]),
  );
  const demo = feed.mode === "synthetic_demo" || feed.isPublicDemo;

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
        {feed.source.aiBriefs
          ? ` · aiBriefs:${feed.source.aiBriefs.status ?? (feed.source.aiBriefs.available ? "ok" : "missing")}`
          : ""}
        {feed.source.marketContext
          ? ` · mctx:${feed.source.marketContext.status ?? (feed.source.marketContext.available ? "ok" : "missing")}`
          : ""}
        {feed.source.marketReactions
          ? ` · mrxn:${feed.source.marketReactions.status ?? (feed.source.marketReactions.available ? "ok" : "missing")}`
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
            <CatalystRow
              key={c.id}
              c={c}
              briefsByDocId={briefsByDocId}
              aiByBriefId={aiByBriefId}
              marketByCatalystId={marketByCatalystId}
              reactionByCatalystId={reactionByCatalystId}
              demo={demo}
            />
          ))}
        </ul>
      )}

      {(feed.documents && feed.documents.length > 0) ||
      (feed.briefs && feed.briefs.length > 0) ? (
        <OfficialUpdates
          documents={feed.documents ?? []}
          briefs={feed.briefs ?? []}
          aiBriefs={feed.aiBriefs ?? []}
          demo={demo}
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
