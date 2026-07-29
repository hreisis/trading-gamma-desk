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
  "schemaVersion": "0.2.1",

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
      "blocksWithNonZeroWeight": 5
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
    "methodologyVersion": "0.2.1",
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

Blocks group only genuinely substitutable inputs. 2Y and 10Y move together, and copper and oil share the growth impulse. **Gold stands alone** rather than sitting in a commodity bucket, because its haven and real-rate content is information that neither copper nor VIX carries — bucketing it with oil would have quietly discounted a real independent confirmation.

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
    "sessionDates": ["2026-06-29", "…"],
    "validCount": 20
  },
  "sigmaRaw": 4.4,
  "sigmaUsed": 4.4,
  "sigmaFloorApplied": false,
  "zScore": -1.82,
  "flags": []
}
```

**Volatility window rules**

1. `currentChange` spans `t-1 → t`. The window holds the **20 valid daily changes ending at `t-1`** — the current observation never participates in estimating its own scale.
2. This requires ≥ 22 consecutive valid price points. Ingest should request **45–60 calendar days** to absorb weekends and holidays.
3. `sigmaRaw = 1.4826 × median(|Δ|)`, taken **about zero** to stay consistent with `muAssumption: "zero"`.
4. `sigmaUsed = max(sigmaRaw, assetFloor)`. The floor only rescues small-but-nonzero scale.
5. If `sigmaRaw == 0`, emit `zScore: null` and flag `volUnavailable`. Because MAD is a median, zero also means **more than half the window is identical** — treat it as a data-quality alarm (`repeatedPrints`), not merely a quiet market.

`flags` enum: `volUnavailable` | `repeatedPrints` | `sigmaFloorApplied` | `gapSkipped` | `stale` | `missing`

---

### 1.2 RegimeSignatureConfig (versioned, schema-validated)

Signature weights are **data, not code** — reviewable and diffable. They get their own schema and version.

```json
{
  "$id": "RegimeSignatureConfig",
  "signatureVersion": "sig-2026-07-01",
  "methodologyVersion": "0.2.0",
  "polarityConvention": "positive = tightening / higher inflation / stronger growth / risk-on",
  "correlationBlocks": {
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

Counting confirming assets directly over-counts correlated ones — 2Y and 10Y agreeing is not two independent confirmations. Breadth is therefore measured over `correlationBlocks`:

```text
for each block b with non-zero weight in the winning signature:
    contribution_b = confirmingObserved_b / nonZeroWeightObserved_b     // ≤ 1

effectiveConfirmations = Σ_b contribution_b
effectiveBreadth       = effectiveConfirmations / blocksWithNonZeroWeight
```

Each block contributes **at most one** independent confirmation, so a fully confirming rates block counts as 1, not 2. Denominators count observed assets only; missing inputs are handled by `coveragePenalty`, not double-counted here.

This is what defeats the failure case where 2Y alone moves violently and `fed_rates` still scores high: the rates block caps at 1 confirmation, so `effectiveConfirmations` cannot reach 2.

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

1. `effectiveConfirmations < 2` → `confidenceScore` capped below the `high` band. Raw confirming-asset count is never used for this test.
2. Top contributor accounts for > 60% of `Σ|w_i z_i|` while `effectiveConfirmations < 2` → `primaryRegime = single_asset_shock`, regardless of cosine.
3. `distinctiveness < ambiguityFloor` → `primaryRegime = mixed_unresolved`.
4. Any core rate missing, or fewer than 6 of 8 core assets present → `primaryRegime = insufficient_data`, no driver claim emitted.

**Uncalibrated parameters.** `marginRef`, `ambiguityFloor`, the 60% concentration threshold, `λ` weights, per-asset sigma floors, and the high/medium/low band cut-offs are all placeholders until scenario fixtures exist. The formula and the component set are frozen; the numbers are not.

---

## 2. CatalystDigest (Events output)

```json
{
  "$id": "CatalystDigest",
  "schemaVersion": "0.1.0",
  "asOf": "2026-07-29T09:35:00-04:00",
  "items": [
    {
      "id": "evt_fomc_2026-07-30",
      "category": "fed_data",
      "headline": "FOMC decision tomorrow",
      "impact": "high",
      "whyNow": "Policy path is the active pricing variable for 2Y and equity duration."
    }
  ]
}
```

`category` enum (MVP): `fed_data` | `treasury_auction` | `geopolitics` | `earnings` | `issuance` | `mechanical` (OPEX, rebalance, collar, etc.)

---

## 3. MarketStructureState (Gamma output)

```json
{
  "$id": "MarketStructureState",
  "schemaVersion": "0.1.0",
  "asOf": "2026-07-29T10:15:00-04:00",
  "underlying": "SPX",
  "structure": "positive_compressed",
  "spot": 6425,
  "gammaFlip": 6385,
  "callWall": 6450,
  "putWall": 6350,
  "zeroGamma": 6385,
  "expectedRange": { "low": 6391, "high": 6459 },
  "netGex": 1.2e9,
  "zeroDteShare": 0.41,
  "sinceOpen": {
    "netGexDelta": -0.15e9,
    "flipDelta": -5,
    "callWallDelta": 0,
    "putWallDelta": 10
  },
  "edge": [
    "Mean reversion remains favored while SPX holds above 6385.",
    "A sustained break below the gamma flip could expand downside volatility.",
    "Upside is likely to slow near the 6450 call wall."
  ],
  "oneLineInterpretation": "Positive gamma / compressed: fade extremes above flip; watch 6450 call wall."
}
```

Desktop primary fields map 1:1: structure badge, spot/flip/walls/range, since-open changes, one-line interpretation.

**Principle encoded:** `edge` describes path/behavior conditional on levels — not naked “SPX will rally.”

---

## 4. MarketThesis (composed open thesis)

```json
{
  "$id": "MarketThesis",
  "schemaVersion": "0.1.0",
  "asOf": "2026-07-29T09:40:00-04:00",
  "hypothesis": "Falling yields should support long-duration technology.",
  "driverRef": { "$ref": "DominantDriver" },
  "catalystRef": { "$ref": "CatalystDigest" },
  "structureRef": { "$ref": "MarketStructureState" },
  "invalidateIf": [
    "2Y reverses higher by >5 bps with DXY confirming",
    "SPX loses gamma flip on expanding volume"
  ]
}
```

---

## 5. CloseIntelligence

```json
{
  "$id": "CloseIntelligence",
  "schemaVersion": "0.1.0",
  "asOf": "2026-07-29T16:05:00-04:00",
  "sessionDate": "2026-07-29",
  "closeQuality": {
    "closeLocInDayRange": 0.62,
    "nearHigh": false,
    "nearLow": false,
    "lastHourBias": "buy",
    "vsGammaLevels": {
      "closedAboveFlip": true,
      "closedBelowCallWall": true,
      "closedAbovePutWall": true
    },
    "volumeConfirmed": true,
    "indexDivergence": ["NDX_outperformed_SPX"]
  },
  "breadth": {
    "advancers": 2801,
    "decliners": 1680,
    "equalWeightVsCapWeight": "lagging",
    "growthVsValue": "growth",
    "cyclicalVsDefensive": "defensive",
    "largeVsSmall": "large",
    "highBetaVsLowVol": "mixed",
    "themes": [
      { "name": "semiconductors", "relative": "strong" },
      { "name": "software", "relative": "strong" },
      { "name": "biotech", "relative": "weak" }
    ]
  },
  "narrativeValidation": {
    "morningHypothesis": "Falling yields should support long-duration technology.",
    "result": "partially_confirmed",
    "evidence": [
      "Nasdaq outperformed",
      "Software and semiconductors gained",
      "Equal-weight index lagged",
      "Small caps failed to participate",
      "SPX closed below its call wall"
    ],
    "conclusion": "This was concentrated duration buying, not broad risk-on participation."
  },
  "rotation": {
    "kind": "inferred_rotation",
    "confidenceBand": "medium",
    "moves": [
      "Semiconductors → Software",
      "Mega-cap → selected high-beta growth",
      "Defensives → Cyclicals"
    ],
    "basis": "Based on relative performance, volume expansion and market breadth."
  }
}
```

---

## 6. ViewUpdate (next-day handoff)

```json
{
  "$id": "ViewUpdate",
  "schemaVersion": "0.1.0",
  "asOf": "2026-07-29T16:10:00-04:00",
  "sessionDate": "2026-07-29",
  "primaryNarrative": "Concentrated duration / liquidity easing, not broad risk-on.",
  "supportingEvidence": ["…"],
  "nonConfirming": ["Small caps failed to participate", "Equal-weight lagged"],
  "rotationSummary": {
    "kind": "inferred_rotation",
    "confidenceBand": "medium",
    "moves": ["Semiconductors → Software"]
  },
  "watchNextSession": [
    "2Y and DXY confirmation of easier conditions",
    "SPX behavior vs gamma flip on open"
  ],
  "viewDeltaVsOpen": "Narrowed from broad risk-on to concentrated duration leadership."
}
```

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
