import { MarketDetailPreview } from "@/app/components/v2/MarketDetailPreview";
import { RiskSnapshotScores } from "@/app/components/v2/RiskSnapshotScores";
import { loadV2MarketPage } from "@/desk/load-v2-market";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function MarketPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string; gamma?: string; lang?: string }>;
}) {
  const params = await searchParams;
  const { view, lang, manualGammaSnapshot } = await loadV2MarketPage({
    demo: false,
    source: params.source,
    forceFixture: params.gamma === "fixture",
    lang: params.lang,
  });

  return (
    <>
      <MarketDetailPreview
        view={view}
        lang={lang}
        manualGammaSnapshot={manualGammaSnapshot}
      />
      <RiskSnapshotScores
        spyScore={view.spyStructuralRiskScore}
        qqqScore={view.qqqStructuralRiskScore}
      />
    </>
  );
}
