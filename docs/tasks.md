# Tasks

Living build plan. Update status as work lands. Definition of done for each phase is explicit.

## Current focus

**Milestone 1 — Cross-Asset Macro** (specs corrected; ready to implement)

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
| M1-1 | Verify sources hands-on | Treasury, CBOE and Tiingo responses checked for actual dates and fields per symbol; results recorded in `architecture.md` — ✅ Treasury and CBOE verified, Stooq rejected, **Tiingo blocked on token** |
| M1-2 | Zod contracts from `data-contracts.md` 0.2.0 | Fixtures validate; `RegimeSignatureConfig` has its own schema |
| M1-3 | Transforms + z-scores | Window ends at `t-1`; MAD about zero; `sigmaRaw == 0` → `volUnavailable` + `repeatedPrints` |
| M1-4 | Signature scoring + confidence | Cosine re-normalized on observed dims; six components incl. `distinctiveness` and block-based `effectiveBreadth`; weighted geometric-mean aggregation; all four hard override rules implemented |
| M1-5 | Property tests | Sign-flip, positive-scaling (unsaturated fixture), permutation invariance all pass; correlated-block case proves `effectiveConfirmations ≤ 1` for a rates-only move |
| M1-6 | Scenario fixtures | fed_rates easing, inflation, growth, risk-off, mixed_unresolved, single_asset_shock, insufficient_data |
| M1-6b | Calibrate `confidenceParams` | `marginRef`, `ambiguityFloor`, concentration threshold, `λ`, sigma floors and band cut-offs set from fixtures; `calibrated: true` |
| M1-7 | Ingest + snapshot writer | No forward-fill; gaps flagged; BTC snapped to equity sessions; year-boundary merge for Treasury; response validation rules enforced; immutable snapshot with versions |
| M1-8 | Template interpretation + guardrails | Numeric guardrail rejects prose citing unreferenced numerals; LLM path falls back to template |
| M1-9 | Macro desk UI | Normalized changes, z-scores, confirming/contradicting, regime, `confidenceScore` with component breakdown, evidence, `proxyFor` labels, staleness banner; no high/medium/low band labels while `calibrated: false` |

**Exit criteria:** fixtures and live sources both yield contract-valid `DominantDriver`; a stale or incomplete session renders as *Latest complete macro snapshot* rather than “Today”; compute has no network dependency; no Gamma or Close code exists.

### Deferred out of Milestone 1

| Item | Unblocked by |
| --- | --- |
| Geopolitical attribution for risk-off | Catalyst module |
| `positioning_driven` regime | Gamma module |
| Intraday refresh | M1.5, needs an intraday rate source |
| Credit spreads | Reserved contract slot, source undecided |
| True DXY and VIX spot | Paid index source |
| 2s10s as a scoring dimension | Would double-count 2Y/10Y; stays derived evidence only |

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
