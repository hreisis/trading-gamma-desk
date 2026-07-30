# Catalyst fixtures

## Synthetic (public demo / M2-1)

`synthetic-events.json` is a **fixture-only** batch for product demonstration.

- Every row sets `synthetic: true`.
- Headlines are labelled illustrative — not real news or calendar prints.
- Loaded via static import in `src/catalyst/load.ts` (serverless-safe) when `GAMMADESK_PUBLIC_DEMO=1`.
- Includes an intentional malformed row and a duplicate/update pair for tests.

## Official provider samples (M2-2A)

See `providers/` for recorded BLS ICS and BEA JSON used by offline tests. CI must not hit live BLS/BEA. Generated local cache lives at gitignored `data/catalyst/calendar-latest.json` via `npm run catalyst:fetch`.
