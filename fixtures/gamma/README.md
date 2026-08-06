# Gamma fixtures

| Path | Purpose |
| --- | --- |
| `spx.2026-07-29.json` | SPX options chain sample for GEX compute tests (0DTE + later expiries) |
| `providers/marketdata-app/` | Bounded gamma provider snapshots for MarketData.app integration tests and desk UI fallback |

Load chains via `FixtureOptionsChainProvider` or `loadOptionsChainFixtureFile`. Bounded desk UI uses `fixtures/gamma/providers/marketdata-app/spy-bounded-ui.json`.
