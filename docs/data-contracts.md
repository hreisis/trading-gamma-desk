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
  "schemaVersion": "0.2.0",

  "marketSessionDate": "2026-07-28",
  "generatedAt": "2026-07-29T08:15:00-04:00",
  "sessionAlignment": "aligned",
  "isCompleteSession": true,

  "primaryRegime": "fed_rates",
  "polarity": "negative",
  "riskDirection": "risk_on",
  "label": "Rates-led risk-on",

  "confidenceScore": 74,
  "confidenceComponents": {
    "patternMatch": 0.81,
    "coherence": 0.88,
    "breadth": 0.75,
    "strength": 0.92,
    "coveragePenalty": 0.0
  },

  "evidence": [
    {
      "id": "ev_us2y",
      "symbol": "US2Y",
      "statement": "US 2Y yield fell 8 bps (z = -1.8)",
      "value": -8,
      "unit": "bps",
      "zScore": -1.8,
      "sourceDate": "2026-07-28"
    },
    {
      "id": "ev_usd",
      "symbol": "USD_PROXY",
      "proxyFor": "DXY",
      "statement": "USD proxy (UUP) fell 0.6% (z = -1.2)",
      "value": -0.6,
      "unit": "pct",
      "zScore": -1.2,
      "sourceDate": "2026-07-28"
    }
  ],

  "contradictions": ["ev_copper"],

  "assets": [
    {
      "symbol": "GOLD_PROXY",
      "proxyFor": "XAU",
      "value": 0.4,
      "unit": "pct",
      "zScore": 0.6,
      "role": "confirming",
      "contribution": 0.11,
      "sourceDate": "2026-07-28",
      "staleDays": 0
    }
  ],

  "interpretation": {
    "text": "The market is repricing policy easing rather than stronger growth.",
    "evidenceIds": ["ev_us2y", "ev_usd"],
    "generator": "template"
  },

  "methodology": {
    "methodologyVersion": "0.2.0",
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
- `contradictions` holds `evidence[].id` references, never free text.
- `interpretation.evidenceIds` must be a non-empty subset of `evidence[].id`.
- `proxyFor` is required whenever the input is a proxy instrument; UI must surface it.
- `confidenceScore` is derived only from `confidenceComponents`, deterministically. The interpretation layer may not alter it.

**Input (conceptual):** per-asset daily changes plus a trailing volatility window that **ends at the prior session** (see 1.1). Credit spreads have a reserved slot and may be absent in Milestone 1.

---

### 1.1 MacroFeature (compute layer, internal)

Deterministic per-asset output. Contains every number that any downstream statement may cite.

```json
{
  "$id": "MacroFeature",
  "symbol": "US2Y",
  "proxyFor": null,
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
    "commodities": ["OIL", "COPPER", "GOLD"],
    "usd": ["USD_PROXY"],
    "risk": ["VIX", "BTC"]
  },
  "blockWeightBudget": { "rates": 1.0, "commodities": 1.0, "usd": 0.6, "risk": 1.0 },
  "signatures": {
    "fed_rates": { "US2Y": 1.0, "US10Y": 0.6, "USD_PROXY": 0.5, "GOLD": -0.4, "BTC": -0.3, "VIX": 0.2 }
  },
  "riskVector": { "BTC": 1.0, "COPPER": 0.6, "VIX": -1.0, "USD_PROXY": -0.4, "GOLD": -0.2 }
}
```

`blockWeightBudget` exists because the 8 dimensions are **not orthogonal** (2Y/10Y correlate strongly; Oil/Copper/Gold cluster). Plain cosine treats them as independent, so a signature that spreads weight across a correlated block gets an unearned boost. Budgeting weight per block, rather than per asset, contains that bias without attempting covariance whitening on a 20-sample window.

---

### 1.3 Scoring and confidence (normative)

For regime `r` with weight vector `w_r` and observed z-vector `z`, restricted to observed dimensions:

\[ s_r = \frac{w_r \cdot z}{\lVert w_r \rVert \lVert z \rVert} \in [-1, 1] \]

`|s_r|` is pattern match; `sign(s_r)` is `polarity`. Both `w_r` and `z` are re-normalized over **observed dimensions only** when data is missing, and a `coveragePenalty` is applied.

Confidence components, all in `[0, 1]`:

| Component | Definition |
| --- | --- |
| `patternMatch` | `abs(s_top)` |
| `coherence` | confirming contribution / (confirming + \|contradicting\|) contribution |
| `breadth` | valid confirming assets / non-zero-weight assets in the signature |
| `strength` | `min(1, rms(z) / 2)` — is the market moving at all |
| `coveragePenalty` | share of core dimensions missing or stale |

`confidenceScore = round(100 × clamp(patternMatch × coherence × breadthFactor × strength − coveragePenalty))`.

Gating is **multiplicative** so that any one weak dimension caps the result, rather than being averaged away.

**Hard rules that override the score**

1. Fewer than 2 valid confirming assets → `confidenceScore` capped below the `high` band.
2. Top contributor accounts for > 60% of `Σ|w_i z_i|` while `breadth < 2` → `primaryRegime = single_asset_shock`, regardless of cosine.
3. Top two `|s_r|` within the ambiguity margin → `primaryRegime = mixed_unresolved`.
4. Any core rate missing, or fewer than 6 of 8 core assets present → `primaryRegime = insufficient_data`, no driver claim emitted.

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
8. Proxy instruments must carry `proxyFor` end to end. Never display a proxy under the name of the thing it proxies (e.g. a broad-dollar or UUP series must not be labelled `DXY`).
