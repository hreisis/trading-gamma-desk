# R2 storage and daily capture

Set server-only R2_ENDPOINT (S3 endpoint), R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY in Vercel Production. Use a private Standard bucket and bucket-scoped Object Read & Write credentials. Do not use NEXT_PUBLIC names. Complete R2 configuration selects R2 for desk/ and breadth/; incomplete configuration fails closed. Keep the Blob token temporarily as the migration source. Removing all R2 settings restores the legacy selection, but new R2 records are not reverse-synced to Blob.

Daily capture requires CRON_SECRET and working provider credentials. Primary capture is 23:30 UTC weekdays; retry 01:30 UTC Tuesday–Saturday, still the same Eastern session. Regular winter/summer close and holidays are guarded by the US session calendar. Vercel scheduler delivery may vary; this is a post-close observation, not a precise closing tick. Source timestamps/coverage remain attached. Errors return 503, and missing data is not fabricated. Capture does not start optional AI research.

Migration endpoint `/api/cron/storage-migrate` uses existing Cron bearer auth. Runs daily at 21:10 UTC, at most 100 objects and a soft 120-second processing budget. It copies desk/ and breadth/ JSON into legacy-vercel/, verifies exact content, then seeds absent primary keys using create-only writes. Existing primary keys are preserved. The manifest migration/vercel-blob-v1.json tracks progress and source failures; completed migrations no longer scan Blob. Suspended Blob will delay old history recovery but does not block fresh R2 scoring. There is no unauthenticated migration or credential export endpoint.

Runtime read/write checks: public `/api/scores/history` returns X-Storage-Backend: r2 after successful reads. Confirm write success using Vercel Cron logs (`recorded`) and the object desk/scores/daily-v1.json in R2 after the first scheduled capture. HTTP 200 alone with empty points confirms connectivity, not historical migration or successful daily collection.

Sources: https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/ and https://developers.cloudflare.com/r2/api/s3/api/
