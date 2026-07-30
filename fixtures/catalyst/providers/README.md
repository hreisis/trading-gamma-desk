# Official calendar provider fixtures (M2-2A)

Recorded / minimal payloads for offline tests. CI must not hit BLS or BEA.

| File | Source |
| --- | --- |
| `bls-sample.ics` | Folded ICS lines, escaped text, Eastern floating + Zulu DTSTART |
| `bea-sample.json` | BEA `release_dates.json` shape (subset of series) |

These are **schedules**, not observed prints. Do not treat fixture timestamps as live market data.
