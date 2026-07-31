import type { BoundedGammaProviderSnapshot } from "@/contracts";
import type { BoundedGammaDeskView } from "@/desk/load-bounded-gamma";
import {
  dteLabel,
  formatGexCompact,
  formatPct,
  formatSpot,
  gammaAvailabilityLabel,
  gammaRegimeLabel,
} from "@/desk/format-gamma";
import { GexStrikeChart } from "./GexStrikeChart";

const METHOD_NOTE =
  "Derived from one bounded expiration and strike range; not a full-option-chain market estimate. Some vendor Greeks may be excluded by data-quality checks.";

function WallCard({
  title,
  wall,
}: {
  title: string;
  wall: BoundedGammaProviderSnapshot["boundedCallWall"];
}) {
  const incomplete = wall.status === "incomplete";
  return (
    <div
      className={`gs-metric${incomplete ? " gs-metric-incomplete" : ""}`}
      data-testid={title.includes("Call") ? "bounded-call-wall" : "bounded-put-wall"}
    >
      <p className="gs-metric-label">{title}</p>
      {wall.status === "unavailable" ? (
        <p className="gs-metric-value gs-metric-muted">Unavailable</p>
      ) : (
        <>
          <p className="gs-metric-value">{wall.strike}</p>
          <p className="gs-metric-sub">
            {formatGexCompact(wall.gex ?? null)}
            {incomplete ? " · incomplete" : ""}
          </p>
        </>
      )}
    </div>
  );
}

function ReadyBody({
  snapshot,
  sourceLabel,
  isFixture,
}: {
  snapshot: BoundedGammaProviderSnapshot;
  sourceLabel: string;
  isFixture: boolean;
}) {
  const suspect = snapshot.coverage.suspectVendorGreeksCount ?? 0;
  const statusClass =
    snapshot.status === "incomplete"
      ? "gs-status gs-status-incomplete"
      : snapshot.status === "unavailable"
        ? "gs-status gs-status-unavailable"
        : snapshot.status === "partial"
          ? "gs-status gs-status-partial"
          : "gs-status gs-status-available";

  const plainLimitations = snapshot.limitations.filter(
    (l) =>
      /suspect|BOUNDED|bounded|excluded|incomplete|not full-chain|data-quality/i.test(
        l,
      ),
  );

  return (
    <>
      <header className="gs-header" data-testid="gamma-header">
        <div className="desk-driver-head">
          <p className="desk-kicker">Structure · Gamma</p>
          <span className="gs-scope-badge" data-testid="gamma-scope-badge">
            BOUNDED · SINGLE EXPIRY
          </span>
        </div>
        <h2 className="desk-title gs-title" id="gamma-heading">
          {snapshot.symbol} bounded GEX
        </h2>
        <p className="desk-meta gs-meta">
          <span>Source: MarketData.app</span>
          <span>asOf {snapshot.vendorAsOf}</span>
          <span>session {snapshot.sessionDate}</span>
          <span>exp {snapshot.expiration}</span>
          <span data-testid="gamma-dte">
            {dteLabel(snapshot.dte, snapshot.zeroDte.status)}
          </span>
          <span>spot {formatSpot(snapshot.spot)}</span>
          <span>
            strikes {snapshot.strikeRequest.min}–{snapshot.strikeRequest.max}{" "}
            step {snapshot.strikeRequest.step}
          </span>
          <span
            className={
              isFixture ? "desk-source desk-source-fixture" : "desk-source desk-source-live"
            }
          >
            {isFixture ? "fixture" : "local snapshot"}
          </span>
        </p>
        <p className="desk-section-note gs-method" data-testid="gamma-method-note">
          {METHOD_NOTE}
        </p>
      </header>

      <div className="gs-metrics" data-testid="gamma-metrics">
        <div className="gs-metric" data-testid="gamma-regime">
          <p className="gs-metric-label">Gamma regime</p>
          <p
            className={`gs-metric-value gs-regime-${snapshot.gammaRegime}`}
          >
            {gammaRegimeLabel(snapshot.gammaRegime)}
          </p>
          <p className="gs-metric-sub">Amplifier / compressor — not a buy/sell signal</p>
        </div>
        <div className="gs-metric">
          <p className="gs-metric-label">Total GEX</p>
          <p className="gs-metric-value">{formatGexCompact(snapshot.totalGex)}</p>
        </div>
        <div className="gs-metric">
          <p className="gs-metric-label">Gross GEX</p>
          <p className="gs-metric-value">{formatGexCompact(snapshot.grossGex)}</p>
        </div>
        <WallCard title="Bounded Call Wall" wall={snapshot.boundedCallWall} />
        <WallCard title="Bounded Put Wall" wall={snapshot.boundedPutWall} />
        <div className="gs-metric">
          <p className="gs-metric-label">Usable gamma coverage</p>
          <p className="gs-metric-value">
            {formatPct(snapshot.coverage.usableGammaCoveragePct)}
          </p>
          <p className="gs-metric-sub">
            {snapshot.coverage.usableGammaCount ?? "—"} /{" "}
            {snapshot.coverage.contractsIn} contracts
          </p>
        </div>
        <div className="gs-metric">
          <p className="gs-metric-label">Contracts</p>
          <p className="gs-metric-value">
            {snapshot.coverage.contractsUsed} used
          </p>
          <p className="gs-metric-sub">
            {snapshot.coverage.contractsIn} received ·{" "}
            {snapshot.coverage.contractsSkipped} skipped
          </p>
        </div>
      </div>

      <section
        className={`gs-quality ${statusClass}`}
        data-testid="gamma-quality"
        aria-labelledby="gamma-quality-heading"
      >
        <h3 id="gamma-quality-heading" className="gs-quality-title">
          Data quality
        </h3>
        <p className="gs-quality-status" data-testid="gamma-availability">
          Availability: {gammaAvailabilityLabel(snapshot.status)}
        </p>
        <ul className="gs-quality-list">
          <li>
            Non-null gamma coverage:{" "}
            {formatPct(snapshot.coverage.nonNullGammaCoveragePct)} (
            {snapshot.coverage.nonNullGammaCount ?? "—"})
          </li>
          <li>
            Usable gamma coverage:{" "}
            {formatPct(snapshot.coverage.usableGammaCoveragePct)} (
            {snapshot.coverage.usableGammaCount ?? "—"})
          </li>
          <li data-testid="gamma-suspect-count">
            suspect_vendor_greeks excluded: {suspect}
          </li>
        </ul>
        {plainLimitations.length > 0 ? (
          <ul className="gs-limitations" data-testid="gamma-limitations">
            {plainLimitations.slice(0, 4).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="gs-chart-section" aria-labelledby="gex-chart-heading">
        <h3 id="gex-chart-heading" className="gs-quality-title">
          Strike GEX (bounded sample)
        </h3>
        <GexStrikeChart snapshot={snapshot} />
        <details className="desk-fold gs-table-fold">
          <summary>Strike table</summary>
          <div className="gs-table-scroll">
            <table className="desk-table" data-testid="gex-strike-table">
              <thead>
                <tr>
                  <th>Strike</th>
                  <th>Call GEX</th>
                  <th>Put GEX</th>
                  <th>Net GEX</th>
                  <th>Gross GEX</th>
                  <th>Call OI</th>
                  <th>Put OI</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.byStrike.map((row) => (
                  <tr key={row.strike}>
                    <td>{row.strike}</td>
                    <td>{formatGexCompact(row.callGex)}</td>
                    <td>{formatGexCompact(row.putGex)}</td>
                    <td>{formatGexCompact(row.netGex)}</td>
                    <td>
                      {formatGexCompact(
                        Math.abs(row.callGex) + Math.abs(row.putGex),
                      )}
                    </td>
                    <td>{row.callOpenInterest}</td>
                    <td>{row.putOpenInterest}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>

      <p className="desk-section-note">
        Snapshot path label: <code>{sourceLabel}</code>
      </p>
    </>
  );
}

export function GammaDesk({ view }: { view: BoundedGammaDeskView }) {
  if (view.status === "empty") {
    return (
      <section
        className="desk-section gs-section"
        data-testid="gamma-state-empty"
        aria-labelledby="gamma-heading"
      >
        <p className="desk-kicker">Structure · Gamma</p>
        <h2 id="gamma-heading" className="desk-title gs-title">
          Bounded gamma
        </h2>
        <p className="desk-interpretation">
          {view.error?.message ??
            "No bounded gamma snapshot is available for this desk."}
        </p>
        <p className="desk-section-note">{METHOD_NOTE}</p>
      </section>
    );
  }

  if (view.status === "malformed") {
    return (
      <section
        className="desk-section gs-section"
        data-testid="gamma-state-malformed"
        aria-labelledby="gamma-heading"
      >
        <p className="desk-kicker">Structure · Gamma</p>
        <h2 id="gamma-heading" className="desk-title gs-title">
          Bounded gamma unavailable
        </h2>
        <p className="desk-banner desk-banner-error">
          {view.error?.message ?? "Malformed bounded gamma snapshot."}
        </p>
        <p className="desk-section-note">{METHOD_NOTE}</p>
      </section>
    );
  }

  if (view.status === "unavailable" || view.snapshot === null) {
    return (
      <section
        className="desk-section gs-section"
        data-testid="gamma-state-unavailable"
        aria-labelledby="gamma-heading"
      >
        <p className="desk-kicker">Structure · Gamma</p>
        <h2 id="gamma-heading" className="desk-title gs-title">
          Bounded gamma unavailable
        </h2>
        <p className="desk-interpretation">
          {view.error?.message ??
            "Bounded gamma calculation is unavailable for this snapshot."}
        </p>
        <p className="desk-section-note">{METHOD_NOTE}</p>
      </section>
    );
  }

  return (
    <section
      className="desk-section gs-section"
      data-testid="gamma-state-ready"
      aria-labelledby="gamma-heading"
    >
      <ReadyBody
        snapshot={view.snapshot}
        sourceLabel={view.sourceLabel}
        isFixture={view.isFixture}
      />
    </section>
  );
}
