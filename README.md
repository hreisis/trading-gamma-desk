# GammaDesk

AI Market Structure Copilot.

Reasoning chain: **Driver → Catalyst → Structure → Confirmation → Updated View**

Milestone 1 ships a **read-only Macro Desk**: cross-asset regime, evidence, and an interpreted `DominantDriver`. The UI never classifies markets or recomputes confidence — it only renders precomputed payloads.

**Public portfolio demo:** historical fixture only (`2026-07-29`). Not live market data. Repository: [hreisis/trading-gamma-desk](https://github.com/hreisis/trading-gamma-desk).

---

## Architecture (Milestone 1)

```text
.env (TIINGO_TOKEN)          gitignored — local daily only
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
  └─ resolveDeskRequest() — Zod-parse only, no scoring

Public deploy (GAMMADESK_PUBLIC_DEMO=1):
  fixtures/macro/public-demo.2026-07-29.json  →  desk UI
  (no Tiingo, no data/, no live driver label)
```

| Layer | Role |
| --- | --- |
| `src/ingest` | Pull Treasury / CBOE / Tiingo, cache bars, write compute snapshot |
| `src/macro` | Pure features + signature scoring (no IO) |
| `src/interpret` | Template `DominantDriver` from snapshot; copies confidence verbatim |
| `src/pipeline` | Daily orchestration + atomic driver write |
| `src/desk` | Filesystem load + public-demo / status model for UI/API |
| `src/app` | Macro Desk UI (read-only) |

Docs: [product](docs/product.md) · [architecture](docs/architecture.md) · [contracts](docs/data-contracts.md) · [tasks](docs/tasks.md) · [AGENTS](AGENTS.md)

---

## Run locally

```bash
cp .env.example .env   # set TIINGO_TOKEN — never commit .env
npm ci
npm run daily          # ingest → compute → interpret → atomic driver
npm run dev            # http://localhost:3000  (live mode when data/drivers exists)
```

Leave `GAMMADESK_PUBLIC_DEMO` **unset** locally so `npm run daily` and `/?source=live` keep working.

| Command | Purpose |
| --- | --- |
| `npm run daily` | Full refresh (`--force` replaces today’s snapshot) |
| `npm run ingest` | Pull + compute snapshot only |
| `npm run interpret` | Snapshot → atomic driver write |
| `npm run smoke:demo` | Public-demo + deploy smoke tests |
| `npm test` / `npm run typecheck` / `npm run build` | Verify |

### Desk URLs (local)

| URL | Expected |
| --- | --- |
| `/` | Live driver when `data/drivers/` has a valid file; otherwise **demo · fixture fallback** |
| `/?source=fixture` | Always demo fixture (even if live exists) |
| `/?source=live` | Live only — empty if no drivers (no silent fixture) |
| `/api/macro/latest` | Same view model as JSON |

Demo walkthrough: [docs/demo/macro-desk.md](docs/demo/macro-desk.md).

---

## Public demo deployment (M1-11)

Goal: a portfolio-safe host that never implies live data and never needs Tiingo.

1. Build from a clean checkout (no `data/`, no secrets):
   ```bash
   npm ci
   GAMMADESK_PUBLIC_DEMO=1 npm run build
   GAMMADESK_PUBLIC_DEMO=1 npm run start
   ```
2. On the host (Vercel / similar), set **only**:
   - `GAMMADESK_PUBLIC_DEMO=1`
   - Do **not** set `TIINGO_TOKEN`, do **not** upload `data/`
3. Expected behaviour:
   - `/` shows **Historical demo · fixture data · 2026-07-29**
   - Confidence shows `N/100 (uncalibrated)` — no band labels
   - `/?source=live` shows **Live data unavailable** (no silent fixture, no live label)
   - Page title / description are portfolio-oriented; GitHub link in header/footer

Preview public mode locally without touching daily:

```bash
GAMMADESK_PUBLIC_DEMO=1 npm run dev
# then open / and /?source=live
```

This milestone does **not** wire cloud Tiingo. Creating the external host is left to you after local acceptance.

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
| `fixtures/macro/**` | Yes | Contracts, scenarios, **public-demo.2026-07-29** — no Tiingo redistribution |
| `fixtures/macro/calibration/*.json` | Yes | Aggregates only |

Do not commit tokens, Tiingo bars, or generated `data/`. Do not put `TIINGO_TOKEN` on the public demo host.

---

## What “uncalibrated” means

`confidence.score` is a deterministic 0–100 audit number from geometric-mean components. While `confidence.calibrated` is `false`:

- UI may show e.g. `68/100 (uncalibrated)`.
- UI **must not** show high / medium / low band labels.
- Reporting infrastructure (`npm run calibrate`) exists; **multi-quarter outcome-linked** calibration is still pending — parameters stay unchanged until that review.

---

## Milestone status

Milestone 1 Macro path through **M1-11** (public fixture demo). **Do not start Milestone 2** until explicitly scheduled. Cloud Tiingo on the public host remains out of scope.
