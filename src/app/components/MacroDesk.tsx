import type { DominantDriver } from "@/contracts";
import type { MacroDeskView } from "@/desk";
import {
  assetDisplayName,
  formatConfidenceScore,
  formatSignedChange,
  formatZScore,
  isFallbackRegime,
  roleLabel,
  sessionBannerText,
} from "@/desk";
import { DeskChrome } from "./DeskChrome";
import { DeskStatusBanners } from "./DeskStatusBanners";

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
      <p className="desk-banner" data-testid="banner-session">
        {isPublicDemo ? (
          <>
            Synthetic scenario
            <span className="desk-banner-meta">
              {" · "}
              <span
                className="desk-source desk-source-fixture"
                data-desk-source="fixture"
              >
                {sourceLabel}
              </span>
            </span>
          </>
        ) : (
          <>
            {sessionBannerText(driver)}
            <span className="desk-banner-meta">
              · {driver.sessionAlignment}
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
          </>
        )}
      </p>

      <section className="desk-driver" aria-labelledby="driver-heading">
        <p className="desk-kicker">
          {isFallbackRegime(driver.primaryRegime)
            ? "No single driver"
            : "Dominant driver"}
        </p>
        <h1 id="driver-heading" className="desk-title">
          {driver.label}
        </h1>
        <p className="desk-meta">
          <span>{driver.primaryRegime}</span>
          {driver.polarity ? <span>{driver.polarity}</span> : null}
          {driver.riskDirection ? <span>{driver.riskDirection}</span> : null}
        </p>
        <p className="desk-confidence">
          {formatConfidenceScore(driver.confidence)}
        </p>
        <p className="desk-interpretation">{driver.interpretation.text}</p>
      </section>

      <section className="desk-section" aria-labelledby="assets-heading">
        <h2 id="assets-heading">Cross-asset moves</h2>
        <p className="desk-section-note">
          Normalized change and z-score from the compute snapshot — not
          recomputed in the UI.
        </p>
        <table className="desk-table">
          <thead>
            <tr>
              <th scope="col">Asset</th>
              <th scope="col">Change</th>
              <th scope="col">z</th>
              <th scope="col">Role</th>
              <th scope="col">Source date</th>
            </tr>
          </thead>
          <tbody>
            {sortedAssets.map((asset) => (
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
                <td>{formatSignedChange(asset.value, asset.unit)}</td>
                <td>{formatZScore(asset.zScore)}</td>
                <td>{roleLabel(asset.role)}</td>
                <td>
                  {isPublicDemo ? "synthetic" : (asset.sourceDate ?? "—")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="desk-section" aria-labelledby="evidence-heading">
        <h2 id="evidence-heading">Evidence</h2>
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
      </section>

      <section className="desk-section" aria-labelledby="confidence-heading">
        <h2 id="confidence-heading">Confidence components</h2>
        <p className="desk-section-note">
          Score copied from the interpretation payload
          {driver.confidence.calibrated
            ? "."
            : "; band labels withheld while uncalibrated."}
        </p>
        <ul className="desk-components">
          {driver.confidence.components.map((c) => (
            <li key={c.name}>
              <span>{c.name}</span>
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
        {driver.confidence.detail.runnerUpRegime ? (
          <p className="desk-section-note">
            Runner-up: {driver.confidence.detail.runnerUpRegime} · effective
            confirmations {driver.confidence.detail.effectiveConfirmations}
          </p>
        ) : null}
      </section>
    </>
  );
}

export function MacroDesk({ view }: { view: MacroDeskView }) {
  if (view.status === "live_unavailable") {
    return (
      <DeskChrome>
        <DeskStatusBanners view={view} />
        <section className="desk-state" data-testid="state-live-unavailable">
          <h1 className="desk-title">Live data unavailable</h1>
          <p className="desk-interpretation">
            {view.error?.message ??
              "This public deployment does not serve live drivers."}
          </p>
          <p className="desk-section-note">
            Open <a href="/">the illustrative demo</a> for the synthetic
            scenario. Local development can still use{" "}
            <code>npm run daily</code> with live mode when{" "}
            <code>GAMMADESK_PUBLIC_DEMO</code> is unset.
          </p>
        </section>
      </DeskChrome>
    );
  }

  if (view.status === "empty" || (view.driver === null && !view.error)) {
    return (
      <DeskChrome>
        <DeskStatusBanners view={view} />
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
      <DeskChrome>
        <DeskStatusBanners view={view} />
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
    <DeskChrome>
      <DeskStatusBanners view={view} />
      <div data-testid={`state-${view.status}`}>
        <DriverBody
          driver={view.driver}
          sourceLabel={view.sourceLabel ?? "unknown"}
          isDemo={view.isDemo}
          isPublicDemo={view.isPublicDemo}
        />
      </div>
    </DeskChrome>
  );
}

export function DeskLoading() {
  return (
    <DeskChrome>
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
