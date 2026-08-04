import type { AlpacaMarketPanel as AlpacaMarketPanelDto } from "@/contracts/alpaca-market";
import {
  alpacaSourceLabel,
  formatAlpacaDailyChangePct,
  formatAlpacaPrice,
  formatAlpacaTimestamp,
} from "@/alpaca/format";

function statusBanner(panel: AlpacaMarketPanelDto): {
  className: string;
  text: string;
} {
  if (panel.status === "synthetic_demo") {
    return {
      className: "desk-banner desk-banner-warn",
      text: panel.message,
    };
  }
  if (panel.status === "not_configured") {
    return {
      className: "desk-banner desk-banner-compact",
      text: "Alpaca not configured",
    };
  }
  if (panel.status === "error") {
    return {
      className: "desk-banner desk-banner-warn",
      text: panel.message,
    };
  }
  if (panel.status === "partial") {
    return {
      className: "desk-banner desk-banner-compact",
      text: panel.message,
    };
  }
  return {
    className: "desk-banner desk-banner-compact",
    text: panel.health.message,
  };
}

function changeClass(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "alpaca-change-flat";
  if (value > 0) return "alpaca-change-up";
  if (value < 0) return "alpaca-change-down";
  return "alpaca-change-flat";
}

export function AlpacaMarketPanel({
  panel,
}: {
  panel: AlpacaMarketPanelDto;
}) {
  const banner = statusBanner(panel);

  return (
    <section
      className="desk-section"
      aria-labelledby="alpaca-market-heading"
      data-testid="alpaca-market-panel"
    >
      <div className="desk-section-head">
        <h2 id="alpaca-market-heading">Market watchlist</h2>
        <p
          className="desk-section-note"
          data-testid="alpaca-health-message"
        >
          {panel.health.message}
        </p>
      </div>

      <p
        className={banner.className}
        data-testid="alpaca-status-banner"
      >
        {banner.text}
      </p>

      <table className="desk-table" data-testid="alpaca-quotes-table">
        <thead>
          <tr>
            <th scope="col">Symbol</th>
            <th scope="col">Latest</th>
            <th scope="col">Day change</th>
            <th scope="col">Timestamp</th>
            <th scope="col">Source</th>
          </tr>
        </thead>
        <tbody>
          {panel.quotes.map((quote) => (
            <tr
              key={quote.symbol}
              data-testid={`alpaca-quote-${quote.symbol.replace("/", "-")}`}
              data-quote-status={quote.status}
            >
              <th scope="row">{quote.symbol}</th>
              <td>{formatAlpacaPrice(quote.latestPrice)}</td>
              <td className={changeClass(quote.dailyChangePct)}>
                {formatAlpacaDailyChangePct(quote.dailyChangePct)}
              </td>
              <td>{formatAlpacaTimestamp(quote.timestamp)}</td>
              <td>
                <span
                  className={
                    quote.source === "synthetic_demo"
                      ? "desk-source desk-source-fixture"
                      : quote.source === "alpaca"
                        ? "desk-source desk-source-live"
                        : "desk-source"
                  }
                  data-desk-source={quote.source}
                >
                  {alpacaSourceLabel(quote.source)}
                </span>
                {quote.status === "stale" ? (
                  <span className="desk-inline-meta"> · stale</span>
                ) : null}
                {quote.error ? (
                  <span className="desk-inline-meta"> · {quote.error}</span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
