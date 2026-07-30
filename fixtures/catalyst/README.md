# Catalyst synthetic fixtures (M2-1)

`synthetic-events.json` is a **fixture-only** batch for product demonstration.

- Every row sets `synthetic: true`.
- Headlines are labelled illustrative — not real news or calendar prints.
- Loaded via static import in `src/catalyst/load.ts` (serverless-safe).
- Includes an intentional malformed row and a duplicate/update pair for tests.
