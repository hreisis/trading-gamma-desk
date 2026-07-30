# GammaDesk

AI Market Structure Copilot.

Reasoning chain: **Driver → Catalyst → Structure → Confirmation → Updated View**

Milestone 1 ships a **read-only Macro Desk**: cross-asset regime, evidence, and an interpreted `DominantDriver`. The UI never classifies markets or recomputes confidence — it only renders precomputed payloads.

---

## Architecture (Milestone 1)

```text
.env (TIINGO_TOKEN)          gitignored
        │
        ▼
npm run daily
  ├─ ingest   → data/bars/  + data/snapshots/   (compute inside ingest)
  └─ interpret→ data/drivers/<session>.json     (atomic write)
        │
        ▼
data/pipeline/status.json    ok | error (keeps last good session)
        │
        ▼
Next.js desk (app/) + GET /api/macro/latest
  └─ loadMacroDesk() — Zod-parse only, no scoring
```

| Layer | Role |
| --- | --- |
| `src/ingest` | Pull Treasury / CBOE / Tiingo, cache bars, write compute snapshot |
| `src/macro` | Pure features + signature scoring (no IO) |
| `src/interpret` | Template `DominantDriver` from snapshot; copies confidence verbatim |
| `src/pipeline` | Daily orchestration + atomic driver write |
| `src/desk` | Filesystem load + status model for UI/API |
| `src/app` | Macro Desk UI (read-only) |

Docs: [product](docs/product.md) · [architecture](docs/architecture.md) · [contracts](docs/data-contracts.md) · [tasks](docs/tasks.md) · [AGENTS](AGENTS.md)

---

## Run locally

```bash
cp .env.example .env   # set TIINGO_TOKEN — never commit .env
npm ci
npm run daily          # ingest → compute → interpret → atomic driver
npm run dev            # http://localhost:3000
```

| Command | Purpose |
| --- | --- |
| `npm run daily` | Full refresh (`--force` replaces today’s snapshot) |
| `npm run ingest` | Pull + compute snapshot only |
| `npm run interpret` | Snapshot → atomic driver write |
| `npm test` / `npm run typecheck` / `npm run build` | Verify |

### Desk URLs (manual acceptance)

| URL | Expected |
| --- | --- |
| `/` | Live driver when `data/drivers/` has a valid file; otherwise **demo · fixture fallback** |
| `/?source=fixture` | Always demo fixture (even if live exists) |
| `/?source=live` | Live only — empty state if no drivers (no silent fixture) |
| `/api/macro/latest` | Same view model as JSON (`isDemo`, `status`, `error`, `pipeline`) |

Demo walkthrough and SVG frames: [docs/demo/macro-desk.md](docs/demo/macro-desk.md).

---

## Daily pipeline & failure behaviour

1. **ingest** — network pull, write `data/bars/`, write immutable `data/snapshots/<session>.json` (compute).
2. **interpret** — read snapshot only; build `DominantDriver`; **atomic** write to `data/drivers/<session>.json` (temp + rename).
3. **status** — `data/pipeline/status.json` records ok/error.

On failure:

- The previous valid driver file is **not** overwritten.
- The desk shows **pipeline error** and/or **stale** while still rendering the last good driver when one exists.
- A **present but malformed** live driver never silently falls back to the fixture.

---

## Data security boundary

| Path | In git? | Notes |
| --- | --- | --- |
| `.env` / tokens | **No** | Local only; see `.env.example` |
| `data/bars/` (incl. Tiingo EOD) | **No** | gitignored raw cache |
| `data/snapshots/`, `data/drivers/`, `data/pipeline/`, `data/calibration/` | **No** | Generated locally |
| `fixtures/macro/**` | Yes | Contracts, scenarios, public history summary — **no Tiingo redistribution** |
| `fixtures/macro/calibration/*.json` | Yes | Aggregates only |

Do not commit tokens, Tiingo bars, or generated `data/`.

---

## What “uncalibrated” means

`confidence.score` is a deterministic 0–100 audit number from geometric-mean components. While `confidence.calibrated` is `false`:

- UI may show e.g. `68/100 (uncalibrated)`.
- UI **must not** show high / medium / low band labels.
- Reporting infrastructure (`npm run calibrate`) exists; **multi-quarter outcome-linked** calibration is still pending — parameters stay unchanged until that review.

---

## Milestone status

Milestone 1 Macro path is productized through **M1-10** (desk states + daily pipeline). **Do not start Milestone 2** until explicitly scheduled. Deployment is deferred until local error states and the daily runbook are accepted.
