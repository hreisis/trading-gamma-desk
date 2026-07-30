# Catalyst fixtures

## Synthetic (public demo)

Loaded via static import in `src/catalyst/load.ts` when `GAMMADESK_PUBLIC_DEMO=1` (or test `forceSynthetic`). Every synthetic row is labelled — not live data.

| Fixture | Role |
| --- | --- |
| `synthetic-events.json` | Schedule/event rows (`synthetic: true`); includes malformed + duplicate/update pairs for tests |
| `synthetic-results.json` | Linked release results for demo |
| `synthetic-documents.json` | Official document archive for demo |
| `synthetic-ai-briefs.json` | Demo AI official briefs (checked-in; never live OpenAI) |
| `synthetic-market-context.json` | Demo M2-4A ETF proxy snapshots |
| `synthetic-ai-market-reactions.json` | Demo M2-4C AI reaction narratives |

Demo **4B** reactions are classified at load time from synthetic 4A (same rules engine as `catalyst:market-reactions:build`). Demo **briefs** are extracted at load from synthetic documents.

## Official provider samples (offline tests)

See `providers/` for recorded BLS ICS, BEA JSON, FOMC HTML, and BLS API JSON. CI must not hit live networks.

## Local caches (gitignored)

| Generated | Command |
| --- | --- |
| `data/catalyst/calendar-latest.json` | `npm run catalyst:fetch` |
| `data/catalyst/results-latest.json` | `npm run catalyst:results:fetch` |
| `data/catalyst/documents-latest.json` | `npm run catalyst:documents:fetch` |
| `data/catalyst/briefs-latest.json` | `npm run catalyst:briefs:build` |
| `data/catalyst/ai-briefs-latest.json` | `npm run catalyst:briefs:enhance` |
| `data/catalyst/market-context-latest.json` | `npm run catalyst:market-context:fetch` |
| `data/catalyst/market-reactions-latest.json` | `npm run catalyst:market-reactions:build` |
| `data/catalyst/ai-market-reactions-latest.json` | `npm run catalyst:market-reactions:enhance` |
| `data/catalyst/update-latest.json` | `npm run catalyst:update` |

Public demo never reads these caches and never calls BLS/BEA/Fed/Alpaca/OpenAI.
