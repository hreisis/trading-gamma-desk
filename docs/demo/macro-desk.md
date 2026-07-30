# Macro Desk demo & acceptance (M1-10)

Short demo of the read-only Macro Desk. The UI only renders payload fields; it does not classify or recompute confidence.

## Acceptance checklist

| Case | How | Pass when |
| --- | --- | --- |
| Live driver | `npm run daily` then open `/` | Banner includes **live driver**; regime/evidence from `data/drivers/` |
| Fixture / demo | Open `/?source=fixture` | Banner **Demo · fixture fallback**; amber demo strip; not treated as live |
| Loading | Navigate to `/` (Next `loading.tsx`) | “Loading macro desk…” skeleton |
| No data | `/?source=live` with empty `data/drivers/` | **No macro driver** empty state; no silent fixture |
| Malformed live | Corrupt latest `data/drivers/<date>.json` | **Malformed** error; previous good driver if any; **not** fixture |
| Stale session | Incomplete / partial alignment or pipeline fail with last good | Stale banner; not labeled “today” |
| Pipeline error | Failed `npm run daily` leaving `data/pipeline/status.json` ok:false | Pipeline error banner; last good driver retained |

API mirror: `GET /api/macro/latest` and `?source=fixture` / `?source=live`.

## SVG frames

- [macro-desk-live.svg](./macro-desk-live.svg) — live driver chrome
- [macro-desk-fixture.svg](./macro-desk-fixture.svg) — demo / fixture chrome

These are illustrative frames for docs review, not pixel captures of a deployed host (deployment deferred).
