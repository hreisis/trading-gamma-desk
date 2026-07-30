/**
 * Public portfolio demo mode (M1-11).
 *
 * When enabled, the desk serves only a synthetic DominantDriver fixture for
 * product demonstration. No cloud Tiingo, no local data/drivers, and no
 * "live driver" or "real session" labeling.
 *
 * Enable for deployed hosts:
 *   GAMMADESK_PUBLIC_DEMO=1
 *
 * Local `npm run dev` / `npm run daily` leave this unset so live behaviour
 * stays unchanged.
 */

/** Fixture date kept for schema/structure tests only — not shown as a real session. */
export const PUBLIC_DEMO_SESSION = "2026-07-29";

export const PUBLIC_DEMO_FIXTURE_PATH =
  "fixtures/macro/public-demo.2026-07-29.json";

export const PUBLIC_DEMO_BANNER = "Illustrative demo · synthetic scenario";

export const PUBLIC_DEMO_DISCLAIMER =
  "Synthetic values for product demonstration — not actual market observations.";

export const PUBLIC_DEMO_SOURCE_LABEL = PUBLIC_DEMO_BANNER;

export const LIVE_DATA_UNAVAILABLE_MESSAGE =
  "Live data unavailable in public demo";

export const GITHUB_REPO_URL =
  "https://github.com/hreisis/trading-gamma-desk";

export const SITE_TITLE =
  "GammaDesk — Macro Desk (Illustrative Demo)";

export const SITE_DESCRIPTION =
  "Portfolio demo of GammaDesk Macro Desk: a read-only cross-asset dominant-driver view over a synthetic scenario fixture. Confidence scores are uncalibrated; not live or historical market data.";

/** True when the process is configured as the public portfolio demo. */
export function isPublicDemoMode(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const raw = (env.GAMMADESK_PUBLIC_DEMO ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}
