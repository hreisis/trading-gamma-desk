# Web-backed AI Study

## Request-triggered refresh correction
- FOMC updates wait until the 16:00 America/New_York close edition, triggered by the first subsequent page request; there is no five-minute post-release edition. A recent event from the saved study remains usable when nextEvent advances. Research must verify the release and disclose unavailable results.
- Each edition permits three atomically reserved attempts, at least 15 minutes apart. Abandoned attempts recover after the same cooldown. A subsequent page request is required; no timer starts paid research.
- The research panel and Market Consider share read-only completion checks every 60 seconds for five minutes while visible, and on window focus (also throttled to 60 seconds). The endpoint uses shared Next Data Cache with 60-second request-triggered revalidation and browser caching for 60 seconds; refreshed research may appear later than the revalidation interval. This endpoint never writes Blob or calls providers. Demo views do not poll. Old research is marked pending replacement in the study panel.
- These rules supersede the single-attempt behavior below; the original pre/post publication windows remain. No email, notifications, scoring or allocation changes.
- Two Responses API stages: hosted `web_search` (required, maximum 3 tool calls), then structured bilingual synthesis with source IDs restricted to the retrieved catalog. Each stage has a 90s timeout; no automatic retry within an edition/request version. Uses AI_STUDY_RESEARCH_MODEL (default gpt-4.1) and the existing deployment key. Retrieval uses gpt-4.1-mini; synthesis uses the configured research model. Prompts prioritize official sources and established news publishers.
- Official FOMC times are converted from the existing calendar UTC timestamp into America/New_York by code and rendered separately; model prose cannot supply clock times. Research record schema v2 invalidates the initial pilot edition.
- One bilingual fact set, compact summary plus drivers / watch / invalidation sections. Every section has clickable sources. Source URLs and titles are resolved from returned search sources or citation annotations; the synthesis model can only select catalog IDs; this is provenance validation, not proof of every claim.
- `research/web-v1/latest.json` and immutable `research/web-v1/history/<slot>-<request-version>.json` retain successful research. Attempts are reserved before paid calls and record sanitized failures. Each New York pre/post edition and request version permits one attempt, shared across language switches. Before 09:00 uses the previous post edition; 09:00–16:00 pre; thereafter post.
- Refresh is demand-triggered after the home response, not an installed clock-based scheduler. First load shows a preparation state; later page visits use the successful cached edition. A failed update preserves older research with its publication time.
- Market Consider summarizes the same cached research, while numerical Risk/exposure calculations remain independent. Daily Review retains its existing pipeline; historical research is saved for a later review integration.
- Official API reference: https://developers.openai.com/api/docs/guides/tools-web-search

## File map

- `src/ai-study/web-research-contract.ts`: bilingual record schema and publication windows.
- `src/ai-study/web-research.ts`: evidence retrieval, synthesis, provenance checks, and durable cache.
- `src/desk/load-v2-home.ts`: deferred homepage integration.
- `src/app/components/v2/WebResearchPanel.tsx`: numbered research sections and source links.
- `src/app/components/v2/MarketConsider.tsx`: shared edition summary.
- `tests/web-research.test.ts`: provenance, publication windows, cache reuse, and failed refresh coverage.
