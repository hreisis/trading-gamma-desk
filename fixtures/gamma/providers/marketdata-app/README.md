# MarketData.app fixtures (gamma)

Synthetic parallel-array option-chain responses for normalize / quality / provider tests.
**Automated tests never call the live API.**

| File | Purpose |
| --- | --- |
| `spy-minimal.ok.json` | Small `s=ok` chain |
| `spy-greek-boundary.json` | SPY 743–751 collapsed-Greek boundary |
| `spy-bounded-ui.json` | Derived `BoundedGammaProviderSnapshot` for desk UI tests (no raw vendor arrays / no token) |
| `no-data.json` | `s=no_data` |
| `vendor-error.json` | `s=error` |

CLI (live, local only): `npm run gamma:fetch -- --symbol SPY --expiration YYYY-MM-DD --strike-min N --strike-max M`
Requires `MARKETDATA_API_TOKEN`. Writes gitignored `data/gamma/providers/marketdata-app/{SYMBOL}-bounded-latest.json`.
