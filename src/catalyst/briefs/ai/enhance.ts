import { writeJsonAtomic } from "@/desk/atomic-write";
import { isPublicDemoMode } from "@/desk/public-demo";
import type { OfficialAiBrief, OfficialBrief } from "@/contracts";
import { loadBriefsCache } from "../cache";
import { BRIEF_EXTRACTOR_VERSION } from "../version";
import { loadAiBriefsCache } from "./cache";
import {
  AI_BRIEF_FEED_DAYS,
  loadCatalystLlmConfig,
  type CatalystLlmRuntimeConfig,
} from "./config";
import { createOpenAiBriefNarrator } from "./openai-narrator";
import type { BriefNarrator } from "./narrator";
import { AI_BRIEF_PROMPT_VERSION, buildNarratorInputPacket } from "./prompt";
import {
  DEFAULT_AI_BRIEFS_DATA_ROOT,
  aiBriefsLatestPath,
} from "./paths";
import type {
  AiBriefBuildError,
  AiBriefInputRef,
  AiBriefUsageRecord,
  CatalystAiBriefsCache,
} from "./types";
import { unavailableAiBrief, validateAiBriefOutput, aiBriefIdFor } from "./validate";

export {
  DEFAULT_AI_BRIEFS_DATA_ROOT,
  AI_BRIEFS_LATEST_RELATIVE,
  aiBriefsLatestPath,
} from "./paths";

export interface EnhanceOfficialBriefsOptions {
  readonly now?: Date;
  readonly dataRoot?: string;
  readonly briefsDataRoot?: string;
  readonly publicDemo?: boolean;
  readonly write?: boolean;
  readonly force?: boolean;
  readonly narrator?: BriefNarrator;
  readonly config?: Partial<CatalystLlmRuntimeConfig>;
  /** Test injection. */
  readonly briefs?: readonly OfficialBrief[];
  readonly publishedAtByDocumentId?: ReadonlyMap<string, string>;
  readonly providerByDocumentId?: ReadonlyMap<string, string>;
  readonly sourceNameByDocumentId?: ReadonlyMap<string, string>;
  readonly maxPerRun?: number;
}

export interface EnhanceOfficialBriefsResult {
  readonly cache: CatalystAiBriefsCache;
  readonly path: string | null;
}

/** Shared eligibility for enhance + integration smoke (M2-5A-Lite). */
export function isEligibleOfficialBrief(
  brief: OfficialBrief,
  publishedAt: string | undefined,
  now: Date,
  days: number = AI_BRIEF_FEED_DAYS,
): boolean {
  if (brief.status === "unavailable") return false;
  if (brief.facts.length === 0) return false;
  const published = publishedAt ?? brief.generatedAt;
  const ms = Date.parse(published);
  if (!Number.isFinite(ms)) return false;
  const start = now.getTime() - days * 24 * 60 * 60 * 1000;
  return ms >= start && ms <= now.getTime();
}

async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let i = 0;
  async function worker(): Promise<void> {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]!);
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

/**
 * Enhance local deterministic briefs with evidence-grounded LLM narratives.
 * Reads briefs-latest.json only — never fetches documents/calendar/results.
 */
export async function enhanceOfficialBriefs(
  options: EnhanceOfficialBriefsOptions = {},
): Promise<EnhanceOfficialBriefsResult> {
  const publicDemo = options.publicDemo ?? isPublicDemoMode();
  if (publicDemo) {
    throw new Error(
      "AI brief enhance is disabled in public demo (GAMMADESK_PUBLIC_DEMO). " +
        "Public demo serves synthetic AI brief fixtures only.",
    );
  }

  const now = options.now ?? new Date();
  const generatedAt = now.toISOString();
  const dataRoot = options.dataRoot ?? DEFAULT_AI_BRIEFS_DATA_ROOT;
  const briefsRoot = options.briefsDataRoot ?? dataRoot;
  const runtime = loadCatalystLlmConfig(process.env, options.config ?? {});
  const narrator =
    options.narrator ?? createOpenAiBriefNarrator({ config: runtime });

  let briefs: OfficialBrief[];
  let publishedFromBriefsCache: Map<string, string> | undefined;
  if (options.briefs) {
    briefs = [...options.briefs];
  } else {
    const loaded = loadBriefsCache({ dataRoot: briefsRoot, now });
    if (!loaded.ok) {
      throw new Error(
        `Cannot enhance briefs: ${loaded.reason}: ${loaded.error}`,
      );
    }
    briefs = loaded.cache.briefs;
    publishedFromBriefsCache = new Map(
      loaded.cache.inputDocuments.map((d) => [d.documentId, d.publishedAt]),
    );
  }
  const publishedAtByDocumentId =
    options.publishedAtByDocumentId ?? publishedFromBriefsCache;

  const prior = loadAiBriefsCache({ dataRoot, now });
  const priorByInput = new Map<string, OfficialAiBrief>();
  if (prior.ok) {
    for (const b of prior.cache.briefs) {
      priorByInput.set(b.inputBriefId, b);
    }
  }

  const eligible = briefs
    .filter((b) =>
      isEligibleOfficialBrief(
        b,
        publishedAtByDocumentId?.get(b.documentId),
        now,
        AI_BRIEF_FEED_DAYS,
      ),
    )
    .slice(0, options.maxPerRun ?? runtime.maxPerRun);

  const outBriefs: OfficialAiBrief[] = prior.ok
    ? [...prior.cache.briefs.filter((b) => {
        // Keep prior briefs for inputs not in this run's eligible set
        return !eligible.some((e) => e.id === b.inputBriefId);
      })]
    : [];
  const inputRefs: AiBriefInputRef[] = prior.ok
    ? [...prior.cache.inputRefs]
    : [];
  const usage: AiBriefUsageRecord[] = prior.ok ? [...prior.cache.usage] : [];
  const errors: AiBriefBuildError[] = [];
  const warnings: string[] = [];

  if (!runtime.apiKey && !options.narrator) {
    // No key and no injected narrator → mark unavailable without wiping cache.
    const unavailableCache: CatalystAiBriefsCache = {
      kind: "CatalystAiBriefsCache",
      schemaVersion: "0.1.0",
      generatedAt,
      provider: narrator.providerId,
      model: runtime.model,
      promptVersion: AI_BRIEF_PROMPT_VERSION,
      extractorVersion: BRIEF_EXTRACTOR_VERSION,
      buildStatus: "unavailable",
      inputRefs: prior.ok ? prior.cache.inputRefs : [],
      briefs: prior.ok ? prior.cache.briefs : [],
      usage: prior.ok ? prior.cache.usage : [],
      errors: [
        {
          inputBriefId: "*",
          error: "OPENAI_API_KEY missing — AI brief unavailable",
          status: "unavailable",
        },
      ],
      warnings: [
        "OPENAI_API_KEY missing — prior AI brief cache preserved; UI falls back to rule-based briefs.",
      ],
    };
    return { cache: unavailableCache, path: null };
  }

  const results = await mapPool(
    eligible,
    runtime.maxConcurrency,
    async (brief) => {
      const expectedId = aiBriefIdFor({
        inputBriefId: brief.id,
        documentContentHash: brief.documentContentHash,
        extractorVersion: brief.extractorVersion,
        promptVersion: AI_BRIEF_PROMPT_VERSION,
        model: runtime.model,
      });
      const previous = priorByInput.get(brief.id);
      if (
        !options.force &&
        previous &&
        previous.id === expectedId &&
        previous.documentContentHash === brief.documentContentHash &&
        previous.extractorVersion === brief.extractorVersion &&
        previous.promptVersion === AI_BRIEF_PROMPT_VERSION &&
        previous.model === runtime.model &&
        (previous.status === "complete" || previous.status === "partial")
      ) {
        return { kind: "reuse" as const, brief: previous };
      }

      const packet = buildNarratorInputPacket(brief, {
        provider:
          options.providerByDocumentId?.get(brief.documentId) ?? "unknown",
        publishedAt:
          publishedAtByDocumentId?.get(brief.documentId) ?? brief.generatedAt,
        sourceName:
          options.sourceNameByDocumentId?.get(brief.documentId) ??
          "Official source",
      });

      try {
        const narrated = await narrator.narrate(packet);
        if (!narrated.ok) {
          const ai = unavailableAiBrief({
            input: brief,
            provider: narrated.provider,
            model: narrated.model,
            generatedAt,
            error: narrated.error,
          });
          return {
            kind: "done" as const,
            brief: ai,
            error: narrated.error,
            usage: undefined,
          };
        }
        const validated = validateAiBriefOutput({
          input: brief,
          output: narrated.output,
          provider: narrated.provider,
          model: narrated.model,
          generatedAt,
          synthetic: brief.synthetic,
        });
        return {
          kind: "done" as const,
          brief: validated,
          error:
            validated.status === "rejected"
              ? validated.validation.errors.join("; ")
              : undefined,
          usage: narrated.usage,
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const ai = unavailableAiBrief({
          input: brief,
          provider: narrator.providerId,
          model: runtime.model,
          generatedAt,
          error: message,
        });
        return { kind: "done" as const, brief: ai, error: message };
      }
    },
  );

  let successCount = 0;
  let failCount = 0;
  for (let i = 0; i < eligible.length; i++) {
    const brief = eligible[i]!;
    const result = results[i]!;
    const ai = result.brief;
    outBriefs.push(ai);
    inputRefs.push({
      inputBriefId: brief.id,
      documentId: brief.documentId,
      documentContentHash: brief.documentContentHash,
      extractorVersion: brief.extractorVersion,
      promptVersion: AI_BRIEF_PROMPT_VERSION,
      model: runtime.model,
      publishedAt: publishedAtByDocumentId?.get(brief.documentId),
    });
    if (result.kind === "done" && result.usage) {
      usage.push({
        inputBriefId: brief.id,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        totalTokens: result.usage.totalTokens,
      });
    }
    if (ai.status === "complete" || ai.status === "partial") {
      successCount += 1;
    } else {
      failCount += 1;
      if (result.kind === "done" && result.error) {
        errors.push({
          inputBriefId: brief.id,
          error: result.error,
          status: ai.status,
        });
      }
    }
  }

  // Dedupe by inputBriefId (latest wins)
  const byInput = new Map<string, OfficialAiBrief>();
  for (const b of outBriefs) byInput.set(b.inputBriefId, b);
  const deduped = [...byInput.values()];

  const allFailed = eligible.length > 0 && successCount === 0;
  const providerTotalFailure =
    allFailed &&
    errors.every(
      (e) =>
        /OPENAI_API_KEY missing|timed out|HTTP 5|provider failure/i.test(
          e.error,
        ),
    );

  const buildStatus: CatalystAiBriefsCache["buildStatus"] =
    eligible.length === 0
      ? prior.ok
        ? prior.cache.buildStatus
        : "ok"
      : allFailed
        ? "failed"
        : failCount > 0
          ? "partial"
          : "ok";

  const cache: CatalystAiBriefsCache = {
    kind: "CatalystAiBriefsCache",
    schemaVersion: "0.1.0",
    generatedAt,
    provider: narrator.providerId,
    model: runtime.model,
    promptVersion: AI_BRIEF_PROMPT_VERSION,
    extractorVersion: BRIEF_EXTRACTOR_VERSION,
    buildStatus,
    inputRefs: dedupeInputRefs(inputRefs),
    briefs: deduped,
    usage: usage.slice(-200),
    errors,
    warnings,
  };

  // Do not overwrite a prior good cache when the provider wholly fails.
  const shouldWrite =
    options.write !== false &&
    !(providerTotalFailure && prior.ok && prior.cache.briefs.length > 0);

  let path: string | null = null;
  if (shouldWrite) {
    path = aiBriefsLatestPath(dataRoot);
    writeJsonAtomic(path, cache);
  } else if (providerTotalFailure) {
    warnings.push(
      "Provider-wide failure — prior AI brief cache left untouched.",
    );
  }

  return { cache, path };
}

function dedupeInputRefs(refs: readonly AiBriefInputRef[]): AiBriefInputRef[] {
  const map = new Map<string, AiBriefInputRef>();
  for (const r of refs) map.set(r.inputBriefId, r);
  return [...map.values()];
}
