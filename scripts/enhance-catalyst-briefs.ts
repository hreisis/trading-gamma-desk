/**
 * Local AI brief enhance (M2-3C).
 *
 *   npm run catalyst:briefs:enhance
 *   npm run catalyst:briefs:enhance -- --force
 *
 * Reads data/catalyst/briefs-latest.json only (no documents/calendar/results
 * fetch). Uses OpenAI Responses API when OPENAI_API_KEY is set; model from
 * CATALYST_LLM_MODEL (default via config helper). Writes
 * data/catalyst/ai-briefs-latest.json atomically.
 *
 * Disabled under public demo. Does not log API keys.
 */

import { enhanceOfficialBriefs } from "../src/catalyst/briefs/ai/enhance";
import { DEFAULT_AI_BRIEFS_DATA_ROOT } from "../src/catalyst/briefs/ai/paths";
import { resolveCatalystLlmModel, resolveOpenAiApiKey } from "../src/catalyst/briefs/ai/config";

async function main(): Promise<void> {
  if ((process.env.GAMMADESK_PUBLIC_DEMO ?? "").trim()) {
    console.error(
      "GAMMADESK_PUBLIC_DEMO is set — refusing AI brief enhance.",
    );
    process.exit(1);
  }

  const force = process.argv.includes("--force");
  const model = resolveCatalystLlmModel();
  const hasKey = Boolean(resolveOpenAiApiKey());

  console.log(`model:      ${model}`);
  console.log(`api key:    ${hasKey ? "present" : "missing"}`);
  console.log(`force:      ${force}`);

  const { cache, path } = await enhanceOfficialBriefs({
    dataRoot: DEFAULT_AI_BRIEFS_DATA_ROOT,
    write: true,
    force,
  });

  console.log(`provider:   ${cache.provider}`);
  console.log(`prompt:     ${cache.promptVersion}`);
  console.log(`status:     ${cache.buildStatus}`);
  console.log(`briefs:     ${cache.briefs.length}`);
  console.log(`errors:     ${cache.errors.length}`);
  console.log(`warnings:   ${cache.warnings.length}`);

  if (path) {
    console.log(`wrote:      ${path}`);
  } else {
    console.log(
      "wrote:      (skipped — unavailable/provider failure; prior cache preserved)",
    );
    if (cache.buildStatus === "unavailable" || cache.buildStatus === "failed") {
      process.exitCode = 1;
    }
  }

  for (const b of cache.briefs.slice(0, 8)) {
    console.log(
      `  - [${b.status}] ${b.inputBriefId.slice(0, 18)}… bullets=${b.bullets.length} :: ${b.headline.slice(0, 80)}`,
    );
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
