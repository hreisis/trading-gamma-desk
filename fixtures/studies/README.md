# Study fixtures (M5-1B – M6-4)

Synthetic, commit-safe inputs for PIT research archive, exact-date offline replay, forward outcomes, similar-regime evidence, study memos, and end-to-end pipeline.

| File | Purpose |
| --- | --- |
| `sources.m51b.json` | Manifest pointing at replay corpus + bounded gamma fixture |
| `archive/2026-07-29/daily-research.json` | Golden `DailyResearchArchive` (M5-1B) |
| `prices/spy.m52.json` | Synthetic adjClose series for M5-2 forward outcomes |
| `similar-regime-corpus.m53.json` | PIT match profiles for M5-3 similar-regime tests |
| `profiles/peer-m64.json` | Peer match profile for M6-4 pipeline corpus |
| `pipeline.m64.json` | Golden `StudyPipelineManifest` (M6-4) |
| `evidence-bundle.m62.json` | Golden `StudyEvidenceBundle` for M6-2 memo workflow |

Build locally (gitignored output):

```bash
npm run studies:build -- --date 2026-07-29 --manifest fixtures/studies/sources.m51b.json
```

Replay offline (exact date required):

```bash
npm run studies:replay -- --date 2026-07-29
```

Study memo from exact evidence bundle (exact date required):

```bash
npm run studies:memo -- --date 2026-07-29 --bundle fixtures/studies/evidence-bundle.m62.json
```

End-to-end pipeline (archive → evidence → validated memo):

```bash
npm run studies:pipeline -- --date 2026-07-29 --manifest fixtures/studies/pipeline.m64.json
```

No network, no latest-fallback. OpenAI optional for memo only when key is set locally; pipeline defaults to rule-based memo.
