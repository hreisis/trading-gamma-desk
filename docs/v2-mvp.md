# GammaDesk V2 MVP

## Product reset

GammaDesk should reduce the operator's pre-market and post-market preparation to
three to five minutes. It is not trying to replace a full charting, options, or
news terminal. The first screen answers three questions:

1. What kind of trading day is this?
2. How much portfolio risk is appropriate?
3. Where is index gamma likely to compress or amplify the session path?

The product still preserves the reasoning chain:

**Macro + Breadth + Rates + Credit + High-beta leadership + Event gate + Gamma
structure -> stance and exposure -> review**

## First viewport

| Surface | Output | V1 trust rule |
| --- | --- | --- |
| Daily stance | Strong Buy / Buy / Hold / Reduce / Sell, with optional Buy-the-dip callout | Withhold when required engines are unavailable |
| Portfolio risk | 0-100 audit score; 0 is lowest risk and 100 is highest risk | Not a probability; show change and evidence |
| Recommended exposure | 0-150% gross exposure range | Derived from explicit policy; never `150 - risk` |
| Gamma corridor | SPY and QQQ spot, Put Wall, Call Wall, regime and bounded corridor | Gamma is not directional; stale/partial/bounded status remains visible |
| Allocation map | High Beta / Defense / Metals / Hedge percentages | Percentages describe deployed capital, not total exposure |

## Decision separation

The engines remain separate until the final decision layer:

- **Structural Risk**: breadth/internals, volatility/positioning, rates/liquidity,
  credit/stress, and high-beta leadership.
- **Tactical Opportunity**: distinguishes a technical washout from a macro- or
  credit-driven decline.
- **Shock / Event Gate**: CPI, FOMC, payrolls, geopolitical escalation, credit
  event, or an abnormal rates move may override an otherwise attractive dip.
- **Gamma Structure**: describes the day's compression/amplification regime and
  bounded walls. It is not included in the structural risk score.
- **Inferred Rotation**: relative-price leadership may support allocation, but
  must never be labelled reported flow without real flow data.

## V1 risk inputs

| Engine | Initial weight | Required evidence |
| --- | ---: | --- |
| Breadth / internals | 25% | SPY, Nasdaq/QQQ, high-beta and semiconductor breadth |
| Volatility / positioning | 20% | VIX level/change, term structure, put/call when available |
| Rates / liquidity | 20% | 2Y, 10Y, real-yield acceleration, USD |
| Credit / stress | 15% | HYG/LQD and high-yield spread or an explicit proxy label |
| High-beta leadership | 20% | SPHB/SPLV, IWM/SPY, QQQ/SPY, SMH/QQQ, BTC |

Weights are a methodology starting point, not a calibrated probability model.
Historical output should be retained for daily review before weights or labels
are treated as validated.

## Gamma scope

- SPY and QQQ are both required for the primary workspace.
- Use separately loaded symbol data; never reuse SPY data under a QQQ label.
- Prefer the agreed multi-expiry E0/E1/E2 aggregate when that artifact is
  available. A bounded single-expiry snapshot must remain labelled as such.
- Always show Spot, Call Wall, Put Wall, regime, coverage/freshness and source.
- A likely pin or expected range is unavailable until a separate, tested model
  exists. It must not be inferred from a wall alone.
- True Gamma Flip remains unavailable until spot-shock recomputation can locate
  a genuine zero crossing.

## UX

- White / very light gray canvas, restrained semantic color, generous spacing.
- Collapsible left sidebar; secondary research does not compete with the first
  viewport.
- Chinese and English use the same numerical payload and a small UI dictionary.
- The first implementation is isolated at `/v2` while the local branch is
  reconciled with newer live/demo routing work.

## Missing inputs before live decisions

The repository can currently reuse Macro, MarketData.app gamma snapshots and
Alpaca market context. Live Risk, Opportunity, Exposure and Allocation remain
withheld until the following are wired and timestamp-aligned:

1. SPY/QQQ/high-beta/semiconductor breadth.
2. VIX term structure and positioning input.
3. Credit stress input.
4. Relative leadership series for rotation.
5. Event/shock gate state.
6. A versioned exposure/allocation policy and daily decision log.

