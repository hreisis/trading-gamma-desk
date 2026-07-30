# GammaDesk

AI Market Structure Copilot.

Reasoning chain: **Driver → Catalyst → Structure → Confirmation → Updated View**

Milestone 1 ships a **read-only Macro Desk**: cross-asset regime, evidence, and an interpreted `DominantDriver`. Milestone 2 adds a **Catalyst feed** — synthetic fixtures in public demo; locally, an official US macro **release schedule** from BLS + BEA + Federal Reserve FOMC (scheduled times only). The UI never classifies markets or recomputes confidence — it only renders precomputed payloads.

**Public portfolio demo:** synthetic macro + catalyst fixtures — illustrative, not live or historical market data. Repository: [hreisis/trading-gamma-desk](https://github.com/hreisis/trading-gamma-desk).

### Regime vs catalyst vs confidence

| Concept | Meaning (today) |
| --- | --- |
| **Regime** (`DominantDriver`) | What cross-asset pattern the market is trading *now* |
| **Catalyst** | An event that may *push* that pattern to change |
| **Confidence** | Classification clarity (macro regime or catalyst taxonomy) — **uncalibrated**, not P(up) |

These three are **independent** in M2. Catalyst direction is not mixed into macro regime or macro confidence; linkage is a later milestone.

---

## Architecture

```text
.env (TIINGO_TOKEN)          gitignored — local daily only
        │
        ▼
npm run daily
  ├─ ingest   → data/bars/  + data/snapshots/   (compute inside ingest)
  └─ interpret→ data/drivers/<session>.json     (atomic write)

npm run catalyst:fetch       (local only — not public demo)
  └─ BLS ICS + BEA JSON + Fed FOMC HTML schedules
        → normalize/dedupe
        → data/catalyst/calendar-latest.json   (atomic, gitignored)
        │
        ▼
Next.js desk (app/)
  ├─ GET /api/macro/latest     → resolveDeskRequest() (no scoring)
  └─ GET /api/catalysts        → loadCatalystFeed()
       public demo → synthetic fixtures (no BLS/BEA)
       local       → calendar cache or explicit unavailable

Public deploy (GAMMADESK_PUBLIC_DEMO=1):
  bundled synthetic macro + catalyst fixtures → desk UI
  (no runtime fixtures/ path; no Tiingo; no data/; no BLS/BEA; no live label)
```

| Layer | Role |
| --- | --- |
| `src/ingest` | Pull Treasury / CBOE / Tiingo, cache bars, write compute snapshot |
| `src/macro` | Pure features + signature scoring (no IO) |
| `src/catalyst` | Normalize/dedupe; BLS/BEA schedule adapters; local calendar cache |
| `src/interpret` | Template `DominantDriver` from snapshot; copies confidence verbatim |
| `src/pipeline` | Daily orchestration + atomic driver write |
| `src/desk` | Filesystem load + public-demo / status model for UI/API |
| `src/app` | Macro Desk + Catalyst Feed (read-only) |

Docs: [product](docs/product.md) · [architecture](docs/architecture.md) · [contracts](docs/data-contracts.md) · [tasks](docs/tasks.md) · [AGENTS](AGENTS.md)

---

## Run locally

```bash
cp .env.example .env   # set TIINGO_TOKEN — never commit .env
npm ci
npm run daily          # ingest → compute → interpret → atomic driver
npm run catalyst:fetch # optional: official BLS/BEA release schedules
npm run dev            # http://localhost:3000  (live mode when data/drivers exists)
```

Leave `GAMMADESK_PUBLIC_DEMO` **unset** locally so `npm run daily`, `catalyst:fetch`, and `/?source=live` keep working.

| Command | Purpose |
| --- | --- |
| `npm run daily` | Full refresh (`--force` replaces today’s snapshot) |
| `npm run ingest` | Pull + compute snapshot only |
| `npm run interpret` | Snapshot → atomic driver write |
| `npm run catalyst:fetch` | Pull BLS/BEA/FOMC **schedules** → `data/catalyst/calendar-latest.json` |
| `npm run catalyst:results:fetch` | Pull BLS CPI/Employment **actuals** → `data/catalyst/results-latest.json` |
| `npm run smoke:demo` | Public-demo + deploy smoke tests |
| `npm run smoke:demo:prod` | Public-demo `next build` + `next start` HTTP smoke |
| `npm test` / `npm run typecheck` / `npm run build` | Verify |

### Official US macro calendar (M2-2A)

Sources (schedule only — not observed prints):

| Provider | Endpoint |
| --- | --- |
| BLS | `https://www.bls.gov/schedule/news_release/bls.ics` |
| BEA | `https://apps.bea.gov/API/signup/release_dates.json` |
| Federal Reserve | `https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm` |

- Explicit registry maps CPI, Employment Situation, PPI, JOLTS, ECI, GDP, Personal Income and Outlays (incl. PCE via `macroChannels`), International Trade, **FOMC policy decision** + **Chair press conference**.
- FOMC: meeting end date → decision 2:00 p.m. ET / press 2:30 p.m. ET (`America/New_York`); SEP `*` annotates the decision only (not a separate catalyst). No statement/minutes/dot-plot content.
- Default window: **now − 1 day … now + 45 days** (`now` injectable in tests).
- Rows stay `status: upcoming`, `direction: unclear`. No actual/forecast/surprise.
- Missing / stale / partial-failure cache states are **explicit** — local mode does not silently fall back to synthetic.
- Public demo never calls BLS/BEA/Federal Reserve and never reads `data/catalyst/`.

If any calendar provider fails, successful sources still write a usable cache with `partialFailure: true`. All three failing leaves the prior cache untouched.

**BLS release results (M2-2C1):** `npm run catalyst:results:fetch` writes `data/catalyst/results-latest.json` (full period archive, separate from the calendar cache). The default feed materializes scheduled events plus **at most the latest observation per release family** — not one catalyst per historical period. CPI + Employment Situation actuals only — Consensus unavailable · Surprise unavailable. Events become `released` only via strict `releaseFamily` + `referencePeriod` match. Public demo uses a labelled synthetic results fixture and never calls the BLS API.

### Desk URLs (local)

| URL | Expected |
| --- | --- |
| `/` | Live driver when `data/drivers/` has a valid file; otherwise **demo · fixture fallback**. Catalyst: official calendar when `data/catalyst/calendar-latest.json` exists |
| `/?source=fixture` | Always demo fixture (even if live exists) |
| `/?source=live` | Live only — empty if no drivers (no silent fixture) |
| `/api/macro/latest` | Same view model as JSON |
| `/api/catalysts` | Catalyst feed (`?category=&status=&importance=&asset=&start=&end=`) |

Demo walkthrough: [docs/demo/macro-desk.md](docs/demo/macro-desk.md).

---

## Public demo deployment (M1-11)

Goal: a portfolio-safe host that never implies live or real-session data and never needs Tiingo or official calendar network calls.

The public page uses a **synthetic** `DominantDriver` fixture (`fixtures/macro/public-demo.2026-07-29.json`). The embedded date is for schema/structure tests only; the UI labels the page as an illustrative synthetic scenario. Example regimes such as “Rates-led risk-on” are **not** a real-market call for 2026-07-29.

1. Build from a clean checkout (no `data/`, no secrets):
   ```bash
   npm ci
   GAMMADESK_PUBLIC_DEMO=1 npm run build
   GAMMADESK_PUBLIC_DEMO=1 npm run start
   ```
2. On the host (Vercel / similar), set **only**:
   - `GAMMADESK_PUBLIC_DEMO=1`
   - Do **not** set `TIINGO_TOKEN`, do **not** upload `data/`
3. Expected behaviour:
   - `/` shows **Illustrative demo · synthetic scenario** plus catalyst banner **Illustrative catalyst demo · synthetic events**
   - Disclaimer: **Synthetic values for product demonstration — not actual market observations.**
   - Confidence shows `N/100 (uncalibrated)` — no band labels
   - `/?source=live` shows **Live data unavailable in public demo** (no silent fixture, no live label)
   - Page title / description are portfolio-oriented; GitHub link in header/footer
   - `/api/catalysts` returns only synthetic fixtures (`mode: synthetic_demo`) — never BLS/BEA

Preview public mode locally without touching daily:

```bash
GAMMADESK_PUBLIC_DEMO=1 npm run dev
# then open / and /?source=live
```

This milestone does **not** wire cloud Tiingo. Creating the external host is left to you after acceptance.

---

## Daily pipeline & failure behaviour

1. **ingest** — network pull, write `data/bars/`, write immutable `data/snapshots/<session>.json` (compute).
2. **interpret** — read snapshot only; build `DominantDriver`; **atomic** write to `data/drivers/<session>.json` (temp + rename).
3. **status** — `data/pipeline/status.json` records ok/error.
4. **catalyst:fetch** (optional) — BLS + BEA + FOMC schedules; atomic write `data/catalyst/calendar-latest.json`. Partial provider failure still writes when at least one source succeeds; all failing leaves the prior file untouched.

On failure:

- The previous valid driver file is **not** overwritten.
- The desk shows **pipeline error** and/or **stale** while still rendering the last good driver when one exists.
- A **present but malformed** live driver never silently falls back to the fixture.
- Catalyst: missing/malformed calendar cache → `live_unavailable` (not synthetic); stale cache → `stale_calendar` with data + warning.

---

## Data security boundary

| Path | In git? | Notes |
| --- | --- | --- |
| `.env` / tokens | **No** | Local only; see `.env.example` |
| `data/bars/` (incl. Tiingo EOD) | **No** | gitignored raw cache |
| `data/snapshots/`, `data/drivers/`, `data/pipeline/`, `data/calibration/`, `data/catalyst/` | **No** | Generated locally |
| `fixtures/macro/**` | Yes | Contracts, scenarios, **synthetic public-demo fixture** — no Tiingo redistribution |
| `fixtures/catalyst/**` | Yes | Synthetic events + recorded provider fixtures for offline tests |
| `fixtures/macro/calibration/*.json` | Yes | Aggregates only |

Do not commit tokens, Tiingo bars, or generated `data/`. Do not put `TIINGO_TOKEN` on the public demo host. No BLS/BEA API key is required.

---

## What “uncalibrated” means

`confidence.score` is a deterministic 0–100 audit number from geometric-mean components. While `confidence.calibrated` is `false`:

- UI may show e.g. `68/100 (uncalibrated)`.
- UI **must not** show high / medium / low band labels.
- Reporting infrastructure (`npm run calibrate`) exists; **multi-quarter outcome-linked** calibration is still pending — parameters stay unchanged until that review.

---

## Milestone status

Milestone 1 Macro path through **M1-11**; Milestone 2 through **M2-2C1** (schedules + BLS CPI/Employment actuals, local fetch). Consensus/surprise, BEA results, and decision parsing remain out of scope. Market Temperature stays in the backlog.
