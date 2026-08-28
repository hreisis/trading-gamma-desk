import { MarketDetailPreview } from "@/app/components/v2/MarketDetailPreview";
import { RiskSnapshotScores } from "@/app/components/v2/RiskSnapshotScores";
import { loadV2MarketPage } from "@/desk/load-v2-market";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function MarketPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string; gamma?: string }>;
}) {
  const params = await searchParams;
  const { view, manualGammaSnapshot, opportunityScoreV2, riskTrend, positioning } =
    await loadV2MarketPage({
      demo: false,
      source: params.source,
      forceFixture: params.gamma === "fixture",
    });

  return (
    <>
      <MarketDetailPreview
        view={view}
        manualGammaSnapshot={manualGammaSnapshot}
        opportunityScoreV2={opportunityScoreV2}
        riskTrend={riskTrend}
        positioning={positioning}
      />
      <RiskSnapshotScores
        spyScore={view.spyStructuralRiskScore}
        qqqScore={view.qqqStructuralRiskScore}
      />
    </>
  );
}
