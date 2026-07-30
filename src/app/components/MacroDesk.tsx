import type { DominantDriver } from "@/contracts";
import {
  assetDisplayName,
  deskSourceLabel,
  formatConfidenceScore,
  formatSignedChange,
  formatZScore,
  isFallbackRegime,
  roleLabel,
  sessionBannerText,
} from "@/desk";
import type { DeskPayloadSource } from "@/desk";

export function MacroDesk({
  driver,
  source,
  snapshotPresent,
}: {
  driver: DominantDriver;
  source: DeskPayloadSource;
  snapshotPresent: boolean;
}) {
  const contradictionSet = new Set(driver.contradictions);
  const evidenceById = new Map(driver.evidence.map((e) => [e.id, e]));
  const showStaleBanner =
    !driver.isCompleteSession ||
    driver.sessionAlignment !== "aligned" ||
    Object.values(driver.staleDaysByAsset).some(
      (days) => days !== undefined && days > 0,
    );

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
    <main className="desk">
      <header className="desk-brand">
        <p className="desk-product">GammaDesk</p>
        <p className="desk-chain">
          Driver → Catalyst → Structure → Confirmation → Updated View
        </p>
      </header>

      <p
        className={
          showStaleBanner ? "desk-banner desk-banner-warn" : "desk-banner"
        }
      >
        {sessionBannerText(driver)}
        <span className="desk-banner-meta">
          · {driver.sessionAlignment}
          {driver.isCompleteSession ? "" : " · incomplete"}
          {" · "}
          <span
            className={
              source === "fixture"
                ? "desk-source desk-source-fixture"
                : "desk-source desk-source-live"
            }
            data-desk-source={source}
          >
            {deskSourceLabel(source)}
          </span>
          {source === "local_driver" && !snapshotPresent
            ? " · snapshot missing"
            : ""}
        </span>
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
                <td>{asset.sourceDate ?? "—"}</td>
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
    </main>
  );
}
