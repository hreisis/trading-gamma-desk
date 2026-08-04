import type { MarketNewsPanel as MarketNewsPanelDto } from "@/contracts/market-news";
import {
  formatNewsTimestamp,
  newsItemSourceLabel,
  newsSourceLabel,
} from "@/news/format";

function statusBanner(panel: MarketNewsPanelDto): {
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
      text: panel.message,
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
    text: panel.message,
  };
}

export function MarketNewsPanel({
  panel,
}: {
  panel: MarketNewsPanelDto;
}) {
  const banner = statusBanner(panel);

  return (
    <section
      className="desk-section"
      aria-labelledby="market-news-heading"
      data-testid="market-news-panel"
    >
      <div className="desk-section-head">
        <h2 id="market-news-heading">Market headlines</h2>
        <p className="desk-section-note" data-testid="market-news-provider">
          Provider: {newsSourceLabel(panel.provider)} · fetched{" "}
          {formatNewsTimestamp(panel.fetchedAt)}
        </p>
      </div>

      <p className={banner.className} data-testid="market-news-status-banner">
        {banner.text}
      </p>

      <div className="market-news-sections">
        {panel.sections.map((section) => (
          <section
            key={section.topic}
            className="market-news-section"
            data-testid={`market-news-section-${section.topic}`}
            data-section-status={section.status}
          >
            <h3>{section.label}</h3>
            {section.message && section.status !== "ready" ? (
              <p className="desk-section-note">{section.message}</p>
            ) : null}
            {section.items.length > 0 ? (
              <ul className="market-news-list">
                {section.items.map((item) => (
                  <li
                    key={`${section.topic}-${item.id}`}
                    className="market-news-item"
                    data-testid={`market-news-item-${item.id}`}
                    data-item-status={item.status}
                  >
                    <div className="market-news-item-head">
                      {item.url ? (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="market-news-headline"
                        >
                          {item.headline}
                        </a>
                      ) : (
                        <span className="market-news-headline">
                          {item.headline}
                        </span>
                      )}
                    </div>
                    <p className="market-news-summary">{item.summary}</p>
                    <p className="market-news-meta">
                      <span>{item.source}</span>
                      <span className="desk-inline-meta">
                        {" "}
                        · {formatNewsTimestamp(item.publishedAt)}
                      </span>
                      {item.symbols.length > 0 ? (
                        <span className="desk-inline-meta">
                          {" "}
                          · {item.symbols.join(", ")}
                        </span>
                      ) : null}
                      <span
                        className={
                          item.itemSource === "synthetic_demo"
                            ? "desk-source desk-source-fixture"
                            : item.itemSource === "alpaca"
                              ? "desk-source desk-source-live"
                              : "desk-source"
                        }
                        data-desk-source={item.itemSource}
                      >
                        {" "}
                        · {newsItemSourceLabel(item.itemSource)}
                      </span>
                      {item.status === "stale" ? (
                        <span className="desk-inline-meta"> · stale</span>
                      ) : null}
                    </p>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ))}
      </div>
    </section>
  );
}
