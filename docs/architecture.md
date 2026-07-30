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
| `catalyst/` | Raw event → canonical Catalyst; dedupe; feed query; official calendar + BLS results | Normalize is pure; `catalyst:fetch` / `catalyst:results:fetch` are local-only; public demo never networks |
| `interpret/` | Template generator, optional LLM + guardrails | Emits contract-shaped JSON only |
| `contracts/` | Zod schemas | Mirrors `docs/data-contracts.md` |
| `app/api/` | Serve latest snapshot + catalyst feed | Versioned payloads |
| `app/` | Desk UI | Macro desk + minimal catalyst feed; no reclassify in UI |

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

### M1-1 verification findings (2026-07-29)

**Treasury par yield curve — usable as primary.** Query is per calendar year (`.../daily-treasury-rates.csv/<year>/all?...&_format=csv`). 15 columns with `"2 Yr"` and `"10 Yr"` present; dates `MM/DD/YYYY`, **descending**. The 2026 file held `07/29` on the same day. 144 rows YTD with no weekend rows, no blank 2Y/10Y cells, and the five business-day gaps correspond exactly to market holidays — the upstream file is genuinely sparse rather than forward-filled, which is what the consecutive-session rule needs. **Consequence:** a 45–60 day window crossing 1 January requires two requests and a merge.

**CBOE VIX — usable, one session behind.** 9,239 rows back to `01/02/1990`, columns `DATE,OPEN,HIGH,LOW,CLOSE`, dates `MM/DD/YYYY` **ascending**, no zero or blank OHLC in the recent window. At 19:00 ET on `07/29` the latest row was `07/28`, confirming a CDN update lag and confirming the pre-open schedule choice.

**Tiingo — verified, all five symbols usable.** Reproduce with `npm run verify:tiingo` (`scripts/verify-tiingo.mjs`). The probe sends the token as an `Authorization` header rather than a query parameter so the secret cannot leak through a URL echoed in an error, redacts it from every line it prints, applies the Stooq lesson by checking `content-type` and payload shape before trusting HTTP 200, and exits non-zero without writing anything if any probe fails.

Findings at `2026-07-29` 20:13 ET, over a 75-calendar-day request:

**ETF proxies (`GLD`, `CPER`, `USO`, `UUP`).** All four returned HTTP 200, `application/json`, and the full expected field set with nothing missing and nothing unexpected: `date, open, high, low, close, volume, adjOpen, adjHigh, adjLow, adjClose, adjVolume, divCash, splitFactor`. 50 sessions each, no non-positive or non-finite closes, latest session `2026-07-29` — the **same session**, available after the 16:00 ET close. 75 calendar days yielding 50 sessions also confirms the 45–60 day request window comfortably covers a 22-session need.

**Two date traps, both verified rather than assumed.**

1. The daily `date` field is `"2026-07-29T00:00:00.000Z"` and the crypto endpoint uses `"2026-05-16T00:00:00+00:00"` — two different serialisations of the same idea. Dates must be taken by **string slice**. Converting through a local `Date` renders `2026-07-29` as `2026-07-28` in both ET and PT, which is a silent one-session shift that would corrupt every change the pipeline computes while looking entirely plausible.
2. The `btcusd` daily bars are **UTC-dated**, so the latest bar was `2026-07-30`: a calendar day that had been in progress for thirteen minutes. Taking the last bar naively would score an incomplete session and label it with tomorrow's date. The adapter must drop the in-progress UTC day and intersect with equity sessions; 22 of 76 bars were weekends.

**`adjClose` is policy, not a measurement.** `close` and `adjClose` diverged by 0.0000% across all four ETFs, with zero `divCash` rows and no `splitFactor != 1`. This does **not** show the two are interchangeable — it shows the sampled window contained no adjustment event. `UUP` in particular does distribute. Milestone 1 therefore uses `adjClose` deliberately, because it is the series that stays continuous the first time a distribution lands.

**BTC carries no `adjClose`.** Crypto bars expose `date, open, high, low, close, volume, tradesDone, volumeNotional` inside a `priceData` envelope keyed by `ticker, baseCurrency, quoteCurrency`. The adapter cannot assume one row shape across both endpoints.

**Calendar reconciled against a second source.** The probe persists observed session dates to `fixtures/macro/observed-sessions.tiingo.json` (dates only, no secrets), and `tests/session-calendar.test.ts` reconciles the M1-3 holiday set against it offline. Tiingo's 50 sessions match the calendar exactly, with no date the calendar expects that the vendor skipped and none the vendor traded that the calendar calls a holiday. The holiday set now has two independent witnesses: Treasury's sparse file and this fixture.

**Stooq — rejected.** `stooq.com/q/d/l/` returns **HTTP 200 with a JavaScript proof-of-work bot challenge page**, not CSV. This is the important finding: a client that checks only the status code would parse an HTML challenge as price data and produce silent garbage.

### Response validation rules (from the Stooq finding)

Every ingest response must pass all of the following before parsing:

1. Status code **and** `Content-Type` match expectations.
2. The first line matches the expected header signature for that source.
3. Parsed row count and date range are plausible; a sudden collapse in row count fails the pull.
4. The newest parsed date is within an expected staleness bound for that source, otherwise the asset is marked `stale` rather than accepted quietly.

A pull that fails validation is a hard error. It must never degrade into a partial or forward-filled series.

**Open decision — VIX.** The CBOE CSV lags intraday, and futures-based ETFs (`VIXY`, `VIXM`) are unusable as substitutes: roll decay means their daily change can differ in sign from VIX spot. Options are (a) accept T-1 VIX and let `sessionAlignment` report it, or (b) add a paid index source later. Milestone 1 assumes (a).

### Run schedule

**Pre-open on the next business day, over the last complete session.** A post-close same-day run would routinely find some sources not yet updated, which turns the “latest complete snapshot” degradation path into the normal case. Pre-open, all sources have generally settled, so `isCompleteSession` can genuinely be true.

### Ingest rules

1. Request **45–60 calendar days** per symbol so that 22 consecutive valid sessions survive weekends and holidays.
2. **No forward-fill.** A missing session stays missing and surfaces as `staleDays` / `missing`.
3. A daily change must span consecutive valid sessions for that asset. A gap is flagged `missingAdjacentSession`, never divided into a “daily” move.
4. **BTC trades weekends; equities do not.** BTC is snapped at the 16:00 ET mark and restricted to equity trading days, so every asset’s window uses the same session calendar.
5. Persist raw bars before computing, so any snapshot can be recomputed from stored inputs.

### Run model and persistence

Milestone 1 is **local-first**: `npm run ingest` (`scripts/ingest-macro.ts`) pulls Treasury + CBOE VIX + Tiingo, persists raw bars to `data/bars/<SYMBOL>.json`, then writes an immutable compute snapshot to `data/snapshots/<marketSessionDate>.json`. The snapshot holds features, classification and methodology versions so a past conclusion can be recomputed; interpretation (M1-8) is not required to freeze the numbers. Files are a valid store here only because writes are single-writer and local. Use `--force` only when deliberately replacing a session.

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
