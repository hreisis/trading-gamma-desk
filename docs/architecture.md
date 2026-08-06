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
| Versions | Exact pins in `package.json`, Node in `.nvmrc`, `engines` declared | Next 16 needs `experimental.useTypeScriptCli` under TypeScript 7, so a floating range could silently change build behaviour |
| CI | `npm ci` then typecheck, test **and `next build`** | The TypeScript 7 workaround lives in the build path; without building in CI it would only ever be exercised locally |
| Schemas | **Zod**, generated from `docs/data-contracts.md` | One source of truth shared by API, compute and UI |
| Tests | **Vitest** | Pure-function and property tests over fixtures |
| Compute | Pure TS modules, no IO, no network | Deterministic and reproducible |
| Interpretation | Template generator by default (`npm run interpret`); LLM behind `MACRO_INTERPRETER=llm` later | Consumes compute snapshot only; never re-scores; polarity ≠ equity call; no band labels while uncalibrated |
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
              ┌───────┐
              │  UI   │  Macro Desk · Market · AI Study
              └───────┘
```

---

## Data flow (session lifecycle)

| Phase | When | Producers | Primary artifacts |
| --- | --- | --- | --- |
| Pre-open / open | Before / at cash open | Macro + Events + Gamma | `DominantDriver`, catalyst feed, bounded `MarketStructureState` |
| Intraday | RTH | Gamma refresh, event ticks | Updated bounded structure state |
| Close | After cash close | Macro refresh (daily pipeline) | Updated driver snapshot |

---

## Layers

| Layer | Responsibility | Notes |
| --- | --- | --- |
| `data/` | Source clients, rate limits, raw bar cache | Idempotent pulls keyed by `sessionDate` |
| `macro/` | Transforms, z-scores, signature scoring, driver assembly | Pure functions, no IO, unit + property tested |
| `catalyst/` | Raw event → canonical Catalyst; dedupe; feed query; calendar + BLS results + documents + rule-based briefs + optional AI briefs + market-context ETF snapshots + deterministic reaction patterns + optional AI market-reaction narratives + integration smoke + unified incremental update | Normalize/extract/compute/classify are pure; fetch/build/enhance/smoke/update scripts are local-only; public demo never networks |
| `gamma/` | Provider-neutral options chain → OI-based Estimated GEX structure → bounded provider snapshot → `MarketStructureState` v0.2.0 interpretation | Pure compute; Flip reserved unavailable without gamma recompute; live desk uses MarketData.app bounded provider |
| `ai-study/` | Daily briefing from macro + catalyst + bounded gamma + market quotes | OpenAI when configured; public demo fixture-only |
| `interpret/` | Template generator, optional LLM + guardrails | Emits contract-shaped JSON only |
| `contracts/` | Zod schemas | Mirrors `docs/data-contracts.md` |
| `app/api/` | Serve macro, catalyst, market, AI study | Versioned payloads |
| `app/` | Desk UI | Macro desk + catalyst feed + market + AI study; no reclassify in UI |

---

## Milestone 1 — Cross-Asset Macro data layer

### Source selection

FRED is **not** viable as a primary source: it republishes upstream data with a lag (`DGS2` runs a day behind, `DCOILWTICO` and `DTWEXBGS` several days), so a snapshot built on it can never honestly answer “today”. Verified alternatives:

| Input | Source | Key | Status |
| --- | --- | --- | --- |
| US 2Y, US 10Y | Treasury.gov daily par yield curve CSV | none | ✅ verified, same session |
| VIX | CBOE daily `VIX_History.csv` | none | ✅ verified, T-1 |
| Gold, Copper, Oil, USD | Tiingo EOD, ETF proxies `GLD` / `CPER` / `USO` / `UUP` | token | ✅ verified, same session |
| BTC | Tiingo crypto | token | ✅ verified, UTC-dated, needs session snap |
| FRED | Backfill and cross-check only | none | Lagging by design |
| Stooq | **Rejected** | none | Bot challenge, see M1-1 findings |

Yields keep native **bps** semantics from Treasury data. `UUP` is closer to DXY composition than FRED’s broad-dollar index, but it is still a proxy: it is carried as `symbol: "USD"` with `instrument: "UUP"` and `isProxy: true`, and surfaced as “USD via UUP”.

### Run schedule

**Pre-open on the next business day, over the last complete session.**

### Ingest rules

1. Request **45–60 calendar days** per symbol so that 22 consecutive valid sessions survive weekends and holidays.
2. **No forward-fill.** A missing session stays missing and surfaces as `staleDays` / `missing`.
3. A daily change must span consecutive valid sessions for that asset.
4. **BTC trades weekends; equities do not.** BTC is snapped at the 16:00 ET mark and restricted to equity trading days.
5. Persist raw bars before computing.

### Run model and persistence

Milestone 1 is **local-first**: `npm run ingest` pulls Treasury + CBOE VIX + Tiingo (macro proxies + BTC + **SPY**), persists raw bars to `data/bars/<SYMBOL>.json`, then writes an immutable compute snapshot to `data/snapshots/<marketSessionDate>.json`.

---

## Non-functional requirements (MVP)

- **As-of clarity**: every snapshot separates `marketSessionDate` from `generatedAt`, and carries per-asset source dates and staleness.
- **Reproducibility**: compute output must be reproducible from stored inputs plus the recorded `signatureVersion` and `methodologyVersion`.
- **Guardrails**: the interpretation layer cannot invent Reported Flow, cannot author numbers, and must reference `evidenceId`s.
- **Privacy**: `docs/BACKBONE.md` and secrets stay out of git; no keys in client bundles.

---

## Related docs

- Product scope: `docs/product.md`
- Schemas: `docs/data-contracts.md`
- Build plan / milestone status: `docs/tasks.md`
- Agent rules: `AGENTS.md`

### Milestone status (public repo)

| Milestone | Status |
| --- | --- |
| M1–M3 | ✅ Shipped |
| M4 bounded gamma + desk UI | ✅ Shipped |
| AI Study | ✅ Shipped |
| M7 private policy | Planned — private repo |
| M9 shadow/review | Planned — private repo |
