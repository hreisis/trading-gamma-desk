import type { AlpacaMarketPanel as AlpacaMarketPanelDto } from "@/contracts/alpaca-market";
import {
  formatAlpacaDailyChangePct,
  formatAlpacaPrice,
} from "@/alpaca/format";
import { deriveMarketSidebarSignal } from "../desk-sidebar-signals";
import { RiskTrafficLight } from "../../RiskTrafficLight";
import { RISK_LIGHT_BY_KIND } from "@/desk/risk-lights";

export function MarketWorkspacePanel({
  panel,
}: {
  panel: AlpacaMarketPanelDto;
}) {
  const signal = deriveMarketSidebarSignal(panel);
  const light = RISK_LIGHT_BY_KIND[signal.kind];

  return (
    <div className="workspace-panel" data-testid="workspace-market">
      <header className="workspace-panel-head">
        <h2 className="workspace-panel-title">Market</h2>
        <RiskTrafficLight light={light} testId="market-panel-light" />
        <span className="workspace-panel-signal-label">{signal.statusShort}</span>
      </header>

      <ul className="workspace-scan-list" data-testid="alpaca-quotes-table">
        {panel.quotes.map((quote) => (
          <li key={quote.symbol} className="workspace-scan-row">
            <span className="workspace-scan-title">{quote.symbol}</span>
            <span className="workspace-scan-meta">{formatAlpacaPrice(quote.latestPrice)}</span>
            <span
              className={`workspace-scan-time${
                quote.dailyChangePct !== null && quote.dailyChangePct < 0
                  ? " workspace-scan-down"
                  : quote.dailyChangePct !== null && quote.dailyChangePct > 0
                    ? " workspace-scan-up"
                    : ""
              }`}
            >
              {formatAlpacaDailyChangePct(quote.dailyChangePct)}
            </span>
          </li>
        ))}
      </ul>

      <details className="desk-fold">
        <summary>Details</summary>
        <p className="desk-section-note" data-testid="alpaca-health-message">
          {panel.health.message}
        </p>
        <p className="desk-section-note" data-testid="alpaca-status-banner">
          {panel.message}
        </p>
      </details>
    </div>
  );
}
