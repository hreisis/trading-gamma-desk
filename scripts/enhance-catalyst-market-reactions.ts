/**
 * Local AI market-reaction enhance (M2-4C).
 *
 *   npm run catalyst:market-reactions:enhance
 *   npm run catalyst:market-reactions:enhance -- --force
 *   npm run catalyst:market-reactions:enhance -- --max=2
 *
 * Reads market-context + market-reactions caches only (no network fetch of
 * calendar/docs/Alpaca). Uses OpenAI Responses API when OPENAI_API_KEY is set;
 * model from CATALYST_REACTION_LLM_MODEL (config default gpt-5.6-luna).
 * Writes data/catalyst/ai-market-reactions-latest.json atomically.
 */

import { enhanceMarketReactions } from "../src/catalyst/market-reactions/ai/enhance";
import { DEFAULT_AI_MARKET_REACTIONS_DATA_ROOT } from "../src/catalyst/market-reactions/ai/paths";
import {
  resolveCatalystReactionLlmModel,
  resolveOpenAiApiKey,
} from "../src/catalyst/market-reactions/ai/config";

async function main(): Promise<void> {
  if ((process.env.GAMMADESK_PUBLIC_DEMO ?? "").trim()) {
    console.error(
      "GAMMADESK_PUBLIC_DEMO is set — refusing AI market-reaction enhance.",
    );
    process.exit(1);
  }

  const force = process.argv.includes("--force");
  const maxArg = process.argv.find((a) => a.startsWith("--max="));
  const maxPerRun = maxArg
    ? Number(maxArg.slice("--max=".length))
    : undefined;
  const model = resolveCatalystReactionLlmModel();
  const hasKey = Boolean(resolveOpenAiApiKey());

  console.log(`model:      ${model}`);
  console.log(`api key:    ${hasKey ? "present" : "missing"}`);
  console.log(`force:      ${force}`);
  if (maxPerRun !== undefined) console.log(`maxPerRun:  ${maxPerRun}`);

  const { cache, path } = await enhanceMarketReactions({
    dataRoot: DEFAULT_AI_MARKET_REACTIONS_DATA_ROOT,
    write: true,
    force,
    maxPerRun: Number.isFinite(maxPerRun) ? maxPerRun : undefined,
  });

  console.log(`provider:   ${cache.provider}`);
  console.log(`prompt:     ${cache.promptVersion}`);
  console.log(`status:     ${cache.buildStatus}`);
  console.log(`narratives: ${cache.narratives.length}`);
  console.log(`errors:     ${cache.errors.length}`);
  console.log(`warnings:   ${cache.warnings.length}`);

  if (path) {
    console.log(`wrote:      ${path}`);
  } else {
    console.log(
      "wrote:      (skipped — unavailable/provider failure; prior cache preserved)",
    );
    if (
      cache.buildStatus === "unavailable" ||
      cache.buildStatus === "failed"
    ) {
      process.exitCode = 1;
    }
  }

  for (const n of cache.narratives.slice(0, 8)) {
    console.log(
      `  - [${n.status}] ${n.catalystId.slice(0, 18)}… bullets=${n.bullets?.length ?? 0} :: ${(n.headline ?? "").slice(0, 60)}`,
    );
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
