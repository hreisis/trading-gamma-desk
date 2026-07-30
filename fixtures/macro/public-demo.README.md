# Public demo fixture

`public-demo.2026-07-29.json` is a **synthetic** `DominantDriver` for the portfolio demo (`GAMMADESK_PUBLIC_DEMO=1`).

- Values and the “Rates-led risk-on” label are illustrative only.
- The embedded `marketSessionDate` exists for schema/structure tests; the UI must not present it as a real historical session.
- Not derived from a live Tiingo pull for public deployment.
- Runtime loads it via **static import** in `src/desk/public-demo.ts` so Vercel/serverless does not need this path on disk at request time.
