# Gamma fixtures (M4-1 / M4-2)

Fixed `OptionsChainSnapshot` documents for the Estimated Gamma Structure Engine, plus immutable historical snapshots for the M4-2 change engine.

- No paid API pulls.
- No pseudo-realtime quotes — `dataDelay` is `fixture`.
- Provider-neutral shape; future MarketData.app / Tradier adapters map into the same types.
- Snapshot `captureKind` is explicit (`open` / `intraday` / `close`) — never inferred from clock time.

| File | Purpose |
| --- | --- |
| `spx.2026-07-29.json` | SPX sample with 0DTE + later expiries, one missing-OI row, one expired row |
| `snapshots/SPX/2026-07-28/close_*.json` | Prior-session explicit close baseline |
| `snapshots/SPX/2026-07-29/open_*.json` | Same-session explicit open baseline |
| `snapshots/SPX/2026-07-29/intraday_*.json` | Current intraday snapshot for change comparisons |
| `structure/spx.2026-07-29.intraday.market-structure-state.json` | M4-3 `MarketStructureState` derived from the three SPX snapshots above |

Load chains via `FixtureOptionsChainProvider` or `loadOptionsChainFixtureFile`. Load snapshots via `FileGammaSnapshotStore` with root `fixtures/`. Build structure via `buildMarketStructureState(snapshot, changeSet)`.

**Strict parse (M4-1A):** malformed contract rows, invalid `dataDelay`, or invalid `asOf` / `sessionDate` / `source.fetchedAt` throw — rows are never silently dropped.
