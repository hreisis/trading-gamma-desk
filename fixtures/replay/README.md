# Replay fixtures (M5-1A)

Point-in-time replay corpus and run outputs. Artifacts are metadata refs only —
replay never recomputes or revises historical macro / gamma / catalyst payloads.

| File | Purpose |
| --- | --- |
| `corpus.m51a.json` | Multi-time `ReplayCorpus` (macro + structure + catalyst evidence) |
| `run.m51a.json` | Deterministic `ReplayRun` over four evaluation instants |

Build via `buildReplayRun({ corpus, evaluationAts, runId })`.
