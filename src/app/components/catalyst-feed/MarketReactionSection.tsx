import type {
  CatalystFeed as CatalystFeedDto,
  PublicAiMarketReactionNarrative,
  PublicEventMarketContext,
  PublicEventMarketReaction,
} from "@/contracts";
import {
  buildReactionEvidencePack,
  formatCrossAssetSignatureText,
  marketContextIdentity,
} from "@/catalyst";
import {
  deriveMarketReactionUiState,
  formatEquityBreadthLabel,
  formatLeadershipLabel,
  type MarketReactionUiState,
} from "@/catalyst/feed-view";
import type { EventMarketContext } from "@/contracts";
import { formatPct, windowShort } from "./format";

function ReactionUnavailable({
  state,
}: {
  state: MarketReactionUiState;
}) {
  const cls =
    state.kind === "awaiting"
      ? "cf-mrxn-state cf-mrxn-awaiting"
      : "cf-mrxn-state cf-mrxn-unavailable";
  return (
    <p className={cls} data-testid="catalyst-mrxn-state">
      {state.message}
    </p>
  );
}

function coreWindowOf(reaction: PublicEventMarketReaction) {
  return (
    reaction.windows.find((w) => w.window === "30m") ??
    reaction.windows.find((w) => w.window === "5m") ??
    reaction.windows[0]
  );
}

function ReactionSummary({
  reaction,
  context,
  ai,
  demo,
  compact,
}: {
  reaction: PublicEventMarketReaction;
  context?: PublicEventMarketContext;
  ai?: PublicAiMarketReactionNarrative;
  demo?: boolean;
  compact?: boolean;
}) {
  const coreWindow = coreWindowOf(reaction);

  const showAi =
    ai &&
    (ai.status === "complete" || ai.status === "partial") &&
    Boolean(ai.headline) &&
    Boolean(ai.bullets?.length);

  const evidenceById = new Map(
    context
      ? buildReactionEvidencePack(
          context as EventMarketContext,
          reaction as Parameters<typeof buildReactionEvidencePack>[1],
          marketContextIdentity(context as EventMarketContext),
          reaction.id,
        ).map((e) => [e.evidenceId, e])
      : [],
  );

  if (compact) {
    return (
      <div data-testid="catalyst-market-reaction">
        {showAi ? (
          <p className="cf-brief-headline" data-testid="catalyst-ai-market-reaction">
            {ai.headline}
          </p>
        ) : null}
        {coreWindow ? (
          <p className="cf-mrxn-lede" data-testid="catalyst-mrxn-core">
            <strong>{windowShort(coreWindow.window)}</strong>
            {" · "}
            {formatEquityBreadthLabel(coreWindow.equityBreadth)}
            {" · "}
            {formatLeadershipLabel(coreWindow.equityLeadership.status)}
          </p>
        ) : (
          <p className="cf-mrxn-state cf-mrxn-unavailable" data-testid="catalyst-mrxn-state">
            Market reaction unavailable
          </p>
        )}
      </div>
    );
  }

  return (
    <div data-testid="catalyst-market-reaction">
      {showAi ? (
        <div
          className="cf-mrxn-ai"
          data-testid="catalyst-ai-market-reaction"
        >
          <p className="cf-brief-kicker">
            {demo ? "Demo AI reaction" : "AI reaction"} · {ai.status}
          </p>
          <p className="cf-brief-headline">{ai.headline}</p>
          <ul className="cf-citations">
            {(ai.bullets ?? []).slice(0, 3).map((b) => (
              <li key={b.id}>
                <span className="cf-citation-text">{b.text}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {coreWindow ? (
        <div className="cf-mrxn-core" data-testid="catalyst-mrxn-core">
          <p className="cf-mrxn-lede">
            <strong>{windowShort(coreWindow.window)}</strong>
            {" · "}
            {formatEquityBreadthLabel(coreWindow.equityBreadth)}
            {" · "}
            {formatLeadershipLabel(coreWindow.equityLeadership.status)}
          </p>
          <p className="cf-panel-note">
            {formatCrossAssetSignatureText(coreWindow.crossAssetSignature)}
          </p>
        </div>
      ) : null}

      {reaction.observations.length > 0 ? (
        <ul className="cf-citations" data-testid="catalyst-mrxn-obs">
          {reaction.observations.slice(0, 3).map((o) => (
            <li key={o.id}>
              <span className="cf-citation-text">{o.text}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <details className="cf-details" data-testid="catalyst-mrxn-details">
        <summary>Full reaction windows &amp; ETF proxies</summary>
        <table className="catalyst-mctx-table" data-testid="catalyst-mrxn-table">
          <thead>
            <tr>
              <th>Window</th>
              <th>Equities</th>
              <th>Leadership</th>
              <th>Cross-asset</th>
            </tr>
          </thead>
          <tbody>
            {reaction.windows.map((w) => (
              <tr key={w.window}>
                <td>{windowShort(w.window)}</td>
                <td>{formatEquityBreadthLabel(w.equityBreadth)}</td>
                <td>{formatLeadershipLabel(w.equityLeadership.status)}</td>
                <td className="cf-panel-note">
                  {formatCrossAssetSignatureText(w.crossAssetSignature)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {context ? (
          <table className="catalyst-mctx-table" data-testid="catalyst-mctx-table">
            <thead>
              <tr>
                <th>ETF</th>
                <th>+5m</th>
                <th>+30m</th>
                <th>+2h</th>
                <th>Close</th>
              </tr>
            </thead>
            <tbody>
              {context.symbols.map((s) => {
                const byKind = new Map(s.windows.map((w) => [w.kind, w]));
                return (
                  <tr key={s.symbol}>
                    <td>{s.symbol}</td>
                    <td>{formatPct(byKind.get("plus5m")?.pctChange)}</td>
                    <td>{formatPct(byKind.get("plus30m")?.pctChange)}</td>
                    <td>{formatPct(byKind.get("plus2h")?.pctChange)}</td>
                    <td>{formatPct(byKind.get("sessionClose")?.pctChange)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : null}
        {showAi && ai?.bullets ? (
          <ul className="cf-citations">
            {ai.bullets.map((b) => (
              <li key={b.id}>
                <span className="cf-citation-text">{b.text}</span>
                {b.evidenceIds.map((eid) => {
                  const ev = evidenceById.get(eid);
                  if (!ev) return null;
                  return (
                    <p
                      key={eid}
                      className="cf-citation-ref"
                      data-testid="catalyst-ai-mrxn-evidence"
                    >
                      {eid}
                      {ev.symbol ? ` (${ev.symbol})` : ""}
                      {ev.kind === "changePct" && typeof ev.value === "number"
                        ? ` · ${formatPct(ev.value)}`
                        : ""}
                    </p>
                  );
                })}
              </li>
            ))}
          </ul>
        ) : null}
        <p className="cf-panel-note" data-testid="catalyst-mrxn-disclaimer">
          ETF proxies only. Observed movement does not establish causation.
          Deadbands are display thresholds — not statistical significance.
        </p>
      </details>
    </div>
  );
}

export function MarketReactionSection({
  feed,
  catalystStatus,
  context,
  reaction,
  ai,
  demo,
  compact,
}: {
  feed: CatalystFeedDto;
  catalystStatus: string;
  context?: PublicEventMarketContext;
  reaction?: PublicEventMarketReaction;
  ai?: PublicAiMarketReactionNarrative;
  demo?: boolean;
  compact?: boolean;
}) {
  const mctxMeta = feed.source.marketContext;
  const mrxnMeta = feed.source.marketReactions;
  const state = deriveMarketReactionUiState({
    catalystStatus,
    hasMarketContext: Boolean(context),
    marketContextStatus: context?.status,
    hasReaction: Boolean(reaction),
    feedMarketContextAvailable: mctxMeta?.available ?? false,
    feedMarketContextStatus: mctxMeta?.status,
    feedMarketReactionsStatus: mrxnMeta?.status,
  });

  return (
    <div
      className={`cf-panel${compact ? " cf-panel-compact" : ""}`}
      data-testid="catalyst-market-reaction-panel"
    >
      <h4 className="cf-panel-title">Market reaction</h4>
      {state.kind === "available" && reaction ? (
        <ReactionSummary
          reaction={reaction}
          context={context}
          ai={ai}
          demo={demo}
          compact={compact}
        />
      ) : (
        <ReactionUnavailable state={state} />
      )}
    </div>
  );
}
