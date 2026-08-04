# Product

## North Star

**GammaDesk** is a **study-backed market decision agent**.

It helps a discretionary desk move through a repeatable loop:

**Observe → Research → Evaluate → Decide → Review**

| Stage | Role |
| --- | --- |
| **Observe** | What is the market showing now? (macro regime, catalysts, gamma structure, session context) |
| **Research** | What historical or rule-based evidence applies? (replay, regime studies, documented methodology) |
| **Evaluate** | What does the evidence support — and what does it not support? (scores, contradictions, guardrails) |
| **Decide** | What action or stance follows under explicit policy? (private thresholds, sizing, allocation rules) |
| **Review** | Did the decision hold up? Update beliefs, calibration, and policy from outcomes. |

The product is **not** a stack of independent dashboards or a generic AI copilot. Modules serve the loop above and converge on an interpreted state — not a raw data dump.

Internal module chain (still contractual):

**Driver → Catalyst → Structure → Confirmation → Updated View**

Core logic:

> Macro/News decides where the market *wants* to go; Positioning decides whether that move is compressed or amplified; Close decides whether the narrative actually got capital confirmation.

---

## Engineering split (non-negotiable)

1. **Deterministic compute first.** Features, scores, GEX, replay statistics, and contract validation run as pure, auditable code — no LLM in the calculation path.
2. **LLM is constrained interpretation.** Study narratives, briefs, and decision support consume **precomputed evidence** only; outputs are schema-validated and guardrailed; failures fall back to rule-based text.
3. **Scores are not probabilities until calibrated.** Confidence and similar 0–100 outputs are audit numbers while `calibrated` is `false`; UI must not imply P(up) or high/medium/low bands without outcome-linked calibration.
4. **Public vs private boundary.** This public repo contains **contracts, methodology, interfaces, and synthetic examples only**. Private thresholds, portfolio holdings, allocation policy, and decision logs live in a **separate private repository** — `.gitignore` here is secondary local protection, not the primary boundary.

---

## Target users

| Persona | Need |
| --- | --- |
| Discretionary equity / index trader | Intraday structure edge around gamma levels; decision support under explicit policy |
| Macro / cross-asset trader | What the market is pricing today, with confirmation and study context |
| Desk / PM reviewing the session | Close validation, shadow outcomes, and next-day view |

MVP assumes a single desk user (or small team), US session focus, English market language in AI outputs.

---

## Roadmap milestones (M4–M9)

Shipped work (M1–M6) established macro regime, catalyst evidence, desk UI foundations, gamma structure, deterministic strategy research, and a constrained study memo agent. **Current and forward work:**

| Milestone | Theme | Outcome |
| --- | --- | --- |
| **M4** | Gamma snapshots / features | ✅ Immutable snapshots, change engine, bounded provider, desk-ready `MarketStructureState`, Structure·Gamma UI |
| **M5** | Strategy research / replay / regime | ✅ PIT archive, forward outcomes, similar-regime study, evidence bundle — all deterministic |
| **M6** | Constrained LLM study agent | ✅ Cited study memos from `StudyEvidenceBundle` only; validation + fallback; integration smoke; end-to-end `studies:pipeline` |
| **M7** | Private portfolio policy | **Planned (private repo)** — thresholds, sizing, allocation rules, instrument universe; parallel track, not blocking M8 |
| **M8** | Minimal decision interface | ✅ Shipped — `/decide?date=` decision surface with evidence drill-down (M8-1…M8-4) |
| **M9** | Shadow mode / review loop | Decision logs in private repo; compare to outcomes; optional calibration feed |

M4–M6 are **shipped on the public product path**. M7–M9 require the **separate private repository** boundary for policy and logs; **M8** is the next milestone in this public repo.

---

## Product pillars

| Module | Core question | Loop stage |
| --- | --- | --- |
| Cross-Asset Macro | What is the market trading today? | Observe |
| Catalyst / Events | Why is it trading that *now*? | Observe → Research |
| Gamma / Positioning | How will the path behave? | Observe → Evaluate |
| Strategy research / replay | What happened in similar regimes? | Research |
| Study agent (LLM) | What do the cited facts imply in plain language? | Evaluate (interpretation only) |
| Portfolio policy | What are we allowed to do? | Decide (private) |
| Close / review | Was the thesis validated? What changed? | Review |

Non-negotiable product principles:

1. **Gamma is an amplifier/compressor, not a directional oracle.**
2. **Compare anomaly (z-score / relative vol), not raw % moves alone.**
3. **Never claim “flows into X” without distinguishing `Reported Flow` vs `Inferred Rotation`.**
4. **Every major surface ends in an interpreted state**, not a raw data dump.
5. **Never claim a cause the available data cannot support.** Attribution requires the module that owns that evidence.
6. **Never present stale or misaligned data as “today”**, and never display a proxy under the name of the thing it proxies.

---

## Scope boundaries

### In (through M9)

- Cross-asset macro, catalyst evidence chain (M1–M3, shipped)
- Gamma GEX engine, historical snapshots, change comparisons, and desk-ready features (M4, shipped)
- Deterministic strategy replay and regime studies (M5, shipped)
- Evidence-grounded, guardrailed LLM study agent + end-to-end pipeline (M6, shipped)
- Private portfolio policy layer (M7 — separate private repo, planned)
- Minimal decision UI (M8 — next public milestone)
- Shadow logging and review loop (M9 — decision logs in private repo)

### Out (unless explicitly replanned)

- 20Y yield as first-class macro input
- Live institutional order-flow / true ETF create-redeem as primary “flow”
- Multi-user auth, order routing, hosted portfolio accounting
- Non-US sessions as primary UX
- Uncalibrated scores presented as probabilities or trade signals

---

## Success criteria

- Operator can answer in one pass: **what we observe, what studies support, what policy allows, and what we decided**
- AI outputs cite evidence bullets; no unsupported flow or causation language
- Gamma never presented as a standalone directional forecast
- Review loop can compare decision log to outcomes without contaminating public demo data
- Study memos cite bundle fields only; insufficient evidence abstains; validation failures never silently pass (M6 exit)

---

## Current status (M6 close-out)

| Area | Status |
| --- | --- |
| M5-3 similar-regime study | ✅ Shipped |
| M5-4 evidence bundle | ✅ Shipped |
| M6-1…M6-4 study agent + pipeline | ✅ Shipped |
| M6 exit criteria | ✅ Satisfied |
| **Next public milestone** | **M9** shadow/review loop (private repo) |
| M8-1 decision surface | ✅ Shipped (`/decide?date=`) |
| M8-2 uncertainty + study artifacts | ✅ Shipped (exact-date `data/` loads, evidence panel, integrity errors, stance suppression) |
| M8-3 auditable evidence drill-down | ✅ Shipped (expandable horizons, matched sessions, citation resolution) |
| M8-4 UI polish + smoke | ✅ Shipped (ribbons, nav, responsive layout, synthetic demo labeling, state smoke tests) |

**M8 Study validation:** UI and pipeline wiring complete. **Real historical Study validation not passed** — 2026-07-29 local acceptance documented fixture-backed archive, peer corpus, and n=1 cohort; exact-date structure unavailable. **M8-5a** ships real Tiingo SPY prices + exact-date `StudyPriceSeries` (real prices alone do not make the cohort real). **M8-5b shipped** — offline real PIT archive + peer corpus builders from local `data/`; default non-demo pipeline still fixture-backed until **M8-5c**.
| M7 private policy | Planned — separate private repo |

---

## Related docs

- Private vision detail: `docs/BACKBONE.md` (gitignored)
- Contracts: `docs/data-contracts.md`
- Build plan: `docs/tasks.md`
