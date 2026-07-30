/**
 * One-shot generator for checked-in synthetic AI market-reaction fixtures.
 * Uses the fake narrator + local validator (same contract as enhance).
 */
import { writeFileSync } from "node:fs";
import { loadCatalystFeed } from "../src/catalyst/load";
import {
  buildReactionNarratorPacket,
  marketReactionIdentity,
} from "../src/catalyst/market-reactions/ai/evidence";
import { createFakeMarketReactionNarrator } from "../src/catalyst/market-reactions/ai/fake-narrator";
import { validateAiMarketReactionOutput } from "../src/catalyst/market-reactions/ai/validate";
import { marketContextIdentity } from "../src/catalyst/market-reactions/classify";
import { AiMarketReactionNarrative } from "../src/contracts/ai-market-reaction";

async function main(): Promise<void> {
  const feed = loadCatalystFeed(
    {},
    { forceSynthetic: true, now: new Date("2026-07-29T20:00:00.000Z") },
  );
  const narrator = createFakeMarketReactionNarrator("ok", "synthetic");
  const narratives = [];
  for (const reaction of feed.marketReactions ?? []) {
    const ctx = (feed.marketContext ?? []).find(
      (c) => c.id === reaction.marketContextId,
    );
    if (!ctx) continue;
    const ctxId = marketContextIdentity(ctx);
    const rxnId = marketReactionIdentity(reaction);
    const packet = buildReactionNarratorPacket(ctx, reaction, ctxId, rxnId);
    const narrated = await narrator.narrate(packet);
    if (!narrated.ok) continue;
    const validated = validateAiMarketReactionOutput({
      context: ctx,
      reaction,
      evidence: packet.evidence,
      marketContextIdentity: ctxId,
      marketReactionIdentity: rxnId,
      output: narrated.output,
      provider: "synthetic_fixture",
      model: "synthetic",
      generatedAt: "2026-07-29T18:00:00.000Z",
      synthetic: true,
      usage: narrated.usage,
    });
    // Force synthetic provider label after validation
    const fixture = AiMarketReactionNarrative.parse({
      ...validated,
      provider: "synthetic_fixture",
      model: "synthetic",
      synthetic: true,
    });
    if (fixture.status === "complete" || fixture.status === "partial") {
      narratives.push(fixture);
    }
  }

  writeFileSync(
    "fixtures/catalyst/synthetic-ai-market-reactions.json",
    JSON.stringify(
      {
        kind: "CatalystSyntheticAiMarketReactionFixtureBatch",
        schemaVersion: "0.1.0",
        disclaimer:
          "Synthetic AI market-reaction fixtures for public demo — generated from synthetic 4A/4B evidence via the same prompt contract + fake narrator. Not live LLM output. Observed movement does not establish causation.",
        promptVersion: "0.1.0",
        narratives,
      },
      null,
      2,
    ) + "\n",
  );
  console.log("wrote", narratives.length, "narratives");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
