# Macro Desk demo & acceptance (M1-10 / M1-11)

Short demo of the read-only Macro Desk. The UI only renders payload fields; it does not classify or recompute confidence.

## Acceptance checklist (local)

| Case | How | Pass when |
| --- | --- | --- |
| Live driver | `npm run daily` then open `/` | Banner includes **live driver**; regime/evidence from `data/drivers/` |
| Fixture / demo | Open `/?source=fixture` | Banner **Demo · fixture fallback**; amber demo strip; not treated as live |
| Loading | Navigate to `/` (Next `loading.tsx`) | “Loading macro desk…” skeleton |
| No data | `/?source=live` with empty `data/drivers/` | **No macro driver** empty state; no silent fixture |
| Malformed live | Corrupt latest `data/drivers/<date>.json` | **Malformed** error; previous good driver if any; **not** fixture |
| Stale session | Incomplete / partial alignment or pipeline fail with last good | Stale banner; not labeled “today” |
| Pipeline error | Failed `npm run daily` leaving `data/pipeline/status.json` ok:false | Pipeline error banner; last good driver retained |

## Public demo (M1-11)

```bash
GAMMADESK_PUBLIC_DEMO=1 npm run dev
```

| Case | Pass when |
| --- | --- |
| `/` | Banner **Illustrative demo · synthetic scenario**; disclaimer that values are synthetic; no live label; fixture date not presented as a real session |
| `/?source=live` | **Live data unavailable in public demo**; no driver payload; not disguised as live |
| Confidence | `N/100 (uncalibrated)` only |
| Narrative | Example only — do **not** treat “Rates-led risk-on” as a real 2026-07-29 market call |

API mirror: `GET /api/macro/latest` and `?source=fixture` / `?source=live`.

## SVG frames

- [macro-desk-fixture.svg](./macro-desk-fixture.svg) — illustrative synthetic demo chrome
- [macro-desk-live.svg](./macro-desk-live.svg) — local live path (not used on public host)
