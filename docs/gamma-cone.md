# Gamma Cone

Gamma Cone = **volatility-derived probability range** + **gamma-structure overlay**.

The statistical cone uses symbol representative IV from the bounded options chain. Call Wall, Put Wall, and Gamma Flip are structural anchors for interpretation and chart pivots — they are **not** inputs to the 50% or 90% statistical boundaries.

## Full-session sigma

Annualized IV is carried as a decimal (e.g. `0.142` = 14.2%).

```text
σ_daily = IV / √252
σ_points = Spot × σ_daily = Spot × IV / √252
```

## Probability bands

| Band | z (two-sided normal) | Formula |
| --- | --- | --- |
| 50% Core Range | 0.674 | Spot ± 0.674 × σ_points |
| 90% Expected Range | 1.645 | Spot ± 1.645 × σ_points |

Implementation constants: `GAMMA_CONE_Z_50`, `GAMMA_CONE_Z_90` in `src/desk/format-gamma.ts`.

## Rest-of-day cone (intraday)

Uses the **same symbol IV**, but scales remaining session time:

```text
σ_remaining = Spot × σ_daily × √(remainingSessionFraction)
```

Then applies the same z-scores to `σ_remaining` for 50% and 90% rest-of-day bands.

This is **not** the same as the full-session cone. Do not mix full-day σ with √(time) scaling in one formula.

The legacy `estimateRestOfDayRange()` helper returns only the **90%** rest-of-day band and may use macro VIX fallback when called outside Gamma Cone. `buildGammaCone()` always uses **bounded representative IV** and never VIX as a silent substitute.

## Volatility risk premium (VRP)

```text
VRP (vol pts) = IV% − HV20%
```

- Positive VRP → richer implied range vs recent realized vol (`rich_implied` / normal).
- Negative VRP → warning: realized movement may exceed the implied cone (`cheap_implied`).
- VRP does **not** resize the cone in v1.

## Wall touch

Reuses `estimateWallTouchProbabilities()` — reflection-principle approximation with shared `normalCdf`. Call and put touch percentages are separate outputs.

## Gamma regime interpretation

Deterministic context only (no directional equity call from gamma alone):

| Regime | Interpretation |
| --- | --- |
| Positive | Stabilizing / mean-reversion / compression context |
| Negative | Amplifying / trend-amplification context |
| Near zero | Fragile transition regime |
| Spot below flip | Volatility expansion warning |

## Provenance

`GammaConeResult.provenance` carries IV source, options session date, fixture flag, and explicit mode labels for full-session vs rest-of-day math.

If symbol IV is unavailable, cone `status` is `unavailable` — no fabricated precise ranges.

## Module map

| File | Role |
| --- | --- |
| `src/desk/format-gamma.ts` | Shared σ math, rest-of-day bands, wall touch, HV20, VRP |
| `src/desk/gamma-cone.ts` | `buildGammaCone()`, `GammaConeResult` contract |
| `src/desk/v2-command-center.ts` | `view.gammaCone` — `[SPY, QQQ]` on server view model |

## Limitations

- IV is near-spot representative from a **bounded single-expiry** sample, not a full surface.
- Wall levels are bounded-scope estimates, not vendor “market walls”.
- Rest-of-day bands require an open regular session (`remainingSessionFraction > 0`).
- Wall-touch estimates require aligned same-day options session and fresh gamma snapshot.

Walls and Gamma Flip are structural anchors, not direct inputs to the statistical cone.
