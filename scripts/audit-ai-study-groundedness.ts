/**
 * Audit AI Study groundedness vs payload.
 * Usage: npx tsx scripts/audit-ai-study-groundedness.ts
 */
import { loadAiStudyLlmConfig } from "@/ai-study/config";
import {
  buildV2AiStudyPayload,
  generateV2CommandAiStudyInterpretation,
  verifyV2AiStudyPayloadAlignsWithView,
} from "@/ai-study/v2-command-interpret";
import { loadV2HomePage } from "@/desk/load-v2-home";

async function main(): Promise<void> {
  const { view } = await loadV2HomePage({ demo: false, lang: "en" });
  const payload = buildV2AiStudyPayload(view, null);
  const alignment = verifyV2AiStudyPayloadAlignsWithView(view, payload, null);

  console.log("=== AI Study groundedness audit ===");
  console.log("sessionDate:", view.sessionDate);
  console.log("decision:", {
    stance: view.stance,
    riskScore: view.riskScore,
    exposure: view.exposure,
    opportunityScore: view.opportunityScore,
    riskChange: view.riskChange,
  });
  console.log("gamma SPY:", {
    spot: view.gamma[0].spot,
    callWall: view.gamma[0].callWall,
    putWall: view.gamma[0].putWall,
    flip: view.gamma[0].gammaFlip,
    sessionDate: view.gamma[0].sessionDate,
    freshness: view.gamma[0].freshness,
    dataLabel: view.gamma[0].dataLabel,
  });
  console.log("breadth:", {
    signal: view.spyBreadth.breadthSignal,
    stale: view.spyBreadth.stale,
    session: view.spyBreadth.marketSessionDate,
  });
  console.log("payload alignment:", alignment.ok ? "ok" : alignment);

  const aiStudy = view.aiStudy;
  console.log("\n--- Current AI Study (from loadV2HomePage) ---");
  console.log("status:", aiStudy.status, "source:", aiStudy.source);
  console.log("confidence:", aiStudy.confidence);
  console.log("dataLimitations:", aiStudy.dataLimitations);
  console.log("regime:", aiStudy.regime);
  console.log("base_case:", aiStudy.baseCase);
  console.log("if_then:", aiStudy.ifThen);
  console.log("invalidation:", aiStudy.invalidation);
  console.log("tension:", aiStudy.tension);

  if (process.env.OPENAI_API_KEY) {
    const fresh = await generateV2CommandAiStudyInterpretation({
      payload,
      config: loadAiStudyLlmConfig(process.env),
      env: process.env,
    });
    console.log("\n--- Fresh OpenAI request ---");
    console.log("status:", fresh.status);
    console.log("confidence:", fresh.confidence);
    console.log("dataLimitations:", fresh.dataLimitations);
    console.log("regime:", fresh.regime);
    console.log("base_case:", fresh.baseCase);
    console.log("if_then:", fresh.ifThen);
    console.log("invalidation:", fresh.invalidation);
    console.log("tension:", fresh.tension);
  }

  console.log("\n--- Payload dataQuality ---");
  console.log(JSON.stringify(payload.dataQuality, null, 2));

  console.log("\n--- Payload summary (trimmed) ---");
  const { dataQuality, ...rest } = payload;
  console.log(JSON.stringify(rest, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
