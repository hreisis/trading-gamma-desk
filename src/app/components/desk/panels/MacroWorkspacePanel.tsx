import type { DominantDriver } from "@/contracts";
import {
  confidenceComponentLabel,
  formatConfidenceScore,
  isFallbackRegime,
  polarityLabel,
  regimeLabel,
  riskDirectionLabel,
  sessionAlignmentLabel,
  sessionBannerText,
} from "@/desk";
import { deriveDriverRiskLight } from "@/desk/risk-lights";
import { RiskTrafficLight } from "../../RiskTrafficLight";
import { driverStanceLabel } from "../../signal-display";

export function MacroWorkspacePanel({
  driver,
  sourceLabel,
  isPublicDemo,
}: {
  driver: DominantDriver;
  sourceLabel: string;
  isPublicDemo: boolean;
}) {
  const light = deriveDriverRiskLight({
    primaryRegime: driver.primaryRegime,
    riskDirection: driver.riskDirection,
    confidenceScore: driver.confidence.score,
    zeroedBy: driver.confidence.zeroedBy,
  });

  return (
    <div className="workspace-panel" data-testid="workspace-macro">
      <header className="workspace-panel-head">
        <h2 className="workspace-panel-title">Macro</h2>
        <RiskTrafficLight light={light} testId="driver-risk-light" />
        <span className={`signal-stance-label signal-stance-${light.kind}`}>
          {driverStanceLabel(light)}
        </span>
      </header>
      <p className="workspace-panel-hero">{driver.label}</p>
      <p className="workspace-panel-tags">
        <span>{regimeLabel(driver.primaryRegime)}</span>
        {driver.polarity ? <span>{polarityLabel(driver.polarity)}</span> : null}
        {driver.riskDirection ? (
          <span>{riskDirectionLabel(driver.riskDirection)}</span>
        ) : null}
        {!isFallbackRegime(driver.primaryRegime) ? (
          <span>{formatConfidenceScore(driver.confidence)}</span>
        ) : null}
      </p>
      <details className="desk-fold">
        <summary>Details</summary>
        {!isPublicDemo ? (
          <p className="desk-section-note" data-testid="banner-session">
            {sessionBannerText(driver)} · {sessionAlignmentLabel(driver.sessionAlignment)}
            {" · "}
            {sourceLabel}
          </p>
        ) : null}
        <p className="terminal-driver-interpretation">{driver.interpretation.text}</p>
        <ul className="desk-evidence">
          {driver.evidence.map((ev) => (
            <li key={ev.id}>{ev.statement}</li>
          ))}
        </ul>
        <ul className="desk-components">
          {driver.confidence.components.map((c) => (
            <li key={c.name}>
              {confidenceComponentLabel(c.name)} · {(c.value * 100).toFixed(0)}%
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
