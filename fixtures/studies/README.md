# Study fixtures (M5-1B / M5-2)

Synthetic, commit-safe inputs for PIT research archive, exact-date offline replay, and forward outcomes.

| File | Purpose |
| --- | --- |
| `sources.m51b.json` | Manifest pointing at replay corpus + bounded gamma fixture |
| `archive/2026-07-29/daily-research.json` | Golden `DailyResearchArchive` (M5-1B) |
| `prices/spy.m52.json` | Synthetic adjClose series for M5-2 forward outcomes |

Build locally (gitignored output):

```bash
npm run studies:build -- --date 2026-07-29 --manifest fixtures/studies/sources.m51b.json
```

Replay offline (exact date required):

```bash
npm run studies:replay -- --date 2026-07-29
```

No network, no latest-fallback, no LLM.
