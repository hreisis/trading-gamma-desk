# Product

## North Star

**GammaDesk** is a **read-only macro structure copilot** for a discretionary desk.

**Shipped surfaces (MVP):**

| Surface | Role |
| --- | --- |
| **Macro Desk** | Cross-asset regime, SPY/QQQ bounded gamma, tier-1 catalyst evidence |
| **Market** | Live Alpaca watchlist quotes (SPY, QQQ, BTC/USD, optional watchlist) |
| **AI Study** | Daily briefing from current real inputs when configured locally |

Internal module chain (still contractual):

**Driver → Catalyst → Structure → Confirmation → Updated View**

Core logic:

> Macro decides where the market *wants* to go; Positioning decides whether that move is compressed or amplified; Catalysts explain *why now*.

---

## Engineering split (non-negotiable)

1. **Deterministic compute first.** Features, scores, GEX, and contract validation run as pure, auditable code — no LLM in the calculation path.
2. **LLM is constrained interpretation.** AI Study and catalyst AI layers consume **precomputed evidence** only; outputs are schema-validated and guardrailed; failures fall back to rule-based text.
3. **Scores are not probabilities until calibrated.** Confidence and similar 0–100 outputs are audit numbers while `calibrated` is `false`; UI must not imply P(up) or high/medium/low bands without outcome-linked calibration.
4. **Public vs private boundary.** This public repo contains **contracts, methodology, interfaces, and synthetic examples only**. Private thresholds, portfolio holdings, allocation policy, and decision logs live in a **separate private repository**.

---

## Target users

| Persona | Need |
| --- | --- |
| Discretionary equity / index trader | Intraday structure edge around bounded gamma levels |
| Macro / cross-asset trader | What the market is pricing today, with catalyst context |
| Desk / PM reviewing the session | Regime + structure + evidence-backed catalyst briefs |

MVP assumes a single desk user (or small team), US session focus, English market language in AI outputs.

---

## Product pillars

| Module | Core question | Surface |
| --- | --- | --- |
| Cross-Asset Macro | What is the market trading today? | Macro Desk |
| Catalyst / Events | Why is it trading that *now*? | Macro Desk |
| Gamma / Positioning | How may the path behave (bounded sample)? | Macro Desk |
| Market quotes | What are key symbols doing now? | Market |
| AI Study | What do cited facts imply in plain language? | AI Study |

Non-negotiable product principles:

1. **Gamma is an amplifier/compressor, not a directional oracle.**
2. **Compare anomaly (z-score / relative vol), not raw % moves alone.**
3. **Never claim “flows into X” without distinguishing `Reported Flow` vs `Inferred Rotation`.**
4. **Every major surface ends in an interpreted state**, not a raw data dump.
5. **Never claim a cause the available data cannot support.**
6. **Never present stale or misaligned data as “today”.**

---

## Scope boundaries

### In (current MVP)

- Cross-asset macro, catalyst evidence chain (M1–M3)
- Bounded gamma GEX engine + Structure·Gamma UI (M4)
- Alpaca market panel
- AI Study briefing from live inputs when configured

### Out (unless explicitly replanned)

- Historical Study / Decide / News surfaces (removed from this repo)
- 20Y yield as first-class macro input
- Live institutional order-flow / true ETF create-redeem as primary “flow”
- Multi-user auth, order routing, hosted portfolio accounting
- Non-US sessions as primary UX
- Uncalibrated scores presented as probabilities or trade signals

---

## Success criteria

- Operator can read regime, bounded structure, and catalyst evidence on Macro Desk in one viewport
- Market panel shows live quotes or explicit unavailable states — no silent fallback
- AI Study cites only provided facts; no unsupported flow or causation language
- Gamma never presented as a standalone directional forecast
- Public demo never calls live providers or exposes secrets

---

## Current status

| Area | Status |
| --- | --- |
| Macro Desk | ✅ Shipped |
| Catalyst evidence chain | ✅ Shipped |
| Bounded gamma (SPY/QQQ) | ✅ Shipped |
| Market (Alpaca) | ✅ Shipped |
| AI Study | ✅ Shipped |
| M7 private policy | Planned — separate private repo |
| M9 shadow/review loop | Planned — separate private repo |

---

## Related docs

- Private vision detail: `docs/BACKBONE.md` (gitignored)
- Contracts: `docs/data-contracts.md`
- Build plan: `docs/tasks.md`
