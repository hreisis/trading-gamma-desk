# Catalyst fixtures

## Synthetic (public demo / M2-1)

`synthetic-events.json` is a **fixture-only** batch for product demonstration.

- Every row sets `synthetic: true`.
- Headlines are labelled illustrative — not real news or calendar prints.
- Loaded via static import in `src/catalyst/load.ts` (serverless-safe) when `GAMMADESK_PUBLIC_DEMO=1`.
- Includes an intentional malformed row and a duplicate/update pair for tests.

## Official provider samples (M2-2A / M2-2B / M2-2C1)

See `providers/` for recorded BLS ICS, BEA JSON, FOMC HTML, and BLS API JSON used by offline tests. CI must not hit live networks.

| Generated (gitignored) | Command |
| --- | --- |
| `data/catalyst/calendar-latest.json` | `npm run catalyst:fetch` |
| `data/catalyst/results-latest.json` | `npm run catalyst:results:fetch` |

`synthetic-results.json` is a labelled synthetic results fixture for public demo only.
