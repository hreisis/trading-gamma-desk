# Architecture

Status: **stack locked for Milestone 1** (single TypeScript runtime). Data flow and module boundaries are fixed by product.

## Goals

1. Separate **data ingestion**, **feature / structure computation**, **AI interpretation**, and **UI**.
2. Preserve the reasoning chain: Driver → Catalyst → Structure → Confirmation → Updated View.
3. Keep module I/O typed via `docs/data-contracts.md` so UI and agents share one contract.

---

## Stack (Phase 0 decision)

| Concern | Choice | Rationale |
| --- | --- | --- |
| Runtime | **TypeScript, single app** (Next.js App Router) | Milestone 1 compute is statistics over ~8 assets × 21 sessions; a second runtime would cost more than it saves |
| Schemas | **Zod**, generated from `docs/data-contracts.md` | One source of truth shared by API, compute and UI |
| Tests | **Vitest** | Pure-function and property tests over fixtures |
| Compute | Pure TS modules, no IO, no network | Deterministic and reproducible |
| Interpretation | Template generator by default; LLM behind `MACRO_INTERPRETER=template\|llm` | Contract compliance beats prose |
| Persistence (M1) | Files: cached bars + immutable snapshots | No database until history queries or concurrent writes exist |

---

## Logical modules

```text
┌─────────────┐   ┌──────────────┐
│ Market data │   │ Options / GEX│
│ (spot/FX/…) │   │ chain feed   │
└──────┬──────┘   └──────┬───────┘
       │                 │
       ▼                 ▼
┌──────────────────────────────────┐
│ Ingest + normalize (timestamps,  │
│ symbols, sessions, units)        │
└──────────────────┬───────────────┘
                   │
       ┌───────────┼───────────┐
       ▼           ▼           ▼
┌────────────┐ ┌────────┐ ┌────────────┐
│ Macro      │ │ Events │ │ Gamma eng. │
│ features   │ │ calendar│ │ (GEX etc.) │
└─────┬──────┘ └───┬────┘ └─────┬──────┘
      │            │            │
      └────────────┼────────────┘
                   ▼
         ┌─────────────────┐
         │ Thesis composer │  ← AI / rules hybrid
         │ (MarketThesis)  │
         └────────┬────────┘
                  │
                  ▼
         ┌─────────────────┐
         │ Close validator │  ← EOD / session end
         │ (ViewUpdate)    │
         └────────┬────────┘
                  │
                  ▼
              ┌───────┐
              │  UI   │
              └───────┘
```

---

## Data flow (session lifecycle)

| Phase | When | Producers | Primary artifacts |
| --- | --- | --- | --- |
| Pre-open / open | Before / at cash open | Macro + Events + Gamma | `DominantDriver`, `CatalystDigest`, `MarketStructureState`, morning `MarketThesis` |
| Intraday | RTH | Gamma deltas, event ticks, macro refresh | Updated structure state, since-open changes |
| Close | After cash close | Breadth, close quality, relative performance | `CloseIntelligence`, `ViewUpdate` |
| Next day | Pre-open next session | Prior `ViewUpdate` | Watchlist / invalidate conditions |

---

## Layers

| Layer | Responsibility | Notes |
| --- | --- | --- |
| `data/` | Source clients, rate limits, raw bar cache | Idempotent pulls keyed by `sessionDate` |
| `macro/` | Transforms, z-scores, signature scoring, driver assembly | Pure functions, no IO, unit + property tested |
| `interpret/` | Template generator, optional LLM + guardrails | Emits contract-shaped JSON only |
| `contracts/` | Zod schemas | Mirrors `docs/data-contracts.md` |
| `app/api/` | Serve latest snapshot | Versioned payloads |
| `app/` | Desk UI | Milestone 1 surface is macro-first |

---

## Milestone 1 — Cross-Asset Macro data layer

### Source selection

FRED is **not** viable as a primary source: it republishes upstream data with a lag (`DGS2` runs a day behind, `DCOILWTICO` and `DTWEXBGS` several days), so a snapshot built on it can never honestly answer “today”. Verified alternatives:

| Input | Source | Key | Freshness (verified 2026-07-29) |
| --- | --- | --- | --- |
| US 2Y, US 10Y | Treasury.gov daily par yield curve CSV | none | Same session; `07/29` available same day |
| VIX | CBOE daily `VIX_History.csv` | none | Latest `07/28` at ~19:00 ET — effectively T-1 |
| Gold, Copper, Oil, USD | Tiingo EOD, ETF proxies `GLD` / `CPER` / `USO` / `UUP` | token | EOD; **verify per-symbol dates and fields before building** |
| BTC | Tiingo crypto | token | 24h market; snapped to equity sessions |
| FRED | Backfill and cross-check only | none | Lagging by design |

Yields keep native **bps** semantics from Treasury data. `UUP` is closer to DXY composition than FRED’s broad-dollar index, but it is still a proxy and must be labelled `proxyFor: "DXY"`.

**Open decision — VIX.** The CBOE CSV lags intraday, and futures-based ETFs (`VIXY`, `VIXM`) are unusable as substitutes: roll decay means their daily change can differ in sign from VIX spot. Options are (a) accept T-1 VIX and let `sessionAlignment` report it, or (b) add a paid index source later. Milestone 1 assumes (a).

### Run schedule

**Pre-open on the next business day, over the last complete session.** A post-close same-day run would routinely find some sources not yet updated, which turns the “latest complete snapshot” degradation path into the normal case. Pre-open, all sources have generally settled, so `isCompleteSession` can genuinely be true.

### Ingest rules

1. Request **45–60 calendar days** per symbol so that 22 consecutive valid sessions survive weekends and holidays.
2. **No forward-fill.** A missing session stays missing and surfaces as `staleDays` / `missing`.
3. A daily change must span consecutive valid sessions for that asset. A gap is flagged `gapSkipped`, never divided into a “daily” move.
4. **BTC trades weekends; equities do not.** BTC is snapped at the 16:00 ET mark and restricted to equity trading days, so every asset’s window uses the same session calendar.
5. Persist raw bars before computing, so any snapshot can be recomputed from stored inputs.

### Run model and persistence

Milestone 1 is **local-first**: a script performs ingest → compute → interpret and writes an immutable snapshot to `data/snapshots/<marketSessionDate>.json`. Files are a valid store here only because writes are single-writer and local.

Deployment path, when wanted: the local run commits the snapshot (a few KB per session) and the deployed app serves it read-only. **Runtime filesystem writes on serverless hosts are not a database** — if scheduled online updates become a requirement, that is the point at which object storage or Postgres enters, and it is a Milestone 2+ decision, not an M1 design constraint.

---

## Non-functional requirements (MVP)

- **As-of clarity**: every snapshot separates `marketSessionDate` from `generatedAt`, and carries per-asset source dates and staleness. A snapshot is only called “Today” when every core asset shares one session.
- **Reproducibility**: compute output must be reproducible from stored inputs plus the recorded `signatureVersion` and `methodologyVersion`.
- **Guardrails**: the interpretation layer cannot invent Reported Flow, cannot author numbers, and must reference `evidenceId`s.
- **Privacy**: `docs/BACKBONE.md` and secrets stay out of git; no keys in client bundles. Vendor tokens are server-side only.

---

## Related docs

- Product scope: `docs/product.md`
- Schemas: `docs/data-contracts.md`
- Agent rules: `AGENTS.md`
