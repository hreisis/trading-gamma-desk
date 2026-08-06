import type { DominantDriver } from "@/contracts";
import {
  assetDisplayName,
  deriveAssetRiskLight,
  formatSignedChange,
  formatZScore,
  roleLabel,
} from "@/desk";
import { deriveCrossAssetSidebarSignal } from "../desk-sidebar-signals";
import { RiskTrafficLight } from "../../RiskTrafficLight";
import { RISK_LIGHT_BY_KIND } from "@/desk/risk-lights";
import { assetShortSymbol } from "../../signal-display";

export function CrossAssetWorkspacePanel({ driver }: { driver: DominantDriver }) {
  const signal = deriveCrossAssetSidebarSignal(driver);
  const light = RISK_LIGHT_BY_KIND[signal.kind];

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
    <div className="workspace-panel" data-testid="workspace-cross-asset">
      <header className="workspace-panel-head">
        <h2 className="workspace-panel-title">Cross Asset</h2>
        <RiskTrafficLight light={light} testId="cross-asset-panel-light" />
        <span className="workspace-panel-signal-label">{signal.statusShort}</span>
      </header>

      <ul className="workspace-scan-list">
        {sortedAssets.map((asset) => {
          const assetLight = deriveAssetRiskLight({
            symbol: asset.symbol,
            zScore: asset.zScore,
            role: asset.role,
            staleDays: asset.staleDays,
          });
          return (
            <li key={asset.symbol} className="workspace-scan-row" data-role={asset.role}>
              <span className="workspace-scan-title">
                {assetShortSymbol(asset.symbol)}
              </span>
              <RiskTrafficLight
                light={assetLight}
                compact
                testId={`asset-risk-light-${asset.symbol}`}
              />
              <span className="workspace-scan-meta">
                {formatSignedChange(asset.value, asset.unit)}
              </span>
              <span className="workspace-scan-time">{formatZScore(asset.zScore)}</span>
            </li>
          );
        })}
      </ul>

      <details className="desk-fold" data-testid="fold-evidence">
        <summary>Details</summary>
        <table className="terminal-table">
          <thead>
            <tr>
              <th>Asset</th>
              <th>Δ</th>
              <th>z</th>
              <th>Role</th>
            </tr>
          </thead>
          <tbody>
            {sortedAssets.map((asset) => (
              <tr key={asset.symbol}>
                <td>{assetDisplayName(asset)}</td>
                <td>{formatSignedChange(asset.value, asset.unit)}</td>
                <td>{formatZScore(asset.zScore)}</td>
                <td>{roleLabel(asset.role)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
