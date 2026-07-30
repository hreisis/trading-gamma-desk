import type { MacroDeskView } from "@/desk";
import { PUBLIC_DEMO_COMPACT_BANNER } from "@/desk/public-demo";

export function DeskStatusBanners({ view }: { view: MacroDeskView }) {
  const banners: { className: string; text: string; testId: string }[] = [];

  if (view.isPublicDemo && view.driver) {
    banners.push({
      className: "desk-banner desk-banner-demo desk-banner-compact",
      text: PUBLIC_DEMO_COMPACT_BANNER,
      testId: "banner-illustrative-demo",
    });
  } else if (view.isDemo && !view.isPublicDemo) {
    banners.push({
      className: "desk-banner desk-banner-demo desk-banner-compact",
      text: "Demo · fixture fallback — not a live market session. Run npm run daily for a live driver.",
      testId: "banner-demo",
    });
  }

  if (view.error?.code === "live_unavailable" || view.status === "live_unavailable") {
    banners.push({
      className: "desk-banner desk-banner-error",
      text:
        view.error?.message ?? "Live data unavailable in public demo",
      testId: "banner-live-unavailable",
    });
  }

  if (view.error?.code === "malformed") {
    banners.push({
      className: "desk-banner desk-banner-error",
      text: `Malformed live driver — not falling back to fixture. ${view.error.message}${
        view.driver
          ? " Showing the previous valid driver below."
          : " No previous valid driver available."
      }`,
      testId: "banner-malformed",
    });
  }

  if (view.error?.code === "pipeline" || view.status === "pipeline_error") {
    const stage = view.error?.stage ?? view.pipeline?.stage ?? "daily";
    banners.push({
      className: "desk-banner desk-banner-error",
      text: `Pipeline error (${stage}): ${
        view.error?.message ?? view.pipeline?.error ?? "unknown failure"
      }. Previous valid driver retained where possible.`,
      testId: "banner-pipeline",
    });
  }

  if (
    view.sessionStale &&
    view.driver &&
    view.error?.code !== "malformed" &&
    !view.isPublicDemo
  ) {
    banners.push({
      className: "desk-banner desk-banner-warn",
      text: `Stale or incomplete session · ${view.driver.marketSessionDate} · ${view.driver.sessionAlignment}${
        view.driver.isCompleteSession ? "" : " · incomplete"
      }. Not labeled “today”.`,
      testId: "banner-stale",
    });
  }

  if (
    view.source === "local_driver" &&
    !view.snapshotPresent &&
    view.driver &&
    !view.isPublicDemo
  ) {
    banners.push({
      className: "desk-banner desk-banner-warn",
      text: "Live driver present but matching compute snapshot is missing.",
      testId: "banner-snapshot-missing",
    });
  }

  return (
    <>
      {banners.map((b) => (
        <p key={b.testId} className={b.className} data-testid={b.testId}>
          {b.text}
        </p>
      ))}
    </>
  );
}
