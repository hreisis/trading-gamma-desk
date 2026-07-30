# Gamma fixtures (M4-1)

Fixed `OptionsChainSnapshot` documents for the Estimated Gamma Structure Engine.

- No paid API pulls.
- No pseudo-realtime quotes — `dataDelay` is `fixture`.
- Provider-neutral shape; future MarketData.app / Tradier adapters map into the same types.

| File | Purpose |
| --- | --- |
| `spx.2026-07-29.json` | SPX sample with 0DTE + later expiries, one missing-OI row, one expired row |

Load via `FixtureOptionsChainProvider` or `loadOptionsChainFixtureFile`.

**Strict parse (M4-1A):** malformed contract rows, invalid `dataDelay`, or invalid `asOf` / `sessionDate` / `source.fetchedAt` throw — rows are never silently dropped.
