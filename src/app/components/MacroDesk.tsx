import type { DominantDriver } from "@/contracts";
import type { CatalystFeed as CatalystFeedDto } from "@/contracts";
import type { BoundedGammaDeskView, MacroDeskView } from "@/desk";
import {
  assetDisplayName,
  confidenceComponentLabel,
  formatConfidenceScore,
  formatSignedChange,
  formatZScore,
  isFallbackRegime,
  polarityLabel,
  regimeLabel,
  riskDirectionLabel,
  roleLabel,
  sessionAlignmentLabel,
  sessionBannerText,
  deriveAssetRiskLight,
  deriveDriverRiskLight,
} from "@/desk";
import { CatalystFeed } from "./CatalystFeed";
import { DeskChrome } from "./DeskChrome";
import { DeskStatusBanners } from "./DeskStatusBanners";
import { GammaDesk } from "./gamma/GammaDesk";
import { RiskTrafficLight } from "./RiskTrafficLight";

function DriverBody({
  driver,
  sourceLabel,
  isDemo,
  isPublicDemo,
}: {
  driver: DominantDriver;
  sourceLabel: string;
  isDemo: boolean;
  isPublicDemo: boolean;
}) {
  const contradictionSet = new Set(driver.contradictions);
  const evidenceById = new Map(driver.evidence.map((e) => [e.id, e]));
  const showAsFixture = isDemo || isPublicDemo;
  const driverLight = deriveDriverRiskLight({
    primaryRegime: driver.primaryRegime,
    riskDirection: driver.riskDirection,
    confidenceScore: driver.confidence.score,
    zeroedBy: driver.confidence.zeroedBy,
  });

  const sortedAssets = [...driver.assets].sort((a, b) => {
    const rank = (role: typeof a.role) =>
      role === "confirming"
        ? 0
        : role === "contradicting"
          ? 1
          : role === "neutral"
            ? 2
            : 3;
    return rank(a.role) - rank(b.role);
  });

  return (
    <>
      {!isPublicDemo ? (
        <p className="desk-banner desk-banner-compact" data-testid="banner-session">
          {sessionBannerText(driver)}
          <span className="desk-banner-meta">
            · {sessionAlignmentLabel(driver.sessionAlignment)}
            {driver.isCompleteSession ? "" : " · incomplete"}
            {" · "}
            <span
              className={
                showAsFixture
                  ? "desk-source desk-source-fixture"
                  : "desk-source desk-source-live"
              }
              data-desk-source={showAsFixture ? "fixture" : "local_driver"}
            >
              {sourceLabel}
            </span>
          </span>
        </p>
      ) : null}

      <section className="desk-driver" aria-labelledby="driver-heading">
        <div className="desk-driver-head">
          <p className="desk-kicker">
            {isFallbackRegime(driver.primaryRegime)
              ? "No single driver"
              : "Dominant driver"}
          </p>
          <RiskTrafficLight light={driverLight} testId="driver-risk-light" />
        </div>
        <h1 id="driver-heading" className="desk-title">
          {driver.label}
        </h1>
        <p className="desk-meta">
          <span>{regimeLabel(driver.primaryRegime)}</span>
          {driver.polarity ? <span>{polarityLabel(driver.polarity)}</span> : null}
          {driver.riskDirection ? (
            <span>{riskDirectionLabel(driver.riskDirection)}</span>
          ) : null}
        </p>
        <p className="desk-confidence">
          {formatConfidenceScore(driver.confidence)}
        </p>
        <p className="desk-interpretation">{driver.interpretation.text}</p>
      </section>

      <section className="desk-section desk-section-tight" aria-labelledby="assets-heading">
        <h2 id="assets-heading">Cross-asset moves</h2>
        <p className="desk-section-note">
          Normalized change and z-score from the compute snapshot. Risk lights
          reflect high-beta implication — not bare up/down.
        </p>
        <table className="desk-table">
          <thead>
            <tr>
              <th scope="col">Asset</th>
              <th scope="col">Risk</th>
              <th scope="col">Change</th>
              <th scope="col">z</th>
              <th scope="col">Role</th>
            </tr>
          </thead>
          <tbody>
            {sortedAssets.map((asset) => {
              const assetLight = deriveAssetRiskLight({
                symbol: asset.symbol,
                zScore: asset.zScore,
                role: asset.role,
                staleDays: asset.staleDays,
              });
              return (
                <tr key={asset.symbol} data-role={asset.role}>
                  <td>
                    <span className="desk-asset-name">
                      {assetDisplayName(asset)}
                    </span>
                    {asset.staleDays !== null && asset.staleDays > 0 ? (
                      <span className="desk-stale">
                        {" "}
                        stale {asset.staleDays}d
                      </span>
                    ) : null}
                  </td>
                  <td>
                    <RiskTrafficLight
                      light={assetLight}
                      compact
                      testId={`asset-risk-light-${asset.symbol}`}
                    />
                  </td>
                  <td>{formatSignedChange(asset.value, asset.unit)}</td>
                  <td>{formatZScore(asset.zScore)}</td>
                  <td>{roleLabel(asset.role)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <details className="desk-fold" data-testid="fold-evidence">
        <summary>Evidence</summary>
        <ul className="desk-evidence">
          {driver.evidence.map((ev) => (
            <li
              key={ev.id}
              className={
                contradictionSet.has(ev.id) ? "desk-evidence-contra" : undefined
              }
            >
              <span className="desk-evidence-mark">
                {contradictionSet.has(ev.id) ? "Contra" : "For"}
              </span>
              {ev.statement}
              {ev.isProxy ? (
                <span className="desk-proxy"> · via {ev.instrument}</span>
              ) : null}
            </li>
          ))}
        </ul>
        {driver.interpretation.evidenceIds.length > 0 ? (
          <p className="desk-section-note">
            Cited:{" "}
            {driver.interpretation.evidenceIds
              .map((id) => evidenceById.get(id)?.symbol ?? id)
              .join(", ")}
          </p>
        ) : null}
      </details>

      <details className="desk-fold" data-testid="fold-confidence">
        <summary>Confidence components</summary>
        <p className="desk-section-note">
          Score copied from the interpretation payload
          {driver.confidence.calibrated
            ? "."
            : "; band labels withheld while uncalibrated."}
        </p>
        <ul className="desk-components">
          {driver.confidence.components.map((c) => (
            <li key={c.name}>
              <span>{confidenceComponentLabel(c.name)}</span>
              <span>
                {(c.value * 100).toFixed(0)}% · w={c.weight.toFixed(2)}
              </span>
            </li>
          ))}
        </ul>
        {driver.confidence.hardCapsApplied.length > 0 ? (
          <ul className="desk-caps">
            {driver.confidence.hardCapsApplied.map((cap) => (
              <li key={`${cap.rule}-${cap.cappedAt}`}>
                Cap {cap.rule} ≤ {cap.cappedAt} — {cap.basis}
              </li>
            ))}
          </ul>
        ) : null}
      </details>

      <details className="desk-fold" data-testid="fold-diagnostics">
        <summary>Diagnostics</summary>
        <p className="desk-section-note" data-testid="diagnostics-session">
          Session {driver.marketSessionDate} ·{" "}
          {sessionAlignmentLabel(driver.sessionAlignment)}
          {driver.isCompleteSession ? "" : " · incomplete"}
          {isPublicDemo ? " · synthetic" : ` · ${sourceLabel}`}
        </p>
        {driver.confidence.detail.runnerUpRegime ? (
          <p className="desk-section-note">
            Runner-up: {regimeLabel(driver.confidence.detail.runnerUpRegime)} ·
            effective confirmations{" "}
            {driver.confidence.detail.effectiveConfirmations}
          </p>
        ) : null}
        {driver.confidence.hardCapsApplied.length > 0 ? (
          <ul className="desk-caps">
            {driver.confidence.hardCapsApplied.map((cap) => (
              <li key={`diag-${cap.rule}-${cap.cappedAt}`}>
                Cap {cap.rule} ≤ {cap.cappedAt} — {cap.basis}
              </li>
            ))}
          </ul>
        ) : (
          <p className="desk-section-note">No hard caps applied.</p>
        )}
      </details>
    </>
  );
}

export function MacroDesk({
  view,
  catalystFeed,
  gammaView,
  gammaViews,
  demoMode,
}: {
  view: MacroDeskView;
  catalystFeed?: CatalystFeedDto | null;
  gammaView?: BoundedGammaDeskView | null;
  gammaViews?: readonly BoundedGammaDeskView[];
  demoMode?: boolean;
}) {
  const gammaPanels =
    gammaViews ?? (gammaView ? [gammaView] : []);

  function GammaSection() {
    return (
      <>
        {gammaPanels.map((panel) => (
          <GammaDesk
            key={panel.snapshot?.symbol ?? panel.sourceLabel}
            view={panel}
          />
        ))}
      </>
    );
  }
  if (view.status === "live_unavailable") {
    return (
      <DeskChrome activeNav="macro" demoMode={demoMode}>
        <DeskStatusBanners view={view} />
        <section className="desk-state" data-testid="state-live-unavailable">
          <h1 className="desk-title">Live data unavailable</h1>
          <p className="desk-interpretation">
            {view.error?.message ??
              "This deployment does not serve live drivers for this request."}
          </p>
          <p className="desk-section-note">
            Open <a href="/demo">the synthetic demo</a> for the illustrative
            scenario fixture, or configure live credentials and local{" "}
            <code>data/drivers</code> for current mode.
          </p>
        </section>
      </DeskChrome>
    );
  }

  if (view.status === "empty" || (view.driver === null && !view.error)) {
    return (
      <DeskChrome activeNav="macro" demoMode={demoMode}>
        <DeskStatusBanners view={view} />
        {gammaPanels.length > 0 ? <GammaSection /> : null}
        <section className="desk-state" data-testid="state-empty">
          <h1 className="desk-title">No macro driver</h1>
          <p className="desk-interpretation">
            {view.error?.message ??
              "No live driver and fixture fallback is disabled. Run npm run daily after configuring .env."}
          </p>
        </section>
      </DeskChrome>
    );
  }

  if (view.driver === null) {
    return (
      <DeskChrome activeNav="macro" demoMode={demoMode}>
        <DeskStatusBanners view={view} />
        {gammaPanels.length > 0 ? <GammaSection /> : null}
        <section
          className="desk-state"
          data-testid={`state-${view.status}`}
        >
          <h1 className="desk-title">
            {view.status === "malformed"
              ? "Malformed live driver"
              : "Pipeline error"}
          </h1>
          <p className="desk-interpretation">
            {view.error?.message ??
              "The desk cannot render a DominantDriver payload."}
          </p>
          <p className="desk-section-note">
            UI does not classify or recompute confidence. Fix the pipeline or
            restore a valid driver under data/drivers/.
          </p>
        </section>
      </DeskChrome>
    );
  }

  return (
    <DeskChrome activeNav="macro" demoMode={demoMode}>
      <DeskStatusBanners view={view} />
      {gammaPanels.length > 0 ? <GammaSection /> : null}
      <div data-testid={`state-${view.status}`}>
        <DriverBody
          driver={view.driver}
          sourceLabel={view.sourceLabel ?? "unknown"}
          isDemo={view.isDemo}
          isPublicDemo={view.isPublicDemo}
        />
      </div>
      {catalystFeed ? (
        <CatalystFeed feed={catalystFeed} suppressDemoChrome={view.isPublicDemo} />
      ) : null}
    </DeskChrome>
  );
}

export function DeskLoading() {
  return (
    <DeskChrome activeNav="macro">
      <p className="desk-banner" data-testid="state-loading">
        Loading macro desk…
      </p>
      <section className="desk-state">
        <div className="desk-skeleton desk-skeleton-title" />
        <div className="desk-skeleton desk-skeleton-line" />
        <div className="desk-skeleton desk-skeleton-line short" />
      </section>
    </DeskChrome>
  );
}
