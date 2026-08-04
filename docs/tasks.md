# Tasks

Living build plan. Update status as work lands. Definition of done for each phase is explicit.

## Current focus

**Milestone 6 — Constrained LLM study agent (✅ complete through M6-4).** M5-3/M5-4 and M6-1…M6-4 shipped: deterministic similar-regime evidence, constrained memo agent, integration smoke, and end-to-end `studies:pipeline`. **M6 exit criteria satisfied** (see below).

**Next public milestone:** **M8 — Minimal decision interface** — **M8-1** decision surface (✅), **M8-2** uncertainty + exact-date study artifacts (✅), **M8-3** auditable evidence drill-down (✅). **M7** private policy remains a separate private-repo track.

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
| 0.1.1 | `EstimatedGammaStructure` + `oi_gex_proxy_v1` methodology | Renamed `zeroDte.shareOfAbsStrikeGex` → `shareOfGrossGex` (gross 0DTE / gross total); Zod validates [0, 1]; fixture provider returns null for missing files, throws on malformed parse |
| 0.1.0 | `GammaHistoricalSnapshot` + `GammaChangeSet` (M4-2) | Immutable as-of snapshots with explicit `captureKind`; append-only store; prior-close / session-open change metrics with explicit unavailable |
| 0.1.1 | `GammaChangeSet` (M4-2A) | Snapshot envelope/structure invariants; instant-ordered baselines; O_EXCL append; `pctChange` explicit unavailable when baseline is zero |
| 0.1.0 | `GammaHistoricalSnapshot` store (M4-2B) | Same-dir temp + fsync + hard-link publication; final visible only when complete; temp cleanup on success/failure |
| 0.1.0 | `GammaHistoricalSnapshot` store (M4-2C) | Collision-safe temp names; temp cleanup on write/fsync failure; async subprocess concurrency tests |
| 0.1.0 | `MarketStructureState` (M4-3) | Desk-ready features from matched snapshot + change set; wall corridor; directed changes; no scores/signals |
| 0.2.0 | `MarketStructureState` (M4-3C) | Bounded-aware interpretation layer from `BoundedGammaProviderSnapshot` + optional `GammaChangeSet`; condition taxonomy; evidence + plain-English interpretation; flip never fabricated |
| 0.1.0 | `ReplayCorpus` + `ReplayRun` (M5-1A) | Point-in-time frames from stored macro/structure/catalyst artifacts; instant-ordered eligibility; no lookahead |
| 0.1.0 | `DailyResearchArchive` (M5-1B) | Exact-date PIT archive with component provenance, conservative eligibility, embedded corpus+replayRun; atomic gitignored store |
| 0.1.0 | `StudyDefinition` + `StudyForwardOutcome` (M5-2) | PIT study anchor + separate forward 1D/5D/20D returns, MFE/MAE, maturity; never merged into replay inputs |
| 0.1.0 | `StudyMatchProfile` + `SimilarRegimeStudy` (M5-3) | Explicit PIT macro/catalyst/gamma match fields; deterministic similar-regime aggregates; outcomes never affect matching |
| 0.1.0 | `StudyEvidenceBundle` (M5-4) | Deterministic evidence rollup from similar-regime study; explicit status rules; cohort quality + source refs; not a trade signal |
| 0.1.0 | `StudyMemo` (M6-1) | Constrained LLM memo from evidence bundle only; separated evidence/inference/limitations/unknowns; citation + guardrail validation |
| 0.1.0 | Study memo workflow & CLI (M6-2) | `runStudyMemoWorkflow`; exact `--date` + `--bundle`; OpenAI or rule-based fallback; atomic memo store |
| 0.1.0 | Study memo integration smoke (M6-3) | `StudyMemoIntegrationSmokeReport`; live dry-run + offline fake narrator; `sectionCounts` from validated memo |
| 0.1.0 | End-to-end study pipeline (M6-4) | `StudyPipelineManifest` + `runStudyPipeline`; archive → memo; atomic writes under `data/studies/` |
| 0.2.0 | `DecisionSurfaceView` (M8-2) | Exact-date study artifact loading; `DecisionEvidenceSummary`, `ArtifactIntegrityIssue`, display-only strength; stance suppression on integrity failure |

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
| M2-2+ | Unconstrained news / X / full-document LLM | Deferred — M6 delivers constrained study agent over precomputed evidence only |

---

## Milestone 3 — Catalyst UI

| ID | Task | Done when |
| --- | --- | --- |
| M3-0 | UI / cache contract audit | Data-flow, identity, demo/live isolation, readiness — ✅ (read-only) |
| M3-0.5 | Contract hardening | Feed drops 4B/4C on `officialFactsIdentity` mismatch; Zod `CatalystFeed` public DTO strips paths/errors/usage/internal identities; docs align This Week field ownership (no new persisted fields); no Detail/This Week UI — ✅ |
| M3-1 | Catalyst Feed UI | Card layout: title/category/importance/time/status, Official Brief + citations, market reaction core window or explicit awaiting/unavailable; loading/empty/error/partial states; public DTO only; tests — ✅ |
| M3-1.5 | UI densify + Risk Traffic Lights | Merge demo banners; collapse Evidence/Confidence/Diagnostics; compact feed cards (ET time, brief/reaction summaries; details folded); four-state risk lights (Supportive / Caution / Warning / Unavailable) on Driver, Cross-Asset, released Catalysts — high-beta implication, gray when insufficient; pure functions + tests; no DTO/pipeline change — ✅ |

---

## Milestone 4 — Gamma snapshots / features

| ID | Task | Done when |
| --- | --- | --- |
| M4-1 | Estimated Gamma Structure Engine | Provider-neutral options chain port + fixture provider; OI-based Call/Put/Total GEX; Positive/Negative/near_zero regime; Call/Put walls; expiry + 0DTE breakdown; Flip contract-only unavailable (no strike interpolation); methodology/asOf/dataDelay/source/status on every output; pure functions + boundary tests; no UI / no live API / no Macro-Catalyst changes — ✅ |
| M4-1A | GEX correctness hardening | OI=0/gamma=0 valid; gross GEX near-zero + 0DTE share; strict fixture parse; partial if wall missing; no fabricated all-zero walls; documented wall tie-break — ✅ |
| M4-1B | Contract cleanup | Bump `EstimatedGammaStructure` / methodology to 0.1.1; `shareOfGrossGex` [0,1] + float tolerance; fixture missing→null / malformed→throw with path — ✅ |
| M4-2 | Historical Snapshot & Change Engine | Immutable as-of gamma snapshots; prior-close and since-open comparisons; explicit `unavailable` when baseline missing; no overwrite of prior snapshots, no hindsight fill; fixture path + tests; no UI / no live options API — ✅ |
| M4-2A | Snapshot integrity hardening | Envelope/structure invariants; instant-ordered baselines; zero-baseline pct unavailable; safe ID/path encoding; focused tests — ✅ |
| M4-2B | Atomic snapshot publication | Same-dir temp + fsync + hard-link; no partial visibility; temp cleanup on link/idempotency/conflict — ✅ |
| M4-2C | Atomic-publication test/failure cleanup | Async subprocess writers; concurrent reader poll; either-wins conflict; injectable write failure cleanup — ✅ |
| M4-3 | Gamma Feature Layer | Deterministic desk-ready features + `MarketStructureState` 0.1.0 from matched snapshot + change set; wall corridor; directed changes; fixture + tests; no UI / scores / signals — ✅ |
| M4-3B | Bounded MarketData.app Gamma provider | Credit-capped CLI `npm run gamma:fetch` (one symbol / one expiry / explicit strikes); normalize + Greek quality + engine → `BoundedGammaProviderSnapshot`; mocked tests only; no UI / no daily integration — ✅ |
| M4-3C | Gamma Feature Layer (bounded interpretation) | Deterministic `MarketStructureState` 0.2.0 from bounded provider snapshot + optional compatible `GammaChangeSet`; condition taxonomy; evidence + interpretation; preserve bounded wall scope; no flip fabrication; no live API / no UI redesign — ✅ |
| M4-4 | Gamma Desk UI v1 | Read-only Structure·Gamma section from bounded snapshot; empty/malformed states; bounded wall labeling; strike GEX chart; fixture + SSR tests; no live API / no daily integration — ✅ |

**Exit criteria (M4):** Fixture path produces immutable gamma snapshots, honest change comparisons, and a desk-ready structure state; compute remains deterministic and separate from LLM.

---

## Milestone 5 — Strategy research / replay / regime

| ID | Task | Done when |
| --- | --- | --- |
| M5-1A | Point-in-time replay foundation | Versioned `ReplayCorpus` / `ReplayFrame` / `ReplayRun`; latest compatible eligible artifact per source; catalyst only after publishedAt; instant ordering; no lookahead; fixture + tests — ✅ |
| M5-1B | PIT research archive + exact-date offline replay | `DailyResearchArchive` + `StudySourcesManifest`; component provenance; conservative eligibility; atomic write to `data/studies/archive/{date}/daily-research.json`; `studies:build` / `studies:replay` CLIs; reuses M5-1A `ReplayCorpus`/`ReplayRun`; fixture + tests; no network / no latest-fallback — ✅ |
| M5-2 | Study definitions + forward outcomes | `StudyDefinition` + `StudyForwardOutcome`; trading-session 1D/5D/20D adjClose returns, MFE/MAE, maturity; PIT/outcome separation; fixture + tests; no network / no latest-fallback — ✅ |
| M5-3 | Deterministic similar-regime study | `StudyMatchProfile` + `SimilarRegimeStudy`; exact PIT field matching (macro/catalyst/gamma); mature 1D/5D/20D aggregates; outcomes never affect matching; fixture + tests; no network / no ML — ✅ |
| M5-4 | Deterministic evidence bundle | `StudyEvidenceBundle` from M5-3; query context, cohort quality, horizon evidence, explicit status rules (`supported`/`mixed`/`not_supported`/`insufficient_evidence`); source refs + preserved warnings; fixture + tests; no LLM / no trade signals — ✅ |

**Exit criteria (M5):** Operator can run deterministic regime/replay studies from fixtures without LLM or live vendors. **✅ Satisfied** (M5-1A…M5-4).

---

## Milestone 6 — Constrained LLM study agent

| ID | Task | Done when |
| --- | --- | --- |
| M6-1 | Study memo contract + guardrails | `StudyMemo` from `StudyEvidenceBundle` only; prompt builder, provider interface, citation validation, abstain on insufficient evidence; mocked offline tests — ✅ |
| M6-2 | End-to-end study memo workflow | `runStudyMemoWorkflow` + `studies:memo` CLI; exact `--date` + `--bundle`; OpenAI when configured else rule-based fallback; atomic write to `data/studies/memos/{date}/study-memo.json`; offline tests — ✅ |
| M6-3 | Integration smoke | `studies:memo:smoke` live dry-run + offline fake narrator; `StudyMemoIntegrationSmokeReport` with `sectionCounts` from validated memo; gitignored `data/studies/memo-integration-smoke-latest.json` — ✅ |
| M6-4 | End-to-end study pipeline | `studies:pipeline` chains archive → definition → outcomes → similar regime → evidence bundle → validated memo; explicit `--date` + `--manifest`; atomic writes under `data/studies/`; offline tests — ✅ |

**Exit criteria (M6):** LLM produces study briefs/decision memos from cited deterministic inputs only; validation failures never silently pass. **✅ Satisfied** — evidence bundle is the sole LLM input; local validation rejects bad citations/numbers/prohibited language; `rejected`/`unavailable` fall back to rule-based memo or abstain; integration smoke + offline tests cover the path; no trade advice in contracts or guardrails.

**Post-M6 (deferred):** M6-5+ optional enhancements (e.g. full-chain live smoke UI wiring) — not required for M6 exit.

---

## Milestone 7 — Private portfolio policy

**Status:** Planned — **separate private repository**; does not block public **M8** work.

| ID | Task | Done when |
| --- | --- | --- |
| M7-1 | Policy contract (private repo) | Thresholds, sizing, allocation rules, instrument universe — separate private repository, not this repo |
| M7-2 | Policy evaluator | Pure function: evidence + policy → allowed stance/constraints; no LLM |
| M7-3 | Public boundary tests | Public repo/build contains only contracts, methodology, interfaces, synthetic examples; never bundles or reads private policy |

**Exit criteria (M7):** Decide stage runs against policy in the private repo; public repo remains portfolio-safe.

---

## Milestone 8 — Minimal decision interface

**Status:** **Next public milestone** — starts after M6 exit; consumes Observe + Research outputs; Evaluate → Decide in one viewport.

| ID | Task | Done when |
| --- | --- | --- |
| M8-1 | Decision surface | `/decide?date=` SSR viewport: Observe (driver/catalyst/structure) + StudyMemo research w/ citations + public policy-unavailable slot + deterministic non-trade stance; fixture-only; exact date — ✅ |
| M8-2 | Uncertainty + study artifacts | Non-demo `/decide` loads exact-date driver, structure, `StudyEvidenceBundle`, and `StudyMemo` from `data/`; deterministic evidence panel (status, cohort, horizons, MFE/MAE, limitations); display-only strength; memo provenance labels; artifact integrity errors; stance suppressed on study integrity failure; demo stays fixture-only — ✅ |
| M8-3 | Evidence path | Expandable auditable drill-down on `/decide`: full horizons + MFE/MAE, matched sessions, match/similarity fields, limitations/unknowns, memo citation resolution — ✅ |

**Exit criteria (M8):** Operator can Evaluate → Decide from one minimal UI without dashboard clutter.

---

## Milestone 9 — Shadow mode / review loop

| ID | Task | Done when |
| --- | --- | --- |
| M9-1 | Decision log (private repo) | Append-only log in separate private repository: inputs, stance, timestamp |
| M9-2 | Outcome compare | Review step compares log to subsequent snapshots; deterministic diff |
| M9-3 | Calibration feed | Optional hooks for outcome-linked score review (does not auto-set `calibrated: true`) |

**Exit criteria (M9):** Full Observe → … → Review loop demonstrable on fixtures + shadow log in private repo.

---

## Legacy phase map (superseded by M4–M9 for planning)

Phases P1–P4 below remain as historical skeleton references. **Active planning uses M4–M9 above.**

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
- Hosted portfolio accounting / order routing

---

## How to update this file

1. Mark task rows done in place (strike or ✅).
2. Move **Current focus** to the active phase.
3. Do not expand MVP scope here without updating `product.md`.
