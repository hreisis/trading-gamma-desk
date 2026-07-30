# Gamma fixtures (M4-1)

Fixed `OptionsChainSnapshot` documents for the Estimated Gamma Structure Engine.

- No paid API pulls.
- No pseudo-realtime quotes — `dataDelay` is `fixture`.
- Provider-neutral shape; future MarketData.app / Tradier adapters map into the same types.

| File | Purpose |
| --- | --- |
| `spx.2026-07-29.json` | SPX sample with 0DTE + later expiries, one missing-OI row, one expired row |

Load via `FixtureOptionsChainProvider` or `loadOptionsChainFixtureFile`.
