# GammaDesk

**Read-only macro structure copilot.**

Module chain: **Driver → Catalyst → Structure → Confirmation → Updated View**

**Shipped surfaces:** Macro Desk (regime + SPY/QQQ bounded gamma + tier-1 catalysts), Market (live Alpaca quotes), AI Study (daily briefing from current real inputs).

**Public vs private:** this repo ships **contracts, methodology, interfaces, and synthetic examples only**. Private thresholds, portfolio data, allocation policy, and decision logs live in a **separate private repository**.

**Public portfolio demo:** **Synthetic Demo Data — illustrative, not market data.** All demo research uses bundled fixtures only; never reads `data/`. Repository: [hreisis/trading-gamma-desk](https://github.com/hreisis/trading-gamma-desk).

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

Docs: [V2 roadmap](docs/v2-roadmap.md) · [product](docs/product.md) · [architecture](docs/architecture.md) · [contracts](docs/data-contracts.md) · [tasks](docs/tasks.md) · [AGENTS](AGENTS.md)

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

**Portfolio market panel:** open [`/market`](http://localhost:3000/market) for SPY, QQQ, BTC/USD, and optional `ALPACA_WATCHLIST` symbols via Alpaca snapshots. Missing `APCA_API_KEY_ID` / `APCA_API_SECRET_KEY` shows **Alpaca not configured** — no Tiingo or desk fixture fallback on this surface. Public demo serves labelled synthetic quotes only. Free/paper accounts should set `CATALYST_MARKET_FEED=iex` in local `.env` (SIP requires paid entitlement).

**AI Study:** open [`/ai-study`](http://localhost:3000/ai-study) for a daily briefing from current macro, catalyst, bounded gamma, and market quotes when `OPENAI_API_KEY` is configured locally. Public demo serves `fixtures/ai-study/public-demo.briefing.json` only — never calls OpenAI or live providers.

| Command | Purpose |
| --- | --- |
| `npm run daily` | Full refresh (`--force` replaces today’s snapshot) |
| `npm run ingest` | Pull + compute snapshot + cache SPY bars (`data/bars/SPY.json`) |
| `npm run interpret` | Snapshot → atomic driver write |
| `npm run catalyst:fetch` | Pull BLS/BEA/FOMC **schedules** → `data/catalyst/calendar-latest.json` |
| `npm run catalyst:results:fetch` | Pull BLS CPI/Employment **actuals** → `data/catalyst/results-latest.json` |
| `npm run catalyst:documents:fetch` | Pull Fed/BLS/BEA **official release documents** → `data/catalyst/documents-latest.json` |
| `npm run catalyst:briefs:build` | Build **rule-based evidence briefs** from local documents → `data/catalyst/briefs-latest.json` (offline) |
| `npm run catalyst:briefs:enhance` | Rewrite eligible briefs via OpenAI Responses API → `data/catalyst/ai-briefs-latest.json` (reads briefs cache only) |
| `npm run catalyst:market-context:fetch` | Fetch observed ETF moves around releases → `data/catalyst/market-context-latest.json` (Alpaca bars; reads calendar/results caches only) |
| `npm run catalyst:market-reactions:build` | Classify M2-4A snapshots into reaction patterns → `data/catalyst/market-reactions-latest.json` (offline) |
| `npm run catalyst:market-reactions:enhance` | Evidence-grounded AI narratives over 4A/4B → `data/catalyst/ai-market-reactions-latest.json` (reads context+reactions only) |
| `npm run catalyst:integration:smoke` | M2-5A-Lite integration smoke (manual; see below) |
| `npm run catalyst:update` | M2-5B unified incremental update (manual; see below) |
| `npm run smoke:demo` | Public-demo + deploy smoke tests |
| `npm run smoke:demo:prod` | Public-demo `next build` + `next start` HTTP smoke |
| `/market` | Portfolio watchlist — Alpaca when `APCA_*` configured; synthetic fixtures in public demo |
| `/ai-study` | AI market briefing — OpenAI when `OPENAI_API_KEY` configured locally; synthetic fixture in public demo |
| `GET /api/alpaca/health` | Alpaca credential + connectivity status |
| `GET /api/alpaca/market` | Watchlist quotes JSON for the Market panel |
| `GET /api/ai-study` | AI Study briefing JSON |
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

**Official release documents (M2-3A):** `npm run catalyst:documents:fetch` writes `data/catalyst/documents-latest.json` (independent of calendar/results). Sources: Fed monetary-policy press RSS, BLS CPI + Employment Situation RSS, BEA news RSS (GDP / Personal Income / Trade only). Documents are evidence — linked onto existing catalysts when family+period (or schedule day) match; never expanded into dozens of new catalysts. Default UI shows a 30-day Official Updates window. No LLM summaries; FOMC statement text is stored/linked without parsing rates, votes, or SEP. Public demo uses labelled synthetic document fixtures only.

**Evidence-grounded briefs (M2-3B):** `npm run catalyst:briefs:build` reads local documents (optional results for cross-check) and writes `data/catalyst/briefs-latest.json` — **offline only**. Each fact cites an exact excerpt + offsets from the official document. UI labels these **Rule-based facts** (not AI, not a substitute for the full release). Unextracted ≠ agency omitted. No hawkish/dovish or trade advice. Public demo derives briefs from synthetic documents at load time.

**AI official briefs (M2-3C):** `npm run catalyst:briefs:enhance` reads `briefs-latest.json` only (no documents/calendar/results fetch) and writes `data/catalyst/ai-briefs-latest.json`. The LLM sees verified facts + evidence excerpts + controlled metadata — **not** full document text. Output is validated locally (citations, numbers, prohibited inference); `rejected` / `unavailable` falls back to the rule-based brief. Configure with `OPENAI_API_KEY` and optional `CATALYST_LLM_MODEL` (config default `gpt-5.6-luna`). ChatGPT/Cursor subscription credits are **not** API credits. Tests use an injected fake narrator — CI never calls OpenAI. Public demo serves checked-in synthetic AI fixtures labelled **Demo AI brief · Synthetic data**.

**Event market context (M2-4A):** `npm run catalyst:market-context:fetch` reads local calendar + results caches only and writes `data/catalyst/market-context-latest.json`. Uses Alpaca Historical Stock Bars (`APCA_API_KEY_ID` / `APCA_API_SECRET_KEY`, optional `CATALYST_MARKET_FEED`, default `sip`) for ETF proxies **SPY / QQQ / IWM / TLT / UUP / GLD** — labelled as ETF proxies, never as DXY, yields, or official index levels. Windows: baseline (last bar before event), +5m, +30m, +2h, regular-session close. UI states **Observed movement does not establish causation**. Missing credentials → unavailable (no fake prices). Public demo uses synthetic fixtures only — never calls Alpaca.

**Deterministic market reactions (M2-4B):** `npm run catalyst:market-reactions:build` reads market-context plus official briefs/calendar for **input identity** (offline; classification remains 4A-rule-based) and writes `data/catalyst/market-reactions-latest.json`. Versioned display deadbands classify each ETF proxy window as up/down/flat; equity breadth uses SPY/QQQ/IWM only; leadership uses QQQ−SPY / IWM−SPY spreads; cross-asset signatures stay ETF/proxy language. Deadbands are **not** statistical significance. `insufficient` / `mixed` are conservative classifications, not errors. Public demo derives reactions from synthetic M2-4A snapshots via the same rules engine. The feed drops 4B/4C rows whose `officialFactsIdentity` no longer matches current official facts.

**AI market-reaction narratives (M2-4C):** `npm run catalyst:market-reactions:enhance` reads **only** `market-context-latest.json` + `market-reactions-latest.json` (no Alpaca, calendar, documents, briefs, or news) and writes `data/catalyst/ai-market-reactions-latest.json`. The LLM reorganizes cited 4A percentage changes + 4B rule classifications into a short observed-market narrative — **not** causation, hawkish/dovish, risk-on/off, or trade advice. Local hard validation (citations, numbers, entities, prohibited wording); `rejected` / `unavailable` falls back to the rule-based 4B pattern. Configure with `OPENAI_API_KEY` and optional `CATALYST_REACTION_LLM_MODEL` (config default `gpt-5.6-luna`). Tests use an injected fake narrator — CI never calls OpenAI. Public demo serves checked-in synthetic fixtures labelled **Demo AI reaction brief · Synthetic data**.

**4A vs 4B vs 4C:** 4A stores objective ETF proxy price changes; 4B applies deterministic rule classification; 4C AI only organizes already-cited observed evidence. The validator can check citations, numbers, entities, and banned phrasing, but cannot mathematically prove every natural-language claim is entailed by the input — UI always keeps an expand-original-evidence path.

**Integration smoke (M2-5A-Lite):** Manual validation of existing OpenAI adapters — **not** a scheduler. M2-5B (`catalyst:update`) is the unified incremental orchestrator (see below).

```bash
npm run catalyst:integration:smoke -- --dry-run
npm run catalyst:integration:smoke -- --live --max-events 2
```

- **Opt-in:** Without `--live`, zero OpenAI/Alpaca calls (plan + eligibility only). `--dry-run` forces the same.
- **Cost control:** Max **2** events per OpenAI stage; default writes to an isolated temp dir (does not overwrite business AI caches unless `--update-cache` after a validated stage).
- **Env (repo names):** `OPENAI_API_KEY`, optional `CATALYST_LLM_MODEL` (official briefs), optional `CATALYST_REACTION_LLM_MODEL` (reaction narratives). Alpaca: `APCA_API_KEY_ID` / `APCA_API_SECRET_KEY` — when missing, stage is `awaiting_valid_credentials` (no call, no empty 4A cache, not counted as adapter failure).
- **Report:** gitignored `data/catalyst/integration-smoke-latest.json` (schema `0.1.0`) — statuses/counts/safe error codes only; keys/headers/prompt/response bodies redacted.
- **Overall:** OpenAI success with Alpaca still awaiting → `partial` (full M2-5A not closed). `passed` requires all executable live stages including Alpaca.
- **Tests vs live:** Vitest uses injected fake narrators and never hits the network even if `.env` has keys. Public demo never runs this command and never reads `.env` for providers.
- **Alpaca:** Report **`awaiting_valid_credentials`** (incomplete/invalid key shape), **`authentication_error`** (live 401/403), or **`awaiting_live_smoke`** (shape present, end-to-end not validated). Do not invent or bypass Alpaca auth.

**Unified incremental update (M2-5B):** Manual orchestration — **not** a scheduler.

```bash
npm run catalyst:update -- --dry-run
npm run catalyst:update -- --max-events 2
```

- **Stages:** `official_facts` → `openai_official_brief`; `official_facts` + `market_context_4a` → `reaction_4b` → `openai_reaction_4c`. Official AI briefs stay independent of Alpaca; 4B/4C require both official facts identity and market context.
- **Incremental:** reuses each stage’s identity skip (input / rules / prompt / model / dependency versions). `--force` rebuilds.
- **Safety:** single-instance lock (`update.lock.json`, stale recovery); atomic manifest `data/catalyst/update-latest.json`; provider-wide AI failure preserves prior AI caches; no synthetic fill of live 4A.
- **Dry-run:** zero provider calls, zero business cache writes — plan + eligibility only.
- **M2-5B does not** add cron, database, deployment secrets, or new market-data providers.

### Desk URLs (local)

| URL | Expected |
| --- | --- |
| `/` | Live driver when `data/drivers/` has a valid file; otherwise **demo · fixture fallback**. Catalyst: official calendar when `data/catalyst/calendar-latest.json` exists |
| `/?source=fixture` | Always demo fixture (even if live exists) |
| `/?source=live` | Live only — empty if no drivers (no silent fixture). **Public demo:** macro page shows **Live data unavailable**; Catalyst UI is hidden on that page. `/api/catalysts` still returns `synthetic_demo` (API has no `?source=` gate) — intentional until a later M3 split. |
| `/api/macro/latest` | Same view model as JSON |
| `/api/catalysts` | Public `CatalystFeed` DTO (`?category=&status=&importance=&asset=&start=&end=`) — no cache paths, raw provider errors, or AI token usage |
| `/market` | Portfolio watchlist — Alpaca when `APCA_*` configured; synthetic fixtures in public demo |
| `/ai-study` | AI market briefing — OpenAI when `OPENAI_API_KEY` configured locally; synthetic fixture in public demo |
| `/api/alpaca/health` | Alpaca credential + connectivity status (synthetic unavailable in public demo) |
| `/api/alpaca/market` | Watchlist quotes JSON for the Market panel |
| `/api/ai-study` | AI Study briefing JSON |

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

**Primary boundary:** private thresholds, portfolio holdings, allocation policy, and decision logs belong in a **separate private repository** — not this public repo. `.gitignore` below is secondary protection for local secrets and generated caches.

**This public repo may contain:** contracts, methodology, interfaces, and synthetic examples only.

| Path | In git? | Notes |
| --- | --- | --- |
| `.env` / tokens | **No** | Local only; see `.env.example` |
| Private policy / portfolio / decision log | **Separate private repo** | M7–M9; never committed here |
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

| Milestone | Status |
| --- | --- |
| **M1** Macro (M1-11) | ✅ |
| **M2** Catalyst / events (M2-5B; Alpaca live smoke deferred) | ✅ |
| **M3** Catalyst UI + risk lights (M3-1.5) | ✅ |
| **M4** Gamma bounded provider + Structure·Gamma UI | ✅ |
| **AI Study** | ✅ Shipped — `/ai-study` briefing from live inputs when configured |
| **M7** Private portfolio policy | Planned (private repo) |
| **M9** Shadow mode / review loop | Planned (private repo) |

Consensus/surprise, BEA results series, free-form LLM over full documents, hawkish/dovish inference, and schedulers remain out of scope for the catalyst chain. See [product](docs/product.md) and [tasks](docs/tasks.md).
