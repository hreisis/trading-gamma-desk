# Product

## Positioning

**GammaDesk** is an **AI Market Structure Copilot**.

It is not a stack of independent dashboards (macro page + gamma page + news page). It is a continuous reasoning loop:

**Driver → Catalyst → Structure → Confirmation → Updated View**

Core logic:

> Macro/News decides where the market *wants* to go; Positioning decides whether that move is compressed or amplified; Close decides whether the narrative actually got capital confirmation.

---

## Target users

| Persona | Need |
| --- | --- |
| Discretionary equity / index trader | Intraday structure edge around gamma levels |
| Macro / cross-asset trader | What the market is pricing today, with confirmation |
| Desk / PM reviewing the session | Close validation and next-day watchlist |

MVP assumes a single desk user (or small team), US session focus, English market language in AI outputs.

---

## Product pillars

| Module | Core question | System role |
| --- | --- | --- |
| Cross-Asset Macro | What is the market trading today? | Direction + dominant driver |
| Catalyst / Events | Why is it trading that *now*? | Causal bridge (lightweight in MVP) |
| Gamma / Positioning | How will the path behave? | Pin vs expand, walls, intraday edge |
| Close Intelligence | Was today’s thesis validated? | Replay, rotation, next-day view |

Non-negotiable product principles:

1. **Gamma is an amplifier/compressor, not a directional oracle.**
2. **Compare anomaly (z-score / relative vol), not raw % moves alone.**
3. **Never claim “flows into X” without distinguishing `Reported Flow` vs `Inferred Rotation`.**
4. **Every major surface ends in an interpreted state**, not a raw data dump.
5. **Never claim a cause the available data cannot support.** Attribution requires the module that owns that evidence.
6. **Never present stale or misaligned data as “today”**, and never display a proxy under the name of the thing it proxies.

---

## MVP scope

### In

**Cross-Asset Macro**

- Assets: Gold, Copper, BTC, Oil, US 2Y, US 10Y, USD, VIX, Credit spreads
- Output: `Dominant Driver` (regime + polarity + risk direction + confidence score + evidence + contradictions + interpretation)
- Regimes: Fed/Rates, Inflation, Growth, Liquidity, Risk sentiment — with `mixed_unresolved`, `single_asset_shock` and `insufficient_data` as honest fallbacks

Milestone 1 ships the first eight assets. Gold, Copper, Oil and USD use ETF proxies, always labelled with what they proxy; credit spreads keep a reserved contract slot and may be absent.

**Attribution honesty.** Cross-asset prices can show *what pattern* the market is trading, not *why*. So macro alone never claims geopolitical causation (that needs the Catalyst module) and never claims positioning-driven moves (that needs the Gamma module). Risk-off is reported as risk sentiment with polarity, not as a cause.

**Catalyst / Events (light)**

- Fed & economic data, Treasury auctions, geopolitics, earnings/guidance, large issuance, ETF rebalance / OPEX / mechanical events

**Gamma / Positioning**

- Inputs: Net GEX, Gamma Flip, Call/Put Wall, zero-gamma, 0DTE concentration, expected move, GEX by strike, since-prior-close / since-open deltas
- Underlyings: SPX, SPY, QQQ
- Desktop primary UI: structure regime, spot/flip/walls/expected range, since-open changes, one-line AI interpretation
- Output: `Market Structure State` + edge guidance

**Close Intelligence**

- Close quality, breadth/rotation, narrative validation vs morning thesis, view update for next day

### Out (post-MVP)

- 20Y yield as first-class macro input
- Full news NLP pipeline / multi-source research agent
- Live institutional order-flow / true ETF create-redeem as primary “flow”
- Multi-user auth, portfolio accounting, order routing
- Non-US sessions as primary UX

---

## Success criteria (MVP)

- User can answer in one glance: **driver, structure state, and what to watch next**
- AI outputs cite evidence bullets; no unsupported flow language
- Gamma panel never presents directional forecasts without structure context
- Close module can mark morning thesis as confirmed / partial / rejected with evidence

---

## Related docs

- Private vision detail: `docs/BACKBONE.md` (gitignored)
- Contracts: `docs/data-contracts.md`
- Build plan: `docs/tasks.md`
