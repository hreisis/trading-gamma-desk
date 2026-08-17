import { MarketDetailPreview } from "@/app/components/v2/MarketDetailPreview";
import { loadV2HomePage } from "@/desk/load-v2-home";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function MarketPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string; gamma?: string; lang?: string }>;
}) {
  const params = await searchParams;
  const { view, lang } = await loadV2HomePage({
    demo: false,
    source: params.source,
    forceFixture: params.gamma === "fixture",
    lang: params.lang,
  });

  return <MarketDetailPreview view={view} lang={lang} />;
}
