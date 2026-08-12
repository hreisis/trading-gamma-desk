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
import { gammaRegimeRiskLight } from "../signal-display";
import { RiskTrafficLight } from "../RiskTrafficLight";
import { GexProfileChart } from "./GexProfileChart";
import { GexStrikeChart } from "./GexStrikeChart";
import {
  gammaRegimeSignLabel,
  gammaRegimeStabilityLabel,
  readGammaFlipStrike,
} from "./gamma-regime-display";

const METHOD_NOTE =
  "Derived from one bounded expiration and strike range; not a full-option-chain market estimate.";

function wallValue(
  wall: BoundedGammaProviderSnapshot["boundedCallWall"],
): string {
  if (wall.status !== "available") return "—";
  return formatSpot(wall.strike);
}

function KeyLevelsStrip({
  snapshot,
  flipStrike,
}: {
  snapshot: BoundedGammaProviderSnapshot;
  flipStrike: number | null;
}) {
  return (
    <dl className="gex-key-levels" data-testid="gamma-key-levels">
      <div className="gex-key-level">
        <dt>Spot</dt>
        <dd className="gex-key-value" data-testid="gamma-spot">
          {formatSpot(snapshot.spot)}
        </dd>
      </div>
      <div className="gex-key-level">
        <dt>Call Wall</dt>
        <dd
          className="gex-key-value gex-key-call"
          data-testid="bounded-call-wall"
        >
          {wallValue(snapshot.boundedCallWall)}
        </dd>
      </div>
      <div className="gex-key-level">
        <dt>Put Wall</dt>
        <dd
          className="gex-key-value gex-key-put"
          data-testid="bounded-put-wall"
        >
          {wallValue(snapshot.boundedPutWall)}
        </dd>
      </div>
      <div className="gex-key-level">
        <dt>Gamma Flip</dt>
        <dd className="gex-key-value" data-testid="gamma-flip">
          {flipStrike !== null ? formatSpot(flipStrike) : "—"}
        </dd>
      </div>
    </dl>
  );
}

function CompactBody({
  snapshot,
  sourceLabel,
  isFixture,
  variant,
  stateTestId = "gamma-state-ready",
}: {
  snapshot: BoundedGammaProviderSnapshot;
  sourceLabel: string;
  isFixture: boolean;
  variant: "spy" | "qqq" | "default";
  stateTestId?: string;
}) {
  const suspect = snapshot.coverage.suspectVendorGreeksCount ?? 0;
  const regimeLight = gammaRegimeRiskLight(snapshot.gammaRegime);
  const flipStrike = readGammaFlipStrike(snapshot);
  const panelClass =
    variant === "spy"
      ? "gamma-panel gamma-panel--spy"
      : variant === "qqq"
        ? "gamma-panel gamma-panel--qqq"
        : "gamma-panel";

  return (
    <article
      className={`signal-gamma-card ${panelClass}`}
      data-testid={stateTestId}
    >
      <header className="gex-profile-header" data-testid="gamma-header">
        <div className="gex-profile-header-left">
          <h3
            className="gex-profile-symbol"
            id={`gamma-heading-${snapshot.symbol}`}
          >
            {snapshot.symbol}
          </h3>
          <p className="gex-profile-spot-large">{formatSpot(snapshot.spot)}</p>
        </div>
        <div className="gex-profile-header-right">
          <p className="gex-profile-stability" data-testid="gamma-regime">
            {gammaRegimeStabilityLabel(snapshot.gammaRegime)}
          </p>
          <p className="gex-profile-sign">
            {gammaRegimeSignLabel(snapshot.gammaRegime)}
          </p>
          <RiskTrafficLight light={regimeLight} compact testId="gamma-regime-light" />
        </div>
      </header>

      <KeyLevelsStrip snapshot={snapshot} flipStrike={flipStrike} />

      <GexProfileChart snapshot={snapshot} />

      <footer className="gex-profile-footer" data-testid="gamma-metrics">
        <span>
          Put Wall <strong>{wallValue(snapshot.boundedPutWall)}</strong>
        </span>
        <span className="gex-profile-footer-sep">|</span>
        <span>
          Spot <strong>{formatSpot(snapshot.spot)}</strong>
        </span>
        <span className="gex-profile-footer-sep">|</span>
        <span>
          Call Wall <strong>{wallValue(snapshot.boundedCallWall)}</strong>
        </span>
        <span className="gex-profile-footer-sep">|</span>
        <span>
          Flip <strong data-testid="gamma-flip-footer">{flipStrike !== null ? formatSpot(flipStrike) : "—"}</strong>
        </span>
      </footer>

      <details className="desk-fold signal-gamma-details">
        <summary>Details &amp; diagnostics</summary>
        <span className="gs-scope-badge visually-hidden" data-testid="gamma-scope-badge">
          BOUNDED · SINGLE EXPIRY
        </span>
        <p className="signal-gamma-scope-note">
          BOUNDED · SINGLE EXPIRY · {gammaRegimeLabel(snapshot.gammaRegime)} ·{" "}
          {dteLabel(snapshot.dte, snapshot.zeroDte.status)} · exp {snapshot.expiration}
        </p>
        <p
          className="terminal-gamma-availability"
          data-testid="gamma-availability"
        >
          {gammaAvailabilityLabel(snapshot.status)}
          {suspect > 0 ? ` · suspect_vendor_greeks excluded: ${suspect}` : ""}
        </p>
        <p className="desk-section-note gs-method" data-testid="gamma-method-note">
          {METHOD_NOTE}
        </p>
        <div className="signal-gamma-extra-stats">
          <span>Total GEX {formatGexCompact(snapshot.totalGex)}</span>
          <span>Coverage {formatPct(snapshot.coverage.usableGammaCoveragePct)}</span>
          <span>
            Bounded Call Wall{" "}
            {snapshot.boundedCallWall.status === "available"
              ? snapshot.boundedCallWall.strike
              : "—"}
          </span>
          <span>
            Bounded Put Wall{" "}
            {snapshot.boundedPutWall.status === "available"
              ? snapshot.boundedPutWall.strike
              : "—"}
          </span>
        </div>
        <p className="terminal-gamma-meta-full">
          Source: MarketData.app · asOf {snapshot.vendorAsOf} · session{" "}
          {snapshot.sessionDate}
          <span className="terminal-gamma-meta-sep">·</span>
          strikes {snapshot.strikeRequest.min}–{snapshot.strikeRequest.max}
          <span className="terminal-gamma-meta-sep">·</span>
          <span
            className={
              isFixture ? "desk-source desk-source-fixture" : "desk-source desk-source-live"
            }
          >
            {isFixture ? "fixture" : "live"}
          </span>
        </p>
        <div className="terminal-gamma-chart">
          <GexStrikeChart snapshot={snapshot} />
        </div>
        <div className="gs-table-scroll">
          <table className="terminal-table" data-testid="gex-strike-table">
            <thead>
              <tr>
                <th>Strike</th>
                <th>Net GEX</th>
                <th>Call OI</th>
                <th>Put OI</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.byStrike.map((row) => (
                <tr key={row.strike}>
                  <td>{row.strike}</td>
                  <td>{formatGexCompact(row.netGex)}</td>
                  <td>{row.callOpenInterest}</td>
                  <td>{row.putOpenInterest}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="desk-section-note">
          <code>{sourceLabel}</code>
        </p>
      </details>
    </article>
  );
}

function EmptyState({
  title,
  message,
  testId,
  variant,
}: {
  title: string;
  message: string;
  testId: string;
  variant: "spy" | "qqq" | "default";
}) {
  const panelClass =
    variant === "spy"
      ? "gamma-panel gamma-panel--spy"
      : variant === "qqq"
        ? "gamma-panel gamma-panel--qqq"
        : "gamma-panel";
  return (
    <article
      className={`signal-gamma-card signal-gamma-card-empty ${panelClass}`}
      data-testid={testId}
    >
      <h3 className="gex-profile-symbol">{title}</h3>
      <p className="terminal-state-copy">{message}</p>
    </article>
  );
}

function gammaVariant(symbol: string | undefined): "spy" | "qqq" | "default" {
  if (symbol === "SPY") return "spy";
  if (symbol === "QQQ") return "qqq";
  return "default";
}

export function GammaDesk({
  view,
  compact = false,
}: {
  view: BoundedGammaDeskView;
  compact?: boolean;
}) {
  const variant = gammaVariant(view.snapshot?.symbol);

  if (view.status === "empty") {
    return (
      <EmptyState
        testId="gamma-state-empty"
        title="Bounded gamma"
        message={
          view.error?.message ??
          "No bounded gamma snapshot is available for this desk."
        }
        variant={variant}
      />
    );
  }

  if (view.status === "malformed") {
    return (
      <EmptyState
        testId="gamma-state-malformed"
        title="Unavailable"
        message={view.error?.message ?? "Malformed bounded gamma snapshot."}
        variant={variant}
      />
    );
  }

  if (view.status === "unavailable" || view.snapshot === null) {
    return (
      <EmptyState
        testId="gamma-state-unavailable"
        title="Unavailable"
        message={
          view.error?.message ??
          "Bounded gamma calculation is unavailable for this snapshot."
        }
        variant={variant}
      />
    );
  }

  const stateTestId =
    view.status === "incomplete" ? "gamma-state-incomplete" : "gamma-state-ready";

  return (
    <CompactBody
      snapshot={view.snapshot}
      sourceLabel={view.sourceLabel}
      isFixture={view.isFixture}
      variant={variant}
      stateTestId={stateTestId}
    />
  );
}
