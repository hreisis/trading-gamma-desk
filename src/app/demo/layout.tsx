import type { Metadata } from "next";
import { PUBLIC_DEMO_BANNER, SITE_DESCRIPTION_DEMO, SITE_TITLE_DEMO } from "@/desk/public-demo";

export const metadata: Metadata = {
  title: SITE_TITLE_DEMO,
  description: SITE_DESCRIPTION_DEMO,
  openGraph: {
    title: SITE_TITLE_DEMO,
    description: SITE_DESCRIPTION_DEMO,
    type: "website",
  },
};

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <p className="desk-banner desk-banner-demo desk-banner-compact" data-testid="demo-route-banner">
        {PUBLIC_DEMO_BANNER} · Synthetic fixtures only via <code>/demo</code> routes.
      </p>
      {children}
    </>
  );
}
