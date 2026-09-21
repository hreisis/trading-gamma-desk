# Hosting/storage options — checked 2026-09-21

The current bottleneck is Blob operations, not overall CPU or storage volume. Moving only the web host while retaining Vercel Blob will not fix it.

| Option | Cost/constraints | Project fit |
| --- | --- | --- |
| Keep Vercel, migrate Blob to Cloudflare R2 Standard | Monthly free allowance: 10 GB-month, 1 million Class A and 10 million Class B operations; overages bill separately | Smallest infrastructure change. Requires an R2 implementation of the storage client, credentials and migration of existing private artifacts. Keep cron on Vercel. |
| Railway | Hobby $5/month includes $5 resource usage; excess charged by usage. Supports scheduled jobs and persistent volumes | Candidate for full Node/Next.js migration. Explicitly configure durable storage, cache behavior and scheduled calls; filesystem must not remain ephemeral. |
| Cloudflare Workers + R2 | Workers free 100,000 requests/day but 10 ms CPU/invocation; paid starts $5/month | Requires Next.js runtime compatibility work, scheduler changes and storage adapter. Not assumed to be a drop-in or entirely free for our scoring pipeline. Current framework guide recommends vinext and documents OpenNext separately. |
| Render free | Sleeps after 15 idle minutes; ephemeral filesystem, no persistent disk on free services | Poor fit for this user's fast first-load requirement and durable daily records. |

Recommendation: first evaluate R2 storage migration without moving the website; use Railway if a complete hosting move is preferred. No account, billing, DNS or production storage migration was performed.

Sources:
- https://developers.cloudflare.com/r2/pricing/
- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/
- https://docs.railway.com/pricing/plans
- https://docs.railway.com/cron-jobs
- https://render.com/docs/free

Migration must validate private access, overwrite/create-only semantics, listing pagination, backups, old-history import, Cron authorization, and production cache behavior before cutover. Keep old data until parity is verified.
