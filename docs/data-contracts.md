# Data contracts

Canonical JSON shapes for module I/O. Implementations must validate against these schemas (or generated types derived from them).

Conventions:

- Timestamps: ISO-8601 with offset or `Z`
- Enums are closed for MVP; extend only with a contract version bump
- `schemaVersion`: semver string on top-level payloads
- **Never a single `asOf`.** Separate *what session the data describes* (`marketSessionDate`) from *when we computed it* (`generatedAt`). See “Timing and staleness” below.
- Units are explicit per field. Yields use **bps**, prices use **pct**. Never mix them in one field.
- `confidenceScore` is an integer `0–100` and is a **classification confidence, not a probability**. It has not been calibrated against realised outcomes.

---

## Timing and staleness

Every macro payload must carry provenance for each input. Rules:

1. **No silent forward-fill.** A missing session is `missing`, never the previous value.
2. If input source dates disagree, the payload is not “Today”. UI must say *Latest complete macro snapshot* and show per-asset staleness.
3. `isCompleteSession` is true only when **every core asset** resolves to the same `marketSessionDate`.
4. A single-day change must span **consecutive valid sessions** for that asset. Never divide a two-day gap into a “daily” change.

```json
{
  "marketSessionDate": "2026-07-28",
  "generatedAt": "2026-07-29T08:15:00-04:00",
  "sessionAlignment": "aligned",
  "isCompleteSession": true,
  "sourceDateByAsset": { "US2Y": "2026-07-28", "VIX": "2026-07-28" },
  "staleDaysByAsset": { "US2Y": 0, "VIX": 0 }
}
```

`sessionAlignment`: `aligned` | `partial` | `stale`

---

## Shared enums

```json
{
  "Regime": [
    "fed_rates",
    "inflation",
    "growth",
    "liquidity",
    "risk_sentiment"
  ],
  "RegimeFallback": [
    "mixed_unresolved",
    "single_asset_shock",
    "insufficient_data"
  ],
  "Polarity": ["positive", "negative"],
  "RiskDirection": ["risk_on", "risk_off", "mixed"],
  "AssetRole": ["confirming", "contradicting", "neutral", "missing"],
  "Unit": ["pct", "bps"],
  "InterpretationGenerator": ["template", "llm"],
  "GammaStructureRegime": [
    "positive_compressed",
    "positive_expanding",
    "negative_expanding",
    "near_flip",
    "mixed"
  ],
  "ThesisResult": ["confirmed", "partially_confirmed", "rejected", "inconclusive"],
  "FlowKind": ["reported_flow", "inferred_rotation"],
  "ConfidenceBand": ["low", "medium", "high"],
  "Underlying": ["SPX", "SPY", "QQQ"]
}
```

### Attribution limits (why `Regime` shrank in 0.2.0)

Cross-asset prices alone cannot establish *cause*. Removed values and their gating module:

| Removed in 0.2.0 | Why | Unblocked by |
| --- | --- | --- |
| `risk_off_geopolitics` | Prices can show risk-off; they cannot attribute it to geopolitics | Catalyst / Events module |
| `positioning_driven` | Requires positioning data, which is the Gamma module | Gamma module |
| `idiosyncratic` | Too vague to test; replaced by `single_asset_shock` | — |

`risk_sentiment` + `Polarity` covers what prices *can* support: `negative` polarity is risk-off, `positive` is risk-on, without claiming a cause.

---

## 1. DominantDriver (Macro output)

```json
{
  "$id": "DominantDriver",
  "schemaVersion": "0.2.2",

  "marketSessionDate": "2026-07-28",
  "generatedAt": "2026-07-29T08:15:00-04:00",
  "sessionAlignment": "aligned",
  "isCompleteSession": true,

  "primaryRegime": "fed_rates",
  "polarity": "negative",
  "riskDirection": "risk_on",
  "label": "Rates-led risk-on",

  "confidence": {
    "score": 60,
    "aggregation": "weighted_geometric_mean",
    "components": [
      { "name": "patternMatch", "value": 0.784, "weight": 0.2 },
      { "name": "distinctiveness", "value": 0.37, "weight": 0.2 },
      { "name": "coherence", "value": 0.898, "weight": 0.2 },
      { "name": "effectiveBreadth", "value": 0.6, "weight": 0.2 },
      { "name": "strength", "value": 0.48, "weight": 0.2 }
    ],
    "coveragePenalty": 0,
    "zeroedBy": null,
    "hardCapsApplied": [],
    "calibrated": false,
    "detail": {
      "runnerUpRegime": "liquidity",
      "scoreTop": -0.784,
      "scoreSecond": -0.679,
      "templateSimilarity": 0.9,
      "effectiveConfirmations": 3.0,
      "blocksScored": 5,
      "exposureTotal": 2.6
    }
  },

  "evidence": [
    {
      "id": "ev_us2y",
      "symbol": "US2Y",
      "instrument": "UST 2Y par yield",
      "isProxy": false,
      "statement": "US 2Y fell 8 bps (z = -1.80)",
      "value": -8,
      "unit": "bps",
      "zScore": -1.8,
      "sourceDate": "2026-07-28"
    },
    {
      "id": "ev_usd",
      "symbol": "USD",
      "instrument": "UUP",
      "isProxy": true,
      "statement": "USD via UUP fell 0.60% (z = -1.20)",
      "value": -0.6,
      "unit": "pct",
      "zScore": -1.2,
      "sourceDate": "2026-07-28"
    }
  ],

  "contradictions": ["ev_gold"],

  "assets": [
    {
      "symbol": "GOLD",
      "instrument": "GLD",
      "isProxy": true,
      "value": -0.9,
      "unit": "pct",
      "zScore": -0.7,
      "role": "contradicting",
      "contribution": 0.1,
      "sourceDate": "2026-07-28",
      "staleDays": 0
    }
  ],

  "interpretation": {
    "text": "Front-end yields and the dollar fell together, which reprices policy easing rather than stronger growth.",
    "evidenceIds": ["ev_us2y", "ev_usd"],
    "generator": "template"
  },

  "methodology": {
    "methodologyVersion": "0.2.2",
    "signatureVersion": "sig-2026-07-01",
    "window": 20,
    "excludesCurrentObservation": true,
    "muAssumption": "zero",
    "sigmaEstimator": "mad_about_zero_x1.4826",
    "cosineRenormalizedOnObservedDims": true
  },

  "sourceDateByAsset": { "US2Y": "2026-07-28", "VIX": "2026-07-28" },
  "staleDaysByAsset": { "US2Y": 0, "VIX": 0 }
}
```

**Field rules**

- `primaryRegime` is either a `Regime` or a `RegimeFallback`. When it is a fallback, `label` must not imply a driver.
- When `primaryRegime` is `risk_sentiment`, `label` is `"Risk-on (broad)"` / `"Risk-off (broad)"` — **not** `"Risk-sentiment-led risk-off"`.
- `contradictions` holds `evidence[].id` references, never free text, and each referenced asset’s `role` must actually be `contradicting`.
- `interpretation.evidenceIds` must be a non-empty subset of `evidence[].id`.
- `confidence` is derived only from its own components, deterministically. The interpretation layer may not alter it.
- **Polarity is a signature-axis sign, not an equity recommendation.** `positive` means tightening / higher inflation / stronger growth / tighter liquidity / risk-on *in the template sense*. Template and LLM prose must not translate it into “bullish for stocks” (or the reverse). Prefer explicit disclaimers such as “not a call on equities” when the winning regime is inflation or rates.
- While `confidence.calibrated` is `false`, interpretation and UI may show the numeric score (e.g. `68/100`) but must not attach high/medium/low band labels.

**Input (conceptual):** per-asset daily changes plus a trailing volatility window that **ends at the prior session** (see 1.1). Credit spreads have a reserved slot and may be absent in Milestone 1.

---

### 1.0 Asset registry

`symbol` is the canonical macro concept; `instrument` is what was actually measured. Keeping them separate is what allows the UI to say “Gold (via GLD)” rather than passing an ETF off as the underlying. Units and proxy status are owned by the registry, so no payload can relabel them.

| symbol | unit | block | M1 instrument | proxy |
| --- | --- | --- | --- | --- |
| `US2Y` | bps | rates | UST 2Y par yield | no |
| `US10Y` | bps | rates | UST 10Y par yield | no |
| `COPPER` | pct | growth_commodities | CPER | yes |
| `OIL` | pct | growth_commodities | USO | yes |
| `GOLD` | pct | haven | GLD | yes |
| `USD` | pct | usd | UUP | yes |
| `VIX` | pct | volatility | VIX index | no |
| `BTC` | pct | crypto | btcusd | no |

Blocks express an **editorial judgement about evidence redundancy** for Milestone 1. They are *not* a claim that the members are stably statistically correlated, and nothing in the pipeline measures a correlation matrix. Gold, VIX and BTC each stand alone because each carries information the others do not; bucketing gold with oil and copper would quietly discount a real independent confirmation.

---

### 1.1 MacroFeature (compute layer, internal)

Deterministic per-asset output. Contains every number that any downstream statement may cite.

```json
{
  "$id": "MacroFeature",
  "symbol": "US2Y",
  "instrument": "UST 2Y par yield",
  "isProxy": false,
  "unit": "bps",
  "currentChange": -8,
  "currentFrom": "2026-07-27",
  "currentTo": "2026-07-28",
  "consecutiveSessions": true,
  "window": {
    "length": 20,
    "endsAt": "2026-07-27",
    "sessionDates": ["2026-06-29", "…", "2026-07-27"],
    "validCount": 20
  },
  "sigmaRaw": 4.4,
  "sigmaUsed": 4.4,
  "sigmaFloorApplied": false,
  "zScore": -1.82,
  "flags": []
}
```

**Change rules**

1. `currentChange` spans `t-1 → t`, where `t-1` is the **previous expected session** from the market calendar. Sessions either side of a holiday are adjacent; a genuinely absent session is not.
2. If `t-1` has no valid observation, `currentChange` is `null` with `missingAdjacentSession`. A change is **never** bridged across a gap — doing so would report a multi-session move as a daily one.
3. Price assets use a **simple return** (`p_t / p_{t-1} - 1`), not a log return. Yields use a first difference. Nothing is rounded in the compute layer; rounding belongs to presentation and would otherwise move the number being scored.
4. Reported units are the asset’s contract unit: `pct` means **percentage points** (`0.6` is +0.6%), `bps` means basis points. Sigma floors are expressed in the same units.
5. Price assets require finite, strictly positive inputs. Yields may legitimately be zero or negative, so only non-finite yields are rejected. Either failure is `invalidPrice`.

**Volatility window rules**

1. The window holds the **20 valid single-session changes ending at `t-1`**, so the observation being scored never contributes to the scale it is divided by. `window.endsAt` always equals `currentFrom`.
2. `window.sessionDates` are the **end dates of the historical changes actually used**, ascending. `validCount` may fall short of `length`; a short window is representable but can never yield a z-score, and must carry `insufficientHistory`.
3. A full window needs ≥ 22 consecutive valid points. Ingest should request **45–60 calendar days** to absorb weekends and holidays.
4. `sigmaRaw = 1.4826 × median(|Δ|)`, taken **about zero** to stay consistent with `muAssumption: "zero"`. A median-centred spread paired with a zero-centred numerator would mix two conventions in one ratio.
5. The floor applies **only when `0 < sigmaRaw < floor`**, recording `sigmaUsed` and `sigmaFloorApplied`. At or above the floor, sigma is untouched.
6. If `sigmaRaw == 0`, emit `zScore: null` with **both** `volUnavailable` and `repeatedPrints`, and do **not** let the floor rescue it. Because MAD is a median, zero means more than half the window is identical, which is a data-quality alarm rather than a quiet market.

**Distinct failure reasons.** `insufficientHistory`, `missingAdjacentSession` and `repeatedPrints` fail for different reasons and need different fixes, so they are never collapsed into one flag.

`flags` enum: `insufficientHistory` | `missingAdjacentSession` | `repeatedPrints` | `volUnavailable` | `sigmaFloorApplied` | `invalidPrice` | `stale` | `missing`

---

### 1.2 RegimeSignatureConfig (versioned, schema-validated)

Signature weights are **data, not code** — reviewable and diffable. They get their own schema and version.

```json
{
  "$id": "RegimeSignatureConfig",
  "signatureVersion": "sig-2026-07-01",
  "methodologyVersion": "0.2.0",
  "polarityConvention": "positive = tightening / higher inflation / stronger growth / risk-on",
  "evidenceBlocks": {
    "rates": ["US2Y", "US10Y"],
    "growth_commodities": ["COPPER", "OIL"],
    "haven": ["GOLD"],
    "usd": ["USD"],
    "volatility": ["VIX"],
    "crypto": ["BTC"]
  },
  "blockWeightBudget": {
    "rates": 1.0,
    "growth_commodities": 1.0,
    "haven": 0.8,
    "usd": 0.6,
    "volatility": 0.8,
    "crypto": 0.6
  },
  "signatures": {
    "fed_rates": { "US2Y": 0.7, "US10Y": 0.3, "USD": 0.5, "GOLD": -0.4, "BTC": -0.3, "VIX": 0.2 }
  },
  "riskVector": { "BTC": 0.6, "COPPER": 0.5, "VIX": -0.8, "USD": -0.4, "GOLD": -0.2 },
  "confidenceParams": {
    "marginRef": 0.15,
    "ambiguityFloor": 0.2,
    "concentrationThreshold": 0.6,
    "lambda": {
      "patternMatch": 0.2,
      "distinctiveness": 0.2,
      "coherence": 0.2,
      "effectiveBreadth": 0.2,
      "strength": 0.2
    },
    "calibrated": false
  },
  "sigmaFloors": { "US2Y": 1.0, "US10Y": 1.0, "VIX": 0.5 }
}
```

`confidenceParams.calibrated` must stay `false` until the fixture suite exists. UI must not present band labels (`high` / `medium` / `low`) while it is `false` — show the numeric score and its components instead.

`blockWeightBudget` exists because the 8 dimensions are **not orthogonal** (2Y/10Y correlate strongly; copper and oil share the growth impulse). Plain cosine treats them as independent, so a signature that spreads weight across a correlated block gets an unearned boost. Budgeting weight per block, rather than per asset, contains that bias without attempting covariance whitening on a 20-sample window.

The budget is **mechanically enforced**: the sum of `|w|` a signature spends inside one block may not exceed that block’s budget, and the schema rejects configs that overspend. Blocks must also partition the registry exactly, otherwise `effectiveBreadth` has an ill-defined denominator.

---

### 1.3 Scoring and confidence (normative)

For regime `r` with weight vector `w_r` and observed z-vector `z`, restricted to observed dimensions:

\[ s_r = \frac{w_r \cdot z}{\lVert w_r \rVert \lVert z \rVert} \in [-1, 1] \]

`|s_r|` is pattern match; `sign(s_r)` is `polarity`. Both `w_r` and `z` are re-normalized over **observed dimensions only** when data is missing, and a `coveragePenalty` is applied.

Confidence components, all in `[0, 1]`:

| Component | Definition |
| --- | --- |
| `patternMatch` | `abs(s_top)` — how well today matches the winning signature |
| `distinctiveness` | how far the winner separates from the runner-up (below) |
| `coherence` | confirming contribution / (confirming + \|contradicting\|) contribution |
| `effectiveBreadth` | independent confirmations across correlation blocks (below) |
| `strength` | `min(1, rms(z) / 2)` — is the market moving at all |
| `coveragePenalty` | share of core dimensions missing or stale |

`patternMatch` and `distinctiveness` answer different questions: *does today look like this regime* versus *does it look like this regime rather than another one*. A day can score high on the first and low on the second, and that day is ambiguous, not confident.

#### distinctiveness

```text
templateSimilarity  = abs(cos(w_top, w_second))            over observed dims
effectiveMarginRef  = marginRef × (1 + templateSimilarity)
distinctiveness     = clamp01((abs(s_top) - abs(s_second)) / effectiveMarginRef)
```

The margin required scales with how similar the two competing templates are. When two signatures overlap heavily (growth and inflation share commodity weights), the data genuinely cannot separate them, so the same raw gap should buy less confidence. `marginRef` lives in `RegimeSignatureConfig` and is calibrated from fixtures.

This component also supersedes a separate ambiguity threshold: `mixed_unresolved` is decided by `distinctiveness` falling below `ambiguityFloor`.

#### effectiveBreadth

Counting confirming assets directly over-counts redundant ones — 2Y and 10Y agreeing is not two independent confirmations. Breadth is measured over `evidenceBlocks`, **weighted by the exposure the winning signature actually takes in each block**:

```text
scored blocks = blocks that both
                  (a) carry non-zero weight in the winning signature, and
                  (b) have at least one valid current observation

for each scored block b:
    exposure_b     = min(Σ_{i∈b, observed} |w_i|, blockWeightBudget_b)
    confirmRatio_b = (# confirming among observed non-zero-weight members)
                     / (# observed non-zero-weight members)              // ≤ 1

effectiveConfirmations = Σ_b confirmRatio_b            // a count, for the hard gate
effectiveBreadth       = Σ_b exposure_b × confirmRatio_b / Σ_b exposure_b
```

**Role assignment** against the winning signature (after cosine and polarity are known):

```text
missing        — no usable z-score
neutral        — signature weight is 0, or |z| < zNoiseFloor (placeholder 0.5),
                 or w·z = 0
confirming     — sign(w·z) == sign(s_top)
contradicting  — sign(w·z) != sign(s_top)
```

`contribution = (w·z) / Σ|w·z|` over observed members of the winning signature. The noise floor is uncalibrated until M1-6b; it exists so a half-sigma wiggle cannot mint a confirmation.

Two properties matter:

1. **The denominator is never a fixed block count.** Only blocks the winning signature actually uses, and for which data exists, can appear. Charging a signature for a block it places no weight on would penalise it for evidence it never claimed.
2. **Missing data is penalised once.** It is handled by `coveragePenalty` and the hard gates, and does not also inflate the breadth denominator.

`effectiveConfirmations` stays an unweighted sum so the hard gate keeps its plain meaning — “at least two independent confirmations” — while `effectiveBreadth` reports the exposure-weighted share that confirmed, which is what belongs in a `[0, 1]` score component.

This is what defeats the failure case where 2Y alone moves violently and `fed_rates` still scores high: the rates block caps at one confirmation, so `effectiveConfirmations` cannot reach 2.

#### Aggregation

```text
gate  = Π_i component_i ^ λ_i        with Σ λ_i = 1   (λ default: equal)
score = round(100 × clamp01(gate - coveragePenalty))

if any component_i <= 0:
    score    = 0                     // explicit, not merely a small product
    zeroedBy = name of that component
```

A **weighted geometric mean**, not a raw product. Multiplicative gating is the right shape — any component at zero vetoes the score, and weak components drag the result down in log space rather than being averaged away. But a raw product of five sub-unit terms compresses everything toward zero and makes the 0–100 scale meaningless (five plausible components at ~0.8 would yield 33). The geometric mean keeps the veto property while leaving the scale usable. Non-negotiables are enforced by the hard caps below rather than by the aggregation.

`λ` weights must sum to 1 and are validated by the schema.

**The breakdown is part of the output, not a debug aid.** Every payload carries each component’s `value` *and* its `weight`, plus `coveragePenalty`, `zeroedBy` and `hardCapsApplied` with the measured `basis` that triggered each cap. A score that cannot be recomputed from its own payload is not auditable, and an unauditable confidence number is exactly the thing this product must not ship.

**Hard rules that override the score**

Priority when more than one rule could fire: (4) `insufficient_data`, then (2) `single_asset_shock`, then (3) `mixed_unresolved`. Rule (1) only caps the score; it never changes the regime label.

1. `effectiveConfirmations < 2` → `confidence.score` capped below the `high` band. Raw confirming-asset count is never used for this test. Until M1-6b calibrates band cut-offs, the placeholder is `highBandFloor = 70` and the cap writes `cappedAt: 69` into `hardCapsApplied` with the measured basis.
2. Top contributor accounts for > `concentrationThreshold` of `Σ|w_i z_i|` while `effectiveConfirmations < 2` → `primaryRegime = single_asset_shock`, regardless of cosine. Fallbacks carry `polarity: null` and `riskDirection: null`.
3. `distinctiveness < ambiguityFloor` → `primaryRegime = mixed_unresolved`.
4. Any core rate missing, or fewer than 6 of 8 core assets present → `primaryRegime = insufficient_data`, `confidence.score = 0` via `hardCapsApplied` with `cappedAt: 0`, no driver claim emitted.

**Uncalibrated parameters.** `marginRef`, `ambiguityFloor`, the concentration threshold, `λ` weights, per-asset sigma floors, `zNoiseFloor`, `highBandFloor`, and the high/medium/low band cut-offs are all placeholders until scenario fixtures exist. The formula and the component set are frozen; the numbers are not. While `calibrated: false`, no surface may render band labels.

---

## 2. Catalyst (Events — M2-1 canonical item)

Milestone 2 introduces a per-event **Catalyst** contract. The older sketch `CatalystDigest` remains a future aggregation envelope; M2-1 serves a feed of canonical items.

**Separation of concerns (do not collapse these):**

| Concept | Answers | Module |
| --- | --- | --- |
| Regime / DominantDriver | What pattern is the market trading *now*? | Macro |
| Catalyst | What event may *change* that pattern? | Catalyst |
| Confidence (macro) | How clean is the regime classification? | Macro |
| Confidence (catalyst) | How clear is the event taxonomy? | Catalyst |

Catalyst confidence is **classification clarity only**, always `calibrated: false` in M2-1 — never a market-up probability. Catalyst `direction` must not be merged into macro regime or macro confidence until a later linkage milestone.

```json
{
  "$id": "Catalyst",
  "schemaVersion": "0.1.0",
  "id": "cat_a1b2c3d4e5f60718",
  "occurredAt": "2026-07-15T08:30:00-04:00",
  "observedAt": "2026-07-15T09:05:00-04:00",
  "sourceType": "calendar",
  "sourceName": "Synthetic Macro Calendar",
  "sourceUrl": "https://example.invalid/synthetic/cpi-update",
  "headline": "CPI print surprise — updated detail (illustrative)",
  "summary": "Updated synthetic CPI row…",
  "category": "inflation",
  "importance": "high",
  "status": "released",
  "affectedAssets": ["US10Y", "GOLD", "USD", "OIL"],
  "macroChannels": ["inflation"],
  "direction": "inflationary",
  "confidence": {
    "score": 100,
    "calibrated": false,
    "note": "classification clarity only — not a market direction probability"
  },
  "evidence": [
    {
      "id": "cat_a1b2c3d4e5f60718_ev1",
      "statement": "Synthetic CPI update superseding prior fixture row",
      "basis": "synthetic_fixture"
    }
  ],
  "dedupeKey": "ext:syn-cpi-surprise-001",
  "synthetic": true
}
```

| Field | Notes |
| --- | --- |
| `category` | `monetary-policy` \| `inflation` \| `labor` \| `growth` \| `fiscal` \| `geopolitics` \| `energy` \| `liquidity` \| `earnings` \| `positioning` \| `other` |
| `status` | `upcoming` \| `released` \| `developing` \| `resolved` |
| `importance` | `low` \| `medium` \| `high` \| `critical` — set by registry/normalize; ranked in compute (`IMPORTANCE_RANK`); **displayed** on the Catalyst Feed (and planned This Week). Not a UI-invented score. |
| `direction` | `risk-on` \| `risk-off` \| `inflationary` \| `disinflationary` \| `growth-positive` \| `growth-negative` \| `mixed` \| `unclear` |
| `synthetic` | `true` for demo fixtures; `false` for official BLS/BEA/FOMC **schedule** rows (scheduled release time only — not an observed print or decision). Never present schedule rows as confirmed data releases. |

Normalization is deterministic (`src/catalyst/normalize.ts`). The UI and `/api/catalysts` only read the feed — they do not reclassify.

### Official calendar ingestion (M2-2A / M2-2B)

| Source | Format | URL |
| --- | --- | --- |
| BLS News Release Schedule | ICS | `https://www.bls.gov/schedule/news_release/bls.ics` |
| BEA release dates | JSON | `https://apps.bea.gov/API/signup/release_dates.json` |
| Federal Reserve FOMC Calendars | HTML | `https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm` |

Local workflow: `npm run catalyst:fetch` → atomic write of gitignored `data/catalyst/calendar-latest.json`. Public demo (`GAMMADESK_PUBLIC_DEMO=1`) never calls BLS/BEA/Federal Reserve and never reads that cache — synthetic fixtures only. Calendar rows keep `status: upcoming` and `direction: unclear`; the system does **not** ingest actual/forecast/surprise, FOMC statement text, SEP figures, or minutes (unless a later milestone has an explicit official timestamp).

FOMC mapping (schedule only): meeting end date → policy decision at 2:00 p.m. America/New_York (`importance: critical`) and Chair press conference at 2:30 p.m. (`importance: high`). SEP meetings (`*` on the Fed calendar) annotate the policy-decision headline/summary; they are not a separate same-instant catalyst. Evidence basis: `official_fomc_schedule`.

### Official release results (M2-2C1)

Optional Catalyst fields:

| Field | Notes |
| --- | --- |
| `releaseFamily` | `cpi` \| `employment_situation` |
| `referencePeriod` | `YYYY-MM` from official schedule/API metadata — never guessed from release day |
| `releaseResult` | Official series actuals; `consensus: null`, `surprise: null`, `surpriseStatus: "unavailable"` |

BLS series (explicit registry): `CUSR0000SA0` (headline CPI SA), `CUSR0000SA0L1E` (core CPI SA — all items less food and energy), `CES0000000001` (payrolls), `LNS14000000` (unemployment rate). CPI emits MoM + YoY percent changes; payrolls emit monthly change in thousands; unemployment is the official level. Observations may include optional `inputs` (current / previous / year-ago source periods and raw values) for audit. Local: `npm run catalyst:results:fetch` → gitignored `data/catalyst/results-latest.json` (full period archive). The default Catalyst feed materializes scheduled events (strictly linked when possible) plus **at most one** latest independent observation per `releaseFamily` — historical archive rows are not expanded into dozens of top-level catalysts. An event becomes `released` only when official series data for its `referencePeriod` is linked — not merely because the schedule time has passed.

### Official release documents (M2-3A)

Independent canonical contract `OfficialDocument` (stored in `data/catalyst/documents-latest.json`, not as extra catalysts):

| Field | Notes |
| --- | --- |
| `provider` | `federal_reserve` \| `bls` \| `bea` |
| `documentType` | `fomc_statement` \| `cpi_release` \| `employment_release` \| `gdp_release` \| `personal_income_outlays_release` \| `international_trade_release` |
| `releaseFamily` | Document linking key (`cpi`, `employment_situation`, `fomc_policy`, `gdp`, `personal_income_outlays`, `international_trade`) |
| `summaryFromSource` | Feed/page description only — never program-generated prose labelled as source summary |
| `contentText` / `contentHash` | Normalized body (boilerplate stripped) + stable hash; raw HTTP responses are not committed |
| `publishedAt` / `observedAt` | Official publish time vs successful fetch observation time |

Sources (explicit registry only — no search/aggregators): Fed `press_monetary.xml`; BLS `cpi.rss` + `empsit.rss`; BEA `apps.bea.gov/rss/rss.xml` filtered by item `name`. Link to catalysts by `releaseFamily` + `referencePeriod` (or same Eastern calendar day + schedule identity). Documents never create a second catalyst; optional `Catalyst.officialDocuments[]` holds slim refs. Default UI/API materializes the last **30 days**; archive may be longer. No LLM summaries; FOMC statement linking does **not** parse rates, votes, dissent, hawkish/dovish, or SEP. Local: `npm run catalyst:documents:fetch`. Public demo uses labelled synthetic document fixtures only.

### Evidence-grounded briefs (M2-3B)

Independent canonical contract `OfficialBrief` (built offline into `data/catalyst/briefs-latest.json`):

| Field | Notes |
| --- | --- |
| `documentId` / `documentContentHash` / `extractorVersion` | Idempotent rebuild key |
| `status` | `complete` \| `partial` \| `unavailable` |
| `facts[]` | Each fact requires `evidence.excerpt` that is an **exact substring** of normalized `contentText`, with resolvable `startOffset`/`endOffset` |
| `omissions` | Expected facts not found with reliable evidence (unextracted ≠ “agency did not report”) |
| `warnings` | Includes structured-result `crossCheck:matched` / `crossCheck:mismatch` when comparable |

Briefs are **rule-based fact extracts**, not official prose and not AI interpretation. They must not invent hawkish/dovish, beat/miss, market direction, or trade advice. Headline templates may only restate evidenced facts. When M2-2C1 structured results exist for the same family+period, document values are cross-checked within explicit tolerances — never used to overwrite structured observations, and never used to invent undocumented facts. Local: `npm run catalyst:briefs:build` (reads documents/results caches; no network). Public demo derives briefs from synthetic documents at load time.

### Evidence-grounded AI briefs (M2-3C)

Independent canonical contract `OfficialAiBrief` (built offline into `data/catalyst/ai-briefs-latest.json`). **Never overwrites** the deterministic `OfficialBrief` grounding layer.

| Field | Notes |
| --- | --- |
| `inputBriefId` / `documentId` / `documentContentHash` / `extractorVersion` / `promptVersion` / `model` | Cache identity — any change forces regenerate |
| `status` | `complete` \| `partial` \| `rejected` \| `unavailable` |
| `headline` + `bullets[]` | 2–4 bullets; each bullet must cite ≥1 valid `factId` from the input brief |
| `validation` | Local hard checks after structured LLM output (`citationsValid`, `numbersValid`, `prohibitedInferenceDetected`, `errors`) |
| `synthetic` | Public demo fixtures are `true` and checked in |

**Input boundary:** the model receives only brief metadata, verified `facts[]` + evidence excerpts, omissions/warnings, and structured cross-check status — **not** full `contentText`, other news, prices, or consensus invention. Unavailable deterministic briefs do not call the model; partial inputs may, but output must stay `partial` / incomplete.

**Deterministic vs AI:** rule-based facts are the grounding layer; AI briefs are a readable rewrite of those cited facts only. Schema-valid JSON is never enough — local validation rejects bad citations, unsupported numbers/dates, prohibited inference/trading language, and entity mismatches. On `rejected` / `unavailable`, the UI falls back to the M2-3B rule-based brief (no empty AI card). Validation can catch citations/numbers/banned phrases but cannot prove all natural language entails the source — UI keeps fact/evidence expanders.

**Provider:** OpenAI Responses API adapter behind a `BriefNarrator` interface; `OPENAI_API_KEY` + `CATALYST_LLM_MODEL` (config default `gpt-5.6-luna`); reasoning effort `none`; strict Structured Outputs. Tests inject a fake narrator — CI never calls a real model. Missing key → `unavailable` (no fake-AI fallback). ChatGPT/Cursor subscription credits are not API credits.

Local: `npm run catalyst:briefs:enhance` (reads `briefs-latest.json` only; no documents/calendar/results fetch). Public demo uses labelled synthetic AI fixtures only (`synthetic: true`); build/request paths never call an LLM.

### Event market context (M2-4A)

Independent canonical contract `EventMarketContext` (built offline into `data/catalyst/market-context-latest.json`):

| Field | Notes |
| --- | --- |
| `catalystId` / `eventTimestamp` / `provider` / `feed` / `calculationVersion` | Cache identity — changes force refresh |
| `status` | `complete` \| `partial` \| `unavailable` |
| `symbols[]` | ETF proxies only (`SPY`, `QQQ`, `IWM`, `TLT`, `UUP`, `GLD`) with explicit `instrumentLabel` |
| `baseline` + windows `plus5m` / `plus30m` / `plus2h` / `sessionClose` | Prices + `%` changes computed deterministically from saved 1Min bars |
| `session` | Eastern date, holiday/weekend/early-close, premarket vs regular-session flags |
| `synthetic` | Public demo fixtures are `true` |

**Rules:** use the catalyst’s authoritative `occurredAt` (converted to UTC) — never document publish time. Baseline is the last valid bar **strictly before** the event (no look-ahead). Missing windows are `unavailable` without distant substitutes. Labels must say ETF/proxy — never call UUP “DXY”, TLT a yield, or SPY the official S&P 500 index. Observed moves **do not establish causation**.

Local: `npm run catalyst:market-context:fetch` (reads calendar + results caches only; Alpaca Historical Stock Bars via `APCA_API_KEY_ID` / `APCA_API_SECRET_KEY`; optional `CATALYST_MARKET_FEED`, default `sip`). Public demo uses synthetic fixtures only — never calls Alpaca.

### Deterministic market reactions (M2-4B)

Independent canonical contract `EventMarketReaction` (built offline into `data/catalyst/market-reactions-latest.json`):

| Field | Notes |
| --- | --- |
| `marketContextId` / `marketContextIdentity` / `officialFactsIdentity` / `reactionRulesVersion` | Cache identity — excludes `generatedAt`. `officialFactsIdentity` covers catalyst event + linked document/brief identity |
| `status` | `complete` \| `partial` \| `insufficient` |
| `windows[]` | Per-window instrument directions, equity breadth/leadership, cross-asset signature, coverage |
| `development` | Path classifications `extended` / `held` / `faded` / `reversed` / `mixed` / `unavailable` |
| `observations[]` | 0–4 controlled templates with `ruleId` + replayable `sourceValues` |

**Rules:** atomic directions use versioned **display deadbands** by proxy class × window (not statistical significance). Equity breadth uses SPY/QQQ/IWM only with an explicit majority rule (a lone QQQ up is never “broadly higher”). Leadership uses QQQ−SPY / IWM−SPY spreads vs an explicit threshold. Cross-asset signatures stay ETF/proxy language (never DXY / yields / risk-on). Development compares cumulative % vs the same baseline; invalid chronology → `unavailable` (no next-day fabrication).

Local: `npm run catalyst:market-reactions:build` (reads market-context + official briefs/calendar for input identity; offline; classification remains 4A-rule-based). Public demo derives reactions from synthetic market-context fixtures via the same rules engine.

### AI market-reaction narratives (M2-4C)

Independent canonical contract `AiMarketReactionNarrative` (enhanced offline into `data/catalyst/ai-market-reactions-latest.json`):

| Field | Notes |
| --- | --- |
| `marketContextIdentity` / `marketReactionIdentity` / `reactionRulesVersion` / `promptVersion` / `model` | Cache identity — excludes `generatedAt` and `usage` |
| `status` | `complete` \| `partial` \| `rejected` \| `unavailable` |
| `headline` / `bullets[].evidenceIds` | Present only when validation passes; every bullet cites ≥1 evidenceId |
| `validationErrors` | Hard-fail reasons; rejected narratives omit display copy |
| `synthetic` | Public demo fixtures are `true` |

**Rules:** LLM may only reorganize supplied 4A percentage changes + 4B classifications. Neutral / observational wording; explicit windows (`At +30m`); ETF/proxy names only. Forbidden: causal verbs, investor psychology, hawkish/dovish, bullish/bearish, risk-on/off, beat/miss, trade advice, TLT→yields, UUP→DXY, SPY/QQQ/IWM as official index levels. Local validator checks citations, numbers, entities, classification consistency, and banned phrasing — it **cannot** mathematically prove every NL claim is entailed by the input, so UI must keep an expand-original-evidence path. `rejected` / `unavailable` → UI shows rule-based M2-4B only (no empty AI card).

**Layering:** 4A = objective ETF proxy prices; 4B = deterministic rules; 4C = AI organizes cited observed evidence only.

Local: `npm run catalyst:market-reactions:enhance` (reads market-context + market-reactions caches only; OpenAI Responses API via `OPENAI_API_KEY` / optional `CATALYST_REACTION_LLM_MODEL`, config default `gpt-5.6-luna`; reasoning `none`; max 12 events/run; concurrency 2; 800 max output tokens). Public demo uses synthetic fixtures only — never calls OpenAI.

### Integration smoke report (M2-5A-Lite)

Sanitized run report `CatalystIntegrationSmokeReport` written to gitignored `data/catalyst/integration-smoke-latest.json` by `npm run catalyst:integration:smoke`:

| Field | Notes |
| --- | --- |
| `mode` | `live` only with explicit `--live`; otherwise `dry-run` |
| `overallStatus` | `passed` \| `partial` \| `unavailable` \| `failed` |
| `stages[]` | preflight → alpaca → openai official brief → openai reaction → cache integrity |
| `errorCodes` | Safe categories only (`timeout`, `insufficient_quota`, `rate_limit`, `validation_rejected`, `missing_credentials`, …) — never keys/headers/bodies |

**Status meanings:** `passed` = requested live stages that could run actually called the provider and passed validators; `partial` = at least one OpenAI stage passed while Alpaca remains awaiting; `unavailable` = no live provider stage could execute; `awaiting_valid_credentials` = Alpaca key/secret incomplete or invalid shape; `awaiting_live_smoke` = credential shape present but live Alpaca path not yet validated; `insufficient_quota` / `rate_limit` for billing/throttle (not auth). Automatic tests use fake narrators only; public demo never runs this smoke.

### Unified incremental update manifest (M2-5B)

`CatalystUpdateManifest` schemaVersion **`0.1.0`** written to gitignored `data/catalyst/update-latest.json` by `npm run catalyst:update`:

| Field | Notes |
| --- | --- |
| `mode` | `dry-run` (plan only) or `live` |
| `stages[]` | `official_facts` → `openai_official_brief`; `official_facts` + `market_context_4a` → `reaction_4b` → `openai_reaction_4c` |
| counts | `attemptedCount` / `updatedCount` / `skippedCount` / `failedCount` |
| `errorCodes` | Safe categories incl. `insufficient_quota`, `awaiting_valid_credentials`, `awaiting_live_smoke` |

**Incremental identity:** each stage reuses existing adapters — recompute only when input identity, rules/prompt/model, or dependency versions change. Run lock `data/catalyst/update.lock.json` (stale after 30m or dead PID). No scheduler.

### Catalyst feed DTO (M3-0.5)

Public Zod contract `CatalystFeed` (`src/contracts/catalyst-feed.ts`, schemaVersion **`0.1.0`**) is what `/api/catalysts` and the desk UI consume (via `toPublicCatalystFeed`). The loader may keep a richer internal payload for cache joins.

| Public keeps | Public strips |
| --- | --- |
| `mode`, `banner`, `disclaimer`, layer `available`/`status`/`stale`/counts | Filesystem cache paths in `source.name` / errors |
| Catalysts, slim documents, briefs, 4A/4B/4C display fields | Raw provider `error` strings |
| `validationIssueCount` | `validationErrors[]` detail, linking warning dumps |
| AI brief `validation` gate flags | AI reaction `usage` (token counts) |
| | `officialFactsIdentity`, `marketContextIdentity`, `marketReactionIdentity` |

**Feed identity gate:** `filterMarketReactionsForFeed` requires `reaction.officialFactsIdentity` to match the current official event/facts identity for that `catalystId`. Mismatches are dropped; 4C narratives that join only via the filtered 4B set cannot hang on stale facts. **4A identity is unchanged** — market context does not depend on official facts.

**This Week field ownership (UI labels only — no new persisted fields):**

| UI label | Ownership |
| --- | --- |
| `scheduledAt` | UI alias of `Catalyst.occurredAt` |
| `eventCategory` | UI alias of `Catalyst.category` |
| `importance` | `Catalyst.importance` (registry) |
| `timeStatus` | Derived from `now` + `occurredAt` + `status` + presence of `releaseResult`/docs — never “clock past ⇒ released” |
| `sessionTiming` | Derived from `occurredAt` in `America/New_York` (+ optional `EventMarketContext.session`) |
| `calendarSource` | Registry / feed `source.sources[].id` (not implemented as a new Catalyst field) |

---

## 3. EstimatedGammaStructure (M4-1 compute output)

OI-based GEX proxy from a provider-neutral options chain. **Not** dealer positioning truth and **not** a directional buy/sell signal. Zod: `src/contracts/estimated-gamma.ts`.

```json
{
  "$id": "EstimatedGammaStructure",
  "schemaVersion": "0.1.1",
  "underlying": "SPX",
  "asOf": "2026-07-29T14:30:00.000Z",
  "sessionDate": "2026-07-29",
  "spot": 6425,
  "dataDelay": "fixture",
  "source": { "provider": "fixture", "name": "…", "fetchedAt": "…" },
  "methodology": {
    "id": "oi_gex_proxy_v1",
    "version": "0.1.1",
    "formula": "unsignedUnitGex = gamma * openInterest * multiplier * spot^2 * 0.01; callGex = +unsignedUnitGex; putGex = -unsignedUnitGex; totalGex = sum(callGex)+sum(putGex)",
    "assumptions": [
      "Puts are signed negative by convention in this OI-based proxy — not verified dealer positioning."
    ]
  },
  "status": "partial",
  "limitations": [],
  "totalGex": 1.2e9,
  "gammaRegime": "positive",
  "callWall": { "status": "available", "strike": 6450, "gex": 3.1e8 },
  "putWall": { "status": "available", "strike": 6350, "gex": -2.8e8 },
  "gammaFlip": {
    "status": "unavailable",
    "reason": "Requires recomputing gamma from spot, IV, rates, and time-to-expiry rather than interpolating strike GEX"
  },
  "byStrike": [{ "strike": 6450, "callGex": 3.1e8, "putGex": 0, "netGex": 3.1e8 }],
  "byExpiry": [{ "expiry": "2026-07-29", "status": "available", "netGex": 4e8 }],
  "zeroDte": { "status": "available", "sessionDate": "2026-07-29", "netGex": 4e8, "shareOfGrossGex": 0.35 },
  "coverage": { "contractsIn": 10, "contractsUsed": 8, "contractsSkipped": 2, "skipReasons": {} },
  "synthetic": true
}
```

| Field | Notes |
| --- | --- |
| `dataDelay` | `realtime` \| `delayed_15m` \| `eod` \| `fixture` \| `unknown` |
| `status` | `available` (complete) \| `incomplete` (usable GEX with suspect vendor-Greek exclusions) \| `partial` (other skips) \| `unavailable` |
| `gammaRegime` | `positive` \| `negative` \| `near_zero` \| `unavailable` |
| `gammaFlip` | **Contract reserved.** M4-1 always `unavailable` — no strike-interpolation fake level |
| `zeroDte.shareOfGrossGex` | Gross 0DTE / gross total; **0.1.1+** validated in `[0, 1]` (was `shareOfAbsStrikeGex` in 0.1.0) |
| `zeroDte` | `unavailable` when chain has no expiry equal to `sessionDate` |

Provider-neutral input: `OptionsChainSnapshot` (`src/gamma/types.ts`). MarketData.app normalizer attaches `dataQuality` audit metadata; suspect collapsed Greeks are excluded from GEX with skip reason `suspect_vendor_greeks`.

**MarketData.app Greek data-quality (pre-provider):**

| Rule | Notes |
| --- | --- |
| `suspect_vendor_greeks` | `openInterest > 0` AND `gamma === 0` AND `|delta| >= 0.999` AND `iv <= 0.001` — excluded from usable GEX; original vendor values preserved in audit |
| `quote_below_intrinsic` | Diagnostic when `ask < intrinsicValue`; does not alone exclude |
| Coverage | `nonNullGammaCount`, `usableGammaCount`, coverage %s, `suspectVendorGreeksCount` on `coverage` when present |
| Completeness | `incomplete` when suspect exclusions affect calculation; walls/aggregates marked `incomplete` on affected side/expiry |

Fixtures: `fixtures/gamma/providers/marketdata-app/spy-greek-boundary.json`.

### BoundedGammaProviderSnapshot (MarketData.app CLI provider)

Credit-bounded, single-expiry MarketData.app → Gamma Engine derived snapshot for upcoming Structure UI. Zod: `src/contracts/bounded-gamma-provider.ts`. CLI: `npm run gamma:fetch`. **Not** part of `npm run daily`. **Not** full-chain walls.

| Field | Notes |
| --- | --- |
| `scope` | Always `bounded_single_expiry` |
| `vendorAsOf` / `vendorUpdatedMin` / `vendorUpdatedMax` | From vendor `updated` unix timestamps — never wall-clock evaluation time |
| `sessionDate` / `dte` | Derived from vendor asOf (America/New_York) vs requested `expiration` |
| `boundedCallWall` / `boundedPutWall` | Engine walls + `scope: bounded_single_expiry` — not unqualified market walls |
| `status` | Same engine semantics: `available` \| `incomplete` \| `partial` \| `unavailable` |
| Credits | `credits.consumed` / `credits.remaining` from vendor rate-limit headers when present |
| Persistence | `data/gamma/providers/marketdata-app/{SYMBOL}-bounded-latest.json` (gitignored); write only on success |

Env: `MARKETDATA_API_TOKEN` (alias `MARKETDATA_APP_TOKEN`). Default safety cap: estimated contracts `strikeCount × 2` ≤ **250** unless `--allow-above-cap`.

**Desk UI (M4-4):** read-only Structure·Gamma section loads this snapshot via `loadBoundedGammaDeskView` (filesystem or `fixtures/gamma/providers/marketdata-app/spy-bounded-ui.json`). Never calls MarketData.app; walls labeled **Bounded Call/Put Wall** only.

---

## 3a. GammaChangeSet (optional change context)

Deterministic change metrics vs prior-session close and same-session open. Zod: `src/contracts/gamma-change.ts`. Used by `MarketStructureState` v0.2.0 `changeContext` when a compatible change set is supplied — never fabricated.

Metrics: `spot`, `totalGex`, `gammaRegime`, `callWall`, `putWall`, `zeroDteShareOfGrossGex`. Missing baselines or values → `status: unavailable` + `reason`. `pctChange` is nested `{ status, value? | reason? }`; unavailable when baseline is zero.

---

## 3b. MarketStructureState (bounded interpretation — M4-3C)

Deterministic, contract-valid **conditional structure interpretation** derived from one `BoundedGammaProviderSnapshot` plus an optional compatible `GammaChangeSet`. Zod: `src/contracts/market-structure-state-v2.ts`. Shared feature schemas: `src/contracts/market-structure-state.ts`. Builder: `buildMarketStructureStateV2` in `src/gamma/structure-state-v2.ts`.

Does **not** call live APIs from the builder, change GEX math, or fabricate Flip / full-chain walls.

**Semantics:** Gamma is a conditional amplifier/compressor for the **bounded single-expiry** sample — not a directional predictor. Walls remain `boundedCallWall` / `boundedPutWall` with `scope: "bounded_single_expiry"`.

```json
{
  "$id": "MarketStructureState",
  "schemaVersion": "0.2.0",
  "symbol": "SPY",
  "generatedAt": "2026-07-30T20:05:00.000Z",
  "asOf": "2026-07-30T20:00:00.000Z",
  "vendorAsOf": "2026-07-30T20:00:00.000Z",
  "sessionDate": "2026-07-30",
  "source": { "provider": "marketdata_app", "name": "…", "fetchedAt": "…" },
  "methodology": {
    "id": "oi_gex_proxy_v1",
    "version": "0.1.1",
    "featureMethodologyId": "gamma_feature_layer_v1",
    "featureMethodologyVersion": "0.2.0"
  },
  "scope": "bounded_single_expiry",
  "expiration": "2026-07-31",
  "dte": 1,
  "availability": "incomplete",
  "regime": "negative",
  "spot": 741.63,
  "totalGex": -4035998112.1934204,
  "grossGex": 11491294134.14556,
  "boundedCallWall": { "status": "available", "strike": 745, "scope": "bounded_single_expiry" },
  "boundedPutWall": { "status": "incomplete", "strike": 743, "scope": "bounded_single_expiry" },
  "flip": { "status": "unavailable", "reason": "…" },
  "condition": "incomplete_structure",
  "evidence": [{ "id": "total_gex", "statement": "…", "basis": "…" }],
  "interpretation": { "summary": "…", "bullets": ["…"] },
  "changeContext": { "status": "unavailable", "reason": "…" }
}
```

| Field / rule | Notes |
| --- | --- |
| `condition` | `positive_gamma_stabilizing` \| `negative_gamma_amplifying` \| `near_zero_transition` \| `incomplete_structure` \| `unavailable` |
| Condition priority | `unavailable` (availability or regime) → `incomplete_structure` (`incomplete`/`partial`) → regime label when `available` |
| `flip` | Always `unavailable` unless a future supported input supplies it — never interpolated |
| Walls | Retain `scope: bounded_single_expiry`; never relabeled as market Call/Put walls |
| `changeContext` | Optional `GammaChangeSet`; missing or mismatched symbol / sessionDate / methodology → `unavailable` + reason (no fabrication) |
| Interpretation | Plain English, conditional on spot/levels/regime/scope/quality; no buy/sell, bullish/bearish prediction, flow claims, or full-chain wall language |

Fixture input: `fixtures/gamma/providers/marketdata-app/spy-bounded-ui.json`.

---

## 4. AiStudyBriefing (AI Study surface)

Daily briefing from live macro, catalyst, bounded gamma, and market quotes when configured. Zod: `src/contracts/ai-study-briefing.ts`. Generator: `src/ai-study/`. Public demo uses `fixtures/ai-study/public-demo.briefing.json` only.

Inputs are explicit provenance rows (`macro`, `catalysts`, `gamma_structure`, `market_quotes`) with `status` / `freshness` — never invented. Output separates claims, scenarios, limitations, and unknowns. Market Temperature is **not** an input; the model must not infer it.

---

## 5. MarketInputSnapshot (V2-3A readiness)

Timestamp-aligned **input readiness** envelope for V2 decision engines. Zod: `src/contracts/market-input-snapshot.ts`. Builder: `buildMarketInputSnapshot` / `loadMarketInputSnapshot` in `src/desk/build-market-input-snapshot.ts`.

Does **not** compute Risk, Exposure, Allocation, or stance. Each `inputs[]` row carries:

| Field | Rule |
| --- | --- |
| `value` | Typed payload or `null` — never silently forward-filled |
| `asOf` | Vendor/compute instant for the observation |
| `marketSessionDate` | Session the observation describes (`YYYY-MM-DD`) |
| `source` | `{ provider, artifact, fetchedAt }` |
| `status` | `available` \| `partial` \| `incomplete` \| `unavailable` \| `missing` |
| `stale` | `true` when cross-session, vendor-stale, or macro `staleDays > 0` |
| `missingReason` | Human-auditable gap when not `available` |
| `isProxy` | From `ASSET_REGISTRY` for macro assets; `false` for quotes/gamma |

`missing` means **no wired repository source** (session breadth, credit, VIX term structure, event gate). Event-scoped catalyst breadth must not substitute for session breadth.

`targetMarketSessionDate` is the desk cross-section anchor: the **last completed** US equity session in `America/New_York` (after regular close on a trading day; prior session before close or on non-session days). `sessionAlignment` and `isCompleteCrossSection` summarize whether all required inputs align to that session without staleness.

### BreadthInternals (V2-3B3)

Session-level SPY ETF-holdings breadth. Zod: `src/contracts/breadth-internals.ts`. Builder: `loadSpyBreadthInternals` → `computeSpyBreadthInternals`. **Current schema version: `0.2.0`** (legacy stored artifacts may remain at `0.1.0`).

| Field | Rule |
| --- | --- |
| `advance` / `decline` / `unchanged` | Counts from prior-session close vs target-session close |
| `metrics.advanceDecline` | `{ advance, decline, unchanged, eligibleCount, denominator, coverage, status }` — **no `numerator`**; invariant `advance + decline + unchanged === eligibleCount` |
| `metrics.percentAboveMA20` / `percentAboveMA50` | `BreadthMetricResult`; **inclusive SMA** over the last 20 / 50 session **closes including the target session**; symbol counted above when `target close > MA` |
| `metrics.new20DayClosingHigh` / `new20DayClosingLow` | **0.2.0 only** — `BreadthMetricResult`; target close vs max/min of the **prior 19 closes** in the inclusive 20-day window (not intraday highs/lows) |
| `coverage.closingHighLow20Coverage` | **0.2.0** — eligible fraction for 20D closing-high/low metrics |
| `status` | Gated by universe freshness, per-metric coverage thresholds, and MA coverage floors (see below) |

**Legacy `0.1.0` field names (read-only, not upgraded):** `new20DayHigh`, `new20DayLow`, `highLow20Coverage`. Legacy snapshots used **prior-exclusive** MA windows (20/51 sessions before target) and ambiguous high/low naming — **not** interchangeable with `0.2.0` trend semantics.

**Coverage gates (`SPY_BREADTH_CONFIG`):** production thresholds for price-pair, MA20, MA50, and closing-high/low eligible fractions. MA and closing metrics use **`allowPartial: false`** — coverage below threshold → metric `unavailable` (not `partial`). Overall `status` is `unavailable` when `ma20Coverage === 0`, `ma50Coverage === 0`, or any gated MA/closing metric is `unavailable`. `partial` remains only for advance/decline or bars session mismatch.

Target session must be completed — intraday runs before US regular close must not treat the in-progress calendar day as the daily bar session.

### EtfUniverseArtifact (V2-3B3)

Official SPY holdings parse. Zod: `src/contracts/etf-universe-artifact.ts`.

| `rowCounts` field | Meaning |
| --- | --- |
| `sheetDataRowCount` | All rows after the holdings header |
| `holdingCandidateCount` | Rows representing positions (equity, cash, CVR, duplicate) |
| `constituentCount` | Included equity symbols |
| `excludedHoldingCount` | `cash_row` / `non_equity_ticker` / `duplicate_ticker` only |
| `ignoredMetadataRowCount` | Disclaimers/footnotes — **not** in `excludedRows` |

**Persistence:** `data/universes/SPY/` and `data/bars/spy-universe/` are **local-ready filesystem adapters only**. Vercel serverless has no durable writable `data/` path; deployment requires external object storage or build-time artifacts (no DB/Blob wired in this phase).

#### Breadth snapshot store (V2-3B4A)

Durable SPY breadth uses the existing `BreadthInternalsSnapshot` schema — no separate metrics artifact. Zod: `src/contracts/breadth-snapshot-pointer.ts`. Store: `src/desk/breadth/store/`.

| Artifact | Role |
| --- | --- |
| **Versioned snapshot** | Immutable JSON at `{universeId}/snapshots/{snapshotIdentity}.json` under the store root (`data/breadth/` locally; Blob prefix `breadth/` in production) |
| **Latest pointer** | `BreadthSnapshotPointer` at `{universeId}/latest.json` — `schemaVersion`, `universeId`, `fundSymbol`, `marketSessionDate`, `snapshotPath`, `snapshotIdentity`, `generatedAt` (`asOf`), `publishedAt` |

**Publish-last order:** `writeVersioned(snapshot)` → `readSnapshot` read-back validation → `publishLatest(pointer)`. A failed snapshot write never updates latest; a failed latest publish leaves the prior pointer intact (atomic filesystem rename; Blob `put` failure does not delete the old object).

**Last-known-good:** malformed JSON, schema errors, `status: unavailable`, and path traversal are rejected. Immutable identity conflicts (same path, different payload) fail without overwriting. On Vercel/production hosts, missing `BLOB_READ_WRITE_TOKEN` / `VERCEL_BLOB_READ_WRITE_TOKEN` is **fail-closed** — the cron route returns **503** and does not fall back to ephemeral `data/breadth/`.

| Adapter | Responsibility |
| --- | --- |
| **Filesystem** | Local development and hermetic tests under `data/breadth/` (gitignored) |
| **Vercel Blob** | Production persistence via injected minimal `BlobStoreClient` (`BLOB_READ_WRITE_TOKEN` or `VERCEL_BLOB_READ_WRITE_TOKEN`) |

**Schema read / trend isolation:**

| Operation | Behavior |
| --- | --- |
| `readSnapshot` / `readSnapshotBySessionDate` | Returns **stored** artifact — `schemaVersion` `0.1.0` or `0.2.0` with native field names; **no** silent upgrade to `0.2.0` semantics |
| `readRecentSnapshots` | **0.2.0 only**; deduped by `marketSessionDate` (latest `asOf` wins); limit clamped 5–10 (default 10). Returns `{ status, snapshots, missingReason }` |
| `status: available` | At least **5** distinct schema-`0.2.0` trading sessions in the series |
| `status: insufficient_history` | Fewer than 5 schema-`0.2.0` sessions — **do not** pad with `0.1.0`; `snapshots` lists only the valid `0.2.0` rows present |
| Writes / publish | **0.2.0 only**; `status: unavailable` snapshots are rejected |

`loadDurableSpyBreadthForMarketInput()` uses **latest pointer → `0.2.0` snapshot only** for market input; a latest artifact at `0.1.0` is readable but yields unavailable market input with an explicit legacy-schema reason (no semantic upgrade).

#### Daily breadth producer (V2-3B4B)

`produceDailySpyBreadth()` in `src/desk/breadth/produce-daily-spy-breadth.ts` orchestrates: official SPY universe → Alpaca constituent daily bars → existing `computeSpyBreadthInternals` → Zod validate → `publishBreadthSnapshot()`. Upstream failure, `status: unavailable`, or publish errors leave the latest pointer unchanged (last-known-good).

Vercel Cron: `GET /api/cron/breadth-daily` (`vercel.json` schedule `0 22 * * *` UTC = **18:00 ET** during daylight saving, **17:00 ET** during standard time — ~1h after US regular close at 16:00 ET). Requires `Authorization: Bearer $CRON_SECRET`; missing or mismatched secret returns **401** (fail-closed). Missing blob token on Vercel returns **503** `storage_unavailable` — cron does not report success after non-persistent writes. Cron does not duplicate producer logic.

#### Durable breadth reader (V2-3B4C)

`loadDurableSpyBreadthForMarketInput()` reads `latest.json` → versioned snapshot; **market input consumes schema `0.2.0` only** (see trend isolation above). Production page loads **never** fetch SPY holdings or ~503 constituent Alpaca bars. Missing blob token on Vercel, absent latest pointer, legacy `0.1.0` latest, or malformed artifacts → `breadth_internals` **unavailable** (no `data/` fallback). Freshness compares snapshot `marketSessionDate` to `targetMarketSessionDate` via trading-session lag (weekends/holidays use last completed session, not calendar day). Stale snapshots retain true `asOf`, source artifact, and session date on the field.

### EventGate (V2-3C)

Deterministic shock gate from the official catalyst calendar only. Zod: `src/contracts/event-gate.ts`. Builder: `buildEventGate` in `src/desk/event-gate/`.

| Field | Rule |
| --- | --- |
| `state` | `clear` \| `scheduled_risk` \| `active_shock` \| `unavailable` — never directional |
| `activeEvents` | High-impact rows inside configured pre/post windows |
| `nextEvent` | Earliest future high-impact scheduled row (informational) |
| Windows | CPI/Payrolls 24h pre / 2h post; FOMC decision 12h/4h; press conf 2h/2h |
| Stale | `stale_calendar` mode or `source.stale` (age &gt; 36h TTL) → `unavailable` |

---

## Contract rules

1. Do not emit `kind: "reported_flow"` unless backed by real ETF/fund/options flow sources.
2. UI copy for inferred rotation must include confidence and basis.
3. Breaking field renames require `schemaVersion` minor/major bump and an entry in `docs/tasks.md`.
4. Example numbers in this file are illustrative only.
5. **Numbers never originate in the interpretation layer.** Every numeric fact is produced by compute and carried in `evidence[]`. The LLM path may only select and phrase around `evidenceId` references.
6. **Enforceable numeric guardrail:** reject any generated prose containing a numeral that does not appear in the referenced evidence values or statements. Fall back to the template generator on rejection.
7. Snapshots must persist `methodology.signatureVersion` and `methodology.methodologyVersion`, so a past conclusion can be reproduced after weights change.
8. Proxy inputs must carry `instrument` and `isProxy` end to end, matching the registry. Never display a proxy under the name of the thing it proxies without naming the instrument (e.g. a UUP series is `USD via UUP`, never bare `DXY`).
9. While `confidenceParams.calibrated` is `false`, no surface may render band labels (`high` / `medium` / `low`). Show the numeric score and its component breakdown instead.
