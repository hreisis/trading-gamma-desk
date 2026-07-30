# Tasks

Living build plan. Update status as work lands. Definition of done for each phase is explicit.

## Current focus

**Milestone 3 — Catalyst UI.** **M3-1** Catalyst Feed UI (public DTO cards + feed states). No Detail route / This Week UI yet. No Market Temperature / consensus / causation.

### Queued (not started)

| Item | Notes |
| --- | --- |
| **Market Temperature (experimental)** | Deterministic 0–100 risk-on/risk-off summary derived from the canonical snapshot, displayed separately from Signal Confidence, with a five-session trend. Spec only — do not implement until scheduled. |
| **Catalyst → regime linkage** | Later milestone — do not mix catalyst direction into DominantDriver confidence in M2-1. |

### M1-6b calibration status (split)

| Track | Status |
| --- | --- |
| **Calibration reporting infrastructure** | ✅ Done — PIT replay (`npm run calibrate`), commit-safe aggregates in `fixtures/macro/calibration/`, per-day ledgers stay in gitignored `data/calibration/`. Parameters unchanged; `calibrated` remains `false`. |
| **Multi-quarter outcome-linked calibration** | ⏳ Pending — do not retune `marginRef`, `ambiguityFloor`, `λ`, or confidence bands, and do not set `calibrated: true`, until a multi-quarter PIT sample exists and band cut-offs are checked against outcomes. Scenario fixtures stay semantic constraints, not the sole fit target. |

> Until outcome-linked calibration lands, `confidenceParams.calibrated` stays `false` and no surface may render high/medium/low band labels.

---

## Contract changelog

| Version | Change | Reason |
| --- | --- | --- |
| 0.2.0 | Split `asOf` into `marketSessionDate` / `generatedAt`; added `sessionAlignment`, `sourceDateByAsset`, `staleDaysByAsset`, `isCompleteSession` | Upstream publication lag means a single `asOf` cannot state which session the data describes |
| 0.2.0 | `Regime` reduced to `fed_rates`, `inflation`, `growth`, `liquidity`, `risk_sentiment`; added `RegimeFallback` | Prices cannot attribute cause; `risk_off_geopolitics` needs Catalyst, `positioning_driven` needs Gamma |
| 0.2.0 | `confidence` (0–1) → `confidenceScore` (0–100) + `confidenceComponents` | Avoids implying a calibrated probability; makes the number auditable |
| 0.2.0 | Added `contradictions`, `riskDirection`, `polarity`, `AssetRole` enum, `proxyFor`, `methodology` | Milestone 1 required outputs were not expressible in 0.1.0 |
| 0.2.0 | Added `MacroFeature`, `RegimeSignatureConfig`, evidence `id`s | Volatility-window rules and signature versioning must be contractual, not implicit |
| 0.2.0 | Added `distinctiveness` component and `confidenceDetail` | `patternMatch` alone cannot tell “looks like this regime” from “looks like this regime rather than another”; margin required now scales with template similarity |
| 0.2.0 | `breadth` → `effectiveBreadth` over correlation blocks | Counting confirming assets over-counts correlated ones, so a violent 2Y move alone could still produce high `fed_rates` confidence |
| 0.2.0 | Aggregation fixed as weighted geometric mean; band labels gated on `calibrated` | A raw product of five sub-unit terms compresses the 0–100 scale to meaninglessness |
| 0.2.1 | `proxyFor` replaced by registry-owned `symbol` + `instrument` + `isProxy` | 0.2.0 examples used both `GOLD` and `GOLD_PROXY` for one asset; the concept and the measured instrument are now separate fields, so units and proxy status cannot be relabelled by a payload |
| 0.2.1 | `confidenceScore` / `confidenceComponents` / `confidenceDetail` collapsed into one `confidence` object | Each component now carries its own `weight` alongside its `value`, plus `zeroedBy` and `hardCapsApplied` with the triggering `basis`, so a score can be recomputed from its own payload |
| 0.2.1 | Correlation blocks split into `rates`, `growth_commodities`, `haven`, `usd`, `volatility`, `crypto` | 0.2.0 bucketed gold with oil and copper, and VIX with BTC, which discounted genuinely independent confirmations |
| 0.2.2 | `correlationBlocks` → `evidenceBlocks`, `CorrelationBlock` → `EvidenceBlock` | The grouping is an editorial judgement about evidence redundancy, not a measured correlation; the old name asserted something the pipeline never computes |
| 0.2.2 | `effectiveBreadth` denominator is exposure-weighted over scored blocks, never a fixed block count; `confidenceDetail` gains `blocksScored` and `exposureTotal` | Charging a signature for blocks it places no weight on penalised evidence it never claimed, and missing data was being counted twice |
| 0.2.2 | Flags split into `insufficientHistory`, `missingAdjacentSession`, `repeatedPrints`, `invalidPrice`; `gapSkipped` removed | These fail for different reasons and need different fixes; `gapSkipped` also implied bridging a gap was acceptable |
| 0.2.2 | `window.validCount` may be shorter than `length`, with `sessionDates` matching `validCount` | An insufficient-history feature was literally unrepresentable under 0.2.1, which surfaced while implementing M1-3 |

---

## Phase 0 — Foundation

| ID | Task | Done when | Status |
| --- | --- | --- | --- |
| P0-1 | Product docs (`product`, `architecture`, `data-contracts`, `tasks`, `AGENTS`) | Files exist and align with backbone principles | ✅ |
| P0-2 | Private backbone gitignored | `docs/BACKBONE.md` ignored; not committed | ✅ |
| P0-3 | Initial commit of public scaffolding | Clean `main` with README + docs + AGENTS | pending |
| P0-4 | Stack decision | Recorded in `architecture.md` | ✅ single TypeScript app |

---

## Milestone 1 — Cross-Asset Macro

Assets: Gold, Copper, BTC, Oil, US 2Y, US 10Y, USD proxy, VIX. No Gamma, no Close Intelligence, no Catalyst.

| ID | Task | Done when |
| --- | --- | --- |
| M1-1 | Verify sources hands-on | Treasury, CBOE and Tiingo responses checked for actual dates and fields per symbol; results recorded in `architecture.md` — ✅ all sources verified, Stooq rejected, probe reproducible via `npm run verify:tiingo`, holiday set reconciled against a second source |
| M1-2 | Zod contracts from `data-contracts.md` 0.2.1 | Fixtures validate; `RegimeSignatureConfig` has its own schema — ✅ 30 contract tests green, `tsc` and `next build` clean |
| M1-3 | Transforms + z-scores | Window ends at `t-1`; MAD about zero; `sigmaRaw == 0` → `volUnavailable` + `repeatedPrints` — ✅ session calendar, simple returns, floor boundary and eight counterexample classes covered by 33 tests |
| M1-4 | Signature scoring + confidence | Cosine re-normalized on observed dims; six components incl. `distinctiveness` and block-based `effectiveBreadth`; weighted geometric-mean aggregation; all four hard override rules implemented — ✅ `classifyDriver` + 16 scoring tests; placeholders `highBandFloor=70` / `zNoiseFloor=0.5` documented as uncalibrated |
| M1-5 | Property tests | Sign-flip, positive-scaling (unsaturated fixture), permutation invariance all pass; correlated-block case proves `effectiveConfirmations ≤ 1` for a rates-only move — ✅ 10 property tests; sign-flip keeps confirming membership (does not swap roles); scaling requires unsaturated strength |
| M1-6 | Scenario fixtures | fed_rates easing, inflation, growth, risk-off, mixed_unresolved, single_asset_shock, insufficient_data — ✅ `fixtures/macro/scenarios.m1.json` + 8 scenario acceptance tests against `classifyDriver` |
| M1-6b | Calibrate `confidenceParams` | **Reporting infra ✅** (`npm run calibrate`, `fixtures/macro/calibration/report-2026-07-29.json`). **Outcome-linked fit ⏳** — params unchanged, `calibrated: false` until multi-quarter review |
| M1-7 | Ingest + snapshot writer | No forward-fill; gaps flagged; BTC snapped to equity sessions; year-boundary merge for Treasury; response validation rules enforced; immutable snapshot with versions — ✅ `src/ingest/*`, `npm run ingest`, offline parser tests; live bars in gitignored `data/`; public freeze keeps only Treasury/CBOE + summary (no Tiingo EOD redistribution) |
| M1-8 | Template interpretation + guardrails | Numeric guardrail rejects prose citing unreferenced numerals; LLM path falls back to template — ✅ `interpretSnapshot` reads compute snapshot only, copies confidence verbatim, template generator + equity-claim/band-label/number guardrails; no LLM on this path |
| M1-9 | Macro desk UI | Normalized changes, z-scores, confirming/contradicting, regime, `confidence.score` with component breakdown, evidence, instrument/proxy labels, staleness banner; no high/medium/low band labels while `calibrated: false` — ✅ `loadMacroDesk` + `/api/macro/latest` + desk page (local driver or fixture; no classify in UI) |
| M1-10 | Productization wrap-up | Loading / empty / malformed / stale / pipeline-error states; malformed live never silent-fixtures; `npm run daily` atomic driver write keeps last good; README + demo frames; no Tiingo/`data/` in git — ✅ |
| M1-11 | Public demo deployment | `GAMMADESK_PUBLIC_DEMO=1` serves synthetic `public-demo.2026-07-29` fixture; banner **Illustrative demo · synthetic scenario** + synthetic disclaimer; `?source=live` → **Live data unavailable in public demo**; portfolio meta + GitHub link; no cloud Tiingo / no `data/` on host — ✅ |

**Exit criteria:** fixtures and live sources both yield contract-valid `DominantDriver`; a stale or incomplete session renders as *Latest complete macro snapshot* rather than “Today”; compute has no network dependency; no Gamma or Close code exists. Public deploy is fixture-only (M1-11).

---

## Milestone 2 — Catalyst / Events

| ID | Task | Done when |
| --- | --- | --- |
| M2-1 | Catalyst core foundation | Canonical Catalyst schema; deterministic normalize/dedupe; synthetic fixtures; `/api/catalysts` filters; minimal Catalyst Feed UI; public-demo banner **Illustrative catalyst demo · synthetic events**; no news fetch / LLM / macro scoring changes — ✅ |
| M2-2A | Official US macro calendar ingestion | BLS ICS + BEA JSON adapters; explicit event registry; injectable window (now−1d…now+45d); `npm run catalyst:fetch` → gitignored `data/catalyst/calendar-latest.json`; local loader surfaces missing/stale/partial; public demo stays synthetic-only (no BLS/BEA network); schedule ≠ observed print — ✅ |
| M2-2B | Official FOMC calendar ingestion | Federal Reserve HTML adapter (`fomccalendars.htm`); policy decision 2:00 p.m. ET + Chair press conference 2:30 p.m. ET; SEP flagged on decision only; EST/EDT via America/New_York; three-provider partial/all-fail; no minutes auto-schedule, no decision text — ✅ |
| M2-2C1 | Official BLS release results | CPI + Employment Situation via BLS Public Data API; optional `releaseResult` + calculation `inputs` provenance; archive vs feed materialization (latest per family + linked window only); deterministic BLS period ordering; linking diagnostics by family+period; consensus/surprise unavailable; public-demo synthetic results only — ✅ |
| M2-3A | Official release document ingestion | Fed monetary-policy press RSS + BLS CPI/Employment RSS + BEA news RSS (GDP/PI/Trade); canonical `OfficialDocument`; strict document↔catalyst linking; content-hash revisions; `catalyst:documents:fetch` → `documents-latest.json`; 30-day feed vs archive; no LLM / no rate-decision parsing; public-demo synthetic documents only — ✅ |
| M2-3B | Evidence-grounded deterministic briefs | Per-document-type extractors; `OfficialBrief` with exact excerpt offsets; structured-result cross-check; `catalyst:briefs:build` → `briefs-latest.json` (offline); 30-day UI window; Rule-based summary label; no LLM / hawkish-dovish / trade advice — ✅ |
| M2-3C | Evidence-grounded LLM briefs | `OfficialAiBrief` + `BriefNarrator`; OpenAI Responses API (`OPENAI_API_KEY` / `CATALYST_LLM_MODEL`); facts/excerpts only; local citation/number/prohibited validation; `catalyst:briefs:enhance` → `ai-briefs-latest.json`; rejected/unavailable → rule-based fallback; public-demo synthetic AI fixtures; tests use fake narrator — ✅ |
| M2-4A | Event market-context snapshots | `EventMarketContext` + `MarketDataProvider`; Alpaca Historical Stock Bars (`APCA_*`, `CATALYST_MARKET_FEED`); ETF proxies SPY/QQQ/IWM/TLT/UUP/GLD; +5m/+30m/+2h/close; no look-ahead; `catalyst:market-context:fetch` → `market-context-latest.json`; causation disclaimer; public-demo synthetic fixtures; tests use fake provider — ✅ |
| M2-4B | Deterministic market-reaction classification | `EventMarketReaction` + versioned deadbands/leadership/development rules; offline `catalyst:market-reactions:build` → `market-reactions-latest.json`; breadth/signature/observations with ruleIds; no LLM/causation/risk-on; public-demo derives from synthetic M2-4A — ✅ |
| M2-4C | Evidence-grounded AI market-reaction narratives | `AiMarketReactionNarrative` + `MarketReactionNarrator`; OpenAI Responses API (`OPENAI_API_KEY` / `CATALYST_REACTION_LLM_MODEL`); cites 4A/4B evidence only; local validation; `catalyst:market-reactions:enhance` → `ai-market-reactions-latest.json`; rejected/unavailable → 4B fallback; public-demo synthetic AI fixtures; fake narrator in tests — ✅ |
| M2-5A-Lite | OpenAI live smoke + Alpaca deferred gate | `npm run catalyst:integration:smoke` (`--dry-run` / explicit `--live --max-events 2`); reuses M2-3C/M2-4C adapters; isolated output; sanitized report `integration-smoke-latest.json`; Alpaca = `awaiting_valid_credentials` / `awaiting_live_smoke`; CI/public-demo zero network — ✅ Lite; **Full M2-5A partial until Alpaca live smoke** |
| M2-5B | Unified incremental catalyst update | `npm run catalyst:update` (`--dry-run` / `--max-events 2` / `--force`); stages official_facts→AI brief; official_facts+4A→4B→4C; 4B input identity includes official event/facts; identity incremental skip; run lock + stale recovery; atomic manifest `update-latest.json`; no scheduler — ✅ |
| M2-2C | Consensus / surprise / BEA / more series | Deferred — PPI/JOLTS/ECI, BEA results, consensus, surprise, FOMC decision text parsing |
| M2-2+ | News / X / free-form LLM over full docs | Deferred |

---

## Milestone 3 — Catalyst UI

| ID | Task | Done when |
| --- | --- | --- |
| M3-0 | UI / cache contract audit | Data-flow, identity, demo/live isolation, readiness — ✅ (read-only) |
| M3-0.5 | Contract hardening | Feed drops 4B/4C on `officialFactsIdentity` mismatch; Zod `CatalystFeed` public DTO strips paths/errors/usage/internal identities; docs align This Week field ownership (no new persisted fields); no Detail/This Week UI — ✅ |
| M3-1 | Catalyst Feed UI | Card layout: title/category/importance/time/status, Official Brief + citations, market reaction core window or explicit awaiting/unavailable; loading/empty/error/partial states; public DTO only; tests — ✅ |

### Deferred out of Milestone 1

| Item | Unblocked by |
| --- | --- |
| Geopolitical attribution for risk-off | Catalyst module |
| `positioning_driven` regime | Gamma module |
| Intraday refresh | M1.5, needs an intraday rate source |
| Credit spreads | Reserved contract slot, source undecided |
| True DXY and VIX spot | Paid index source |
| 2s10s as a scoring dimension | Would double-count 2Y/10Y; stays derived evidence only |
| Market Temperature (experimental) | Explicit schedule — see Queued above; not part of M1-11 |

---

## Phase 1 — Contracts & compute skeleton

| ID | Task | Done when |
| --- | --- | --- |
| P1-1 | Formalize schemas (JSON Schema or Zod/Pydantic) from `data-contracts.md` | Types validate sample fixtures |
| P1-2 | Macro feature stub (z-score helpers + DominantDriver builder) | Fixture → valid `DominantDriver` JSON |
| P1-3 | Gamma structure stub (levels + since-open deltas) | Fixture → valid `MarketStructureState` |
| P1-4 | Guardrail tests for flow language | Inferred vs reported assertions pass |

**Exit criteria:** Deterministic compute path produces contract-valid JSON from fixtures (no live vendors required).

---

## Phase 2 — Desk UI (structure-first)

| ID | Task | Done when |
| --- | --- | --- |
| P2-1 | App shell | Single composition desk layout loads |
| P2-2 | Gamma primary panel | Structure badge, spot/flip/walls/range, since-open, one-liner |
| P2-3 | Macro driver panel | Regime + confidence + evidence list |
| P2-4 | Wire fixture/API snapshot | UI renders from contract JSON |

**Exit criteria:** Trader can read structure edge and dominant driver from fixture data in one viewport.

---

## Phase 3 — Interpretation & close loop

| ID | Task | Done when |
| --- | --- | --- |
| P3-1 | Thesis composer | Emits `MarketThesis` from driver + catalyst + structure |
| P3-2 | Close intelligence builder | Emits `CloseIntelligence` + `ViewUpdate` from EOD fixtures |
| P3-3 | Narrative validation UI | Confirmed / partial / rejected with evidence |
| P3-4 | Prompt + output validation | LLM output rejected if schema/guardrails fail |

**Exit criteria:** Full day loop demonstrable on fixtures: open thesis → structure → close validation → next-day view.

---

## Phase 4 — Live data (post-MVP gate)

| ID | Task | Done when |
| --- | --- | --- |
| P4-1 | Choose and integrate market data vendor(s) | Live macro + equity snapshots with `asOf` |
| P4-2 | Options/GEX source | Live or delayed GEX for SPX/SPY/QQQ |
| P4-3 | Event calendar feed | CatalystDigest populated for session |
| P4-4 | Ops: secrets, rate limits, caching | Documented runbook; no secrets in repo |

**Exit criteria:** One live US session can be followed end-to-end without fixture swap (quality bar TBD).

---

## Parking lot

- 20Y yield as macro input
- Multi-user auth
- True reported ETF create/redeem flows
- Non-US primary session UX

---

## How to update this file

1. Mark task rows done in place (strike or ✅).
2. Move **Current focus** to the active phase.
3. Do not expand MVP scope here without updating `product.md`.
