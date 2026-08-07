# GammaDesk V2 Roadmap

Single source of truth for V2 phase status, active milestone, and product guardrails.
For product scope and first-viewport contracts see `docs/v2-mvp.md`. For module I/O shapes see `docs/data-contracts.md`.

---

## Current Status

**Last updated:** 2026-08-06

**Current phase:** Phase 2 — Breadth + Leadership

**Active milestone:** V2-3B4 — Durable Daily Breadth Pipeline

### Verified on main

- V2 homepage promoted to `/`
- Timestamp-aligned `MarketInputSnapshot` foundation
- Event Gate market input
- Deterministic SPY breadth computation
- V2 loading skeleton
- Hermetic Event Gate tests
- 545 tests passing
- typecheck / build / production smoke / GitHub Actions passing

### Known issues (not blocking V2-3B4)

- Left sidebar links do not map correctly to target workspace / panel
- Some panels show no data
- Empty panels must be diagnosed separately: bad navigation, UI loader stuck, missing production snapshot, or upstream unavailable — not all attributable to the breadth pipeline

---

## Roadmap

| Phase | Deliverable | Status |
| --- | --- | --- |
| 0 | Repository / V2 state synchronization | Complete |
| 1 | Timestamp-aligned `MarketInputSnapshot` | Foundation complete; coverage partial |
| 2 | Breadth + Leadership | In progress |
| 3 | Volatility + Rates + Credit + Event Gate | Partial |
| 4 | Risk Engine V1 | Not started |
| 5 | Dip Opportunity | Not started |
| 6 | Exposure + Allocation Policy | Not started |
| 7 | Homepage live decision integration | Not started |
| 8 | Multi-expiry Gamma upgrade | Not started |
| 9 | Shadow Review | Not started |

**Phase notes (high level):**

- **Phase 0** — V2 branch reconciled with live/demo routing; V2 command center is the primary `/` surface.
- **Phase 1** — Shared snapshot envelope with session alignment, per-asset source dates, and stale metadata; not every engine field is populated yet.
- **Phase 2** — Real breadth internals and relative leadership inputs wired into the snapshot and desk; durable daily production path is the current gap (V2-3B4).
- **Phase 3** — Volatility/positioning, rates/liquidity, credit/stress engines plus Event Gate override logic; Event Gate input exists; other engines partial or fixture-backed.

---

## Active Milestone — V2-3B4

**Goal:** Establish a durable daily breadth **production** pipeline — precomputed, versioned, and read by the UI — not on-demand constituent math at page load.

### Pipeline

```text
scheduled job
  → fetch constituent data (holdings universe + daily bars)
  → compute and validate breadth snapshot
  → persist versioned snapshot artifact
  → atomically update latest pointer
  → UI reads latest only
  → expose stale / unavailable / last-known-good states
```

### Definition of done

- Clean checkout reproduces the pipeline via documented commands and fixtures
- Tests do not depend on network or local `data/`
- Versioned snapshot contract (schema + identity fields) is documented and validated
- Atomic latest write; failed runs do not corrupt or delete the prior good artifact
- Fetch failure retains last-known-good with explicit stale metadata
- Page request does **not** recompute ~503 SPY constituents in real time
- UI and API surfaces show stale / unavailable / last-known-good distinctly
- typecheck, test, build, and smoke pass
- Production deployment verified end-to-end

### Out of scope for V2-3B4

- Fixing sidebar navigation mapping (tracked under known issues)
- QQQ / SPHB / SMH durable pipelines (may follow as V2-3B5+ once SPY path is proven)
- Risk score, exposure, or homepage decision integration

---

## Product Guardrails

These rules apply across all V2 phases. Do not ship UI or copy that violates them.

| Rule | Meaning |
| --- | --- |
| Risk Score | Audit score (0 = lowest risk, 100 = highest). **Not** a probability of decline. |
| Deterministic core | LLM does not participate in scoring, breadth, risk, exposure, or allocation math. |
| Gamma boundary | Gamma structure is **not** an input to Structural Risk. |
| Opportunity separation | Dip Opportunity is separate from Structural Risk; shock/Event Gate may veto a dip call. |
| Breadth vs leadership | True breadth internals and proxy/relative leadership must be labelled and never conflated. |
| Exposure policy | Recommended exposure follows an explicit versioned policy — never `150 − risk`. |
| Private data | Portfolio policy, positions, and decision logs stay in a **private** repo, not this public tree. |

Flow language: use `reported_flow` only with real flow data; otherwise `inferred_rotation` with confidence and basis. Never state capital inflows as fact from price alone.

Gamma: amplifier/compressor for session path — not a standalone directional buy/sell signal for SPX.

---

## Later Phases

Brief targets only; implementation detail lives in contracts and phase PRs.

### Phase 4 — Risk Engine V1

Combine breadth, volatility, rates, credit, and high-beta leadership into a single Structural Risk score using documented weights (methodology starting point, not a calibrated probability model). Withhold or degrade the score when required engines are unavailable. Show change, evidence bullets, and per-engine contribution — not a traffic-light without basis.

### Phase 5 — Dip Opportunity

Distinguish a technical washout from a macro- or credit-driven decline. Tactical Opportunity stays separate from Structural Risk; Event Gate / shock state may override an otherwise attractive dip. No trade advice in public contracts or UI copy.

### Phase 6 — Exposure + Allocation Policy

Versioned exposure range (0–150% gross) and allocation map (High Beta / Defense / Metals / Hedge) from explicit policy artifacts. Percentages describe deployed capital within the recommended gross envelope. Daily decision log and policy versions are private-repo concerns; public repo ships interfaces and synthetic examples only.

### Phase 7 — Homepage live decision integration

Wire stance (Strong Buy / Buy / Hold / Reduce / Sell), portfolio risk, recommended exposure, gamma corridor, and allocation map on the first viewport from live engines — withhold when inputs are missing rather than fabricating. `preview=1` may show explicitly labelled illustrative values only.

### Phase 8 — Multi-expiry Gamma upgrade (E0 / E1 / E2)

SPY and QQQ gamma from separately loaded symbol data; prefer multi-expiry E0/E1/E2 aggregate when available. Single-expiry or bounded snapshots must remain labelled. True Gamma Flip stays unavailable until spot-shock recomputation can locate a genuine zero crossing; do not infer expected range or pin from walls alone.

### Phase 9 — Shadow Review

Post-session review loop: compare morning stance, risk, and exposure against realized session and documented catalyst/gamma context. Shadow mode and outcome-linked calibration feed private review workflows; public repo may expose review **contracts** and synthetic replay examples only.

---

## Relationship to other docs

| Doc | Role |
| --- | --- |
| `docs/v2-roadmap.md` (this file) | **Current** V2 phase status and active milestone |
| `docs/v2-mvp.md` | Product reset, first viewport, trust rules, missing-input inventory |
| `docs/tasks.md` | **Historical** living build log (M1–M9 and early V2 table); may lag this roadmap |
| `docs/data-contracts.md` | Contract shapes and changelog |
| `docs/product.md` | North star and shipped-surface narrative |

When `tasks.md` disagrees with this file on V2 progress, **this file wins** until `tasks.md` is updated in a separate doc pass.

---

## Update Rule

1. Read this file before starting a new milestone.
2. Keep exactly **one** active milestone at a time.
3. Mark a phase or milestone **Complete** only after code and verification land on main (tests, typecheck, build, smoke as applicable).
4. On milestone completion: update **Last updated**, phase status, active milestone, and the roadmap table.
5. Treat **verified code on main** as truth — not old chat transcripts, stale branches, or local `data/` caches.
6. Do not duplicate long implementation detail here; link to contracts, architecture, or the closing PR instead.
