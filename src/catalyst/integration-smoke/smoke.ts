import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeJsonAtomic } from "@/desk/atomic-write";
import { isPublicDemoMode } from "@/desk/public-demo";
import {
  CatalystIntegrationSmokeReport,
  type IntegrationSmokeStageReport,
  type IntegrationSmokeStageStatus,
} from "@/contracts";
import {
  enhanceOfficialBriefs,
  isEligibleOfficialBrief,
} from "../briefs/ai/enhance";
import { loadBriefsCache } from "../briefs/cache";
import {
  loadCatalystLlmConfig,
  resolveCatalystLlmModel,
  resolveOpenAiApiKey,
} from "../briefs/ai/config";
import { aiBriefsLatestPath } from "../briefs/ai/paths";
import type { BriefNarrator } from "../briefs/ai/narrator";
import { createOpenAiBriefNarrator } from "../briefs/ai/openai-narrator";
import { loadMarketContextCache } from "../market-context/cache";
import {
  resolveAlpacaCredentials,
  resolveCatalystMarketFeed,
} from "../market-context/config";
import { loadMarketReactionsCache } from "../market-reactions/cache";
import {
  enhanceMarketReactions,
  isEligibleReactionPair,
} from "../market-reactions/ai/enhance";
import {
  loadCatalystReactionLlmConfig,
  resolveCatalystReactionLlmModel,
} from "../market-reactions/ai/config";
import { aiMarketReactionsLatestPath } from "../market-reactions/ai/paths";
import type { MarketReactionNarrator } from "../market-reactions/ai/narrator";
import { createOpenAiMarketReactionNarrator } from "../market-reactions/ai/openai-narrator";
import { classifyAlpacaCredentialState, classifySmokeError } from "./errors";
import {
  DEFAULT_INTEGRATION_SMOKE_DATA_ROOT,
  integrationSmokeReportPath,
} from "./paths";
import { redactSecrets } from "./redaction";

export const INTEGRATION_SMOKE_DEFAULT_MAX_EVENTS = 2;

export interface IntegrationSmokeCliOptions {
  readonly live?: boolean;
  readonly dryRun?: boolean;
  readonly maxEvents?: number;
  readonly updateCache?: boolean;
  readonly dataRoot?: string;
  readonly now?: Date;
  readonly publicDemo?: boolean;
  readonly env?: Record<string, string | undefined>;
  /** Test injection — when set, live stages use these instead of OpenAI. */
  readonly officialNarrator?: BriefNarrator;
  readonly reactionNarrator?: MarketReactionNarrator;
  /** Test hook: record whether a provider narrate() was invoked. */
  readonly onProviderCall?: (stage: string) => void;
  readonly writeReport?: boolean;
}

export interface IntegrationSmokeResult {
  readonly report: CatalystIntegrationSmokeReport;
  readonly reportPath: string | null;
  readonly exitCode: number;
  readonly summaryLines: string[];
}

function stageBase(
  stage: string,
  partial: Partial<IntegrationSmokeStageReport> & {
    status: IntegrationSmokeStageStatus;
  },
): IntegrationSmokeStageReport {
  return {
    stage,
    attemptedCount: 0,
    validatedCount: 0,
    rejectedCount: 0,
    cachePreserved: true,
    errorCodes: [],
    ...partial,
  };
}

function overallFromStages(
  stages: readonly IntegrationSmokeStageReport[],
  live: boolean,
): CatalystIntegrationSmokeReport["overallStatus"] {
  if (stages.some((s) => s.stage === "cache_integrity" && s.status === "failed")) {
    return "failed";
  }
  if (stages.some((s) => s.stage === "preflight" && s.status === "failed")) {
    return "failed";
  }

  const openaiStages = stages.filter(
    (s) =>
      s.stage === "openai_official_brief" ||
      s.stage === "openai_market_reaction",
  );
  const anyOpenaiPassed = openaiStages.some((s) => s.status === "passed");
  const anyOpenaiFailed = openaiStages.some((s) => s.status === "failed");
  const alpaca = stages.find((s) => s.stage === "alpaca_market_context");
  const alpacaAwaiting =
    alpaca?.status === "awaiting_credentials" ||
    alpaca?.status === "awaiting_valid_credentials" ||
    alpaca?.status === "awaiting_live_smoke";

  if (!live) {
    // Dry-run / plan-only never claims full provider pass.
    if (anyOpenaiFailed) return "failed";
    return "unavailable";
  }

  if (anyOpenaiFailed) return "failed";

  const executablePassed =
    openaiStages.length > 0 &&
    openaiStages.every(
      (s) =>
        s.status === "passed" ||
        s.status === "skipped_no_eligible_input" ||
        s.status === "skipped_dependency_unavailable" ||
        s.status === "unavailable",
    );

  if (anyOpenaiPassed && alpacaAwaiting) return "partial";
  if (
    anyOpenaiPassed &&
    openaiStages.every(
      (s) =>
        s.status === "passed" ||
        s.status === "skipped_no_eligible_input" ||
        s.status === "skipped_dependency_unavailable",
    ) &&
    alpaca?.status === "passed"
  ) {
    return "passed";
  }
  if (anyOpenaiPassed) return "partial";
  if (!anyOpenaiPassed && executablePassed) return "unavailable";
  return "unavailable";
}

/**
 * Exit 0 only when every requested live stage that could run actually passed,
 * and there were no failures. Alpaca awaiting_credentials → non-zero (partial).
 */
export function exitCodeForReport(
  report: CatalystIntegrationSmokeReport,
): number {
  if (report.overallStatus === "passed") return 0;
  if (report.mode === "dry-run" && report.overallStatus !== "failed") {
    // Plan-only success for tooling; still non-zero so CI does not treat as live pass.
    return 2;
  }
  if (report.overallStatus === "partial") return 3;
  if (report.overallStatus === "unavailable") return 4;
  return 1;
}

function wrapNarrator<T extends BriefNarrator | MarketReactionNarrator>(
  inner: T,
  stage: string,
  onCall?: (stage: string) => void,
): T {
  return {
    ...inner,
    providerId: inner.providerId,
    async narrate(packet: never) {
      onCall?.(stage);
      return inner.narrate(packet);
    },
  } as T;
}

/**
 * M2-5A-Lite integration smoke — validates existing adapters; not a pipeline.
 */
export async function runCatalystIntegrationSmoke(
  options: IntegrationSmokeCliOptions = {},
): Promise<IntegrationSmokeResult> {
  const env: Record<string, string | undefined> = options.env ?? process.env;
  const publicDemo = options.publicDemo ?? isPublicDemoMode(env);
  const dryRun = Boolean(options.dryRun) || !options.live;
  const live = Boolean(options.live) && !dryRun;
  const maxEvents = Math.max(
    1,
    Math.min(
      options.maxEvents ?? INTEGRATION_SMOKE_DEFAULT_MAX_EVENTS,
      INTEGRATION_SMOKE_DEFAULT_MAX_EVENTS,
    ),
  );
  const updateCache = Boolean(options.updateCache) && live && !dryRun;
  const dataRoot = options.dataRoot ?? DEFAULT_INTEGRATION_SMOKE_DATA_ROOT;
  const now = options.now ?? new Date();
  const startedAt = now.toISOString();
  const runId = `ismoke_${randomUUID().slice(0, 12)}`;
  const stages: IntegrationSmokeStageReport[] = [];
  const notes: string[] = [];
  let isolatedRoot: string | null = null;
  let providerCalls = 0;

  const onCall = (stage: string) => {
    providerCalls += 1;
    options.onProviderCall?.(stage);
  };

  try {
    if (publicDemo) {
      const report = CatalystIntegrationSmokeReport.parse({
        schemaVersion: "0.1.0",
        kind: "CatalystIntegrationSmokeReport",
        runId,
        mode: dryRun ? "dry-run" : "live",
        startedAt,
        completedAt: new Date().toISOString(),
        overallStatus: "failed",
        maxEvents,
        liveOptIn: live,
        updateCache: false,
        notes: [
          "Integration smoke blocked in public demo (GAMMADESK_PUBLIC_DEMO).",
        ],
        stages: [
          stageBase("preflight", {
            status: "failed",
            errorCodes: ["public_demo_blocked"],
            cachePreserved: true,
          }),
        ],
      });
      return finalize(report, dataRoot, options.writeReport !== false, null);
    }

    // --- 1. Preflight ---
    const preStart = new Date().toISOString();
  const openaiKey = resolveOpenAiApiKey(env as NodeJS.ProcessEnv);
  const officialModel = resolveCatalystLlmModel(env as NodeJS.ProcessEnv);
  const reactionModel = resolveCatalystReactionLlmModel(
    env as NodeJS.ProcessEnv,
  );
  const alpacaCreds = resolveAlpacaCredentials(env as NodeJS.ProcessEnv);
  const feed = resolveCatalystMarketFeed(env as NodeJS.ProcessEnv);
    const briefsLoaded = loadBriefsCache({ dataRoot, now });
    const mctxLoaded = loadMarketContextCache({ dataRoot, now });
    const mrxnLoaded = loadMarketReactionsCache({ dataRoot, now });

    let eligibleBriefs = 0;
    if (briefsLoaded.ok) {
      const published = new Map(
        briefsLoaded.cache.inputDocuments.map((d) => [
          d.documentId,
          d.publishedAt,
        ]),
      );
      eligibleBriefs = briefsLoaded.cache.briefs.filter((b) =>
        isEligibleOfficialBrief(b, published.get(b.documentId), now),
      ).length;
    }

    let eligiblePairs = 0;
    let reactionDependencyMissing = false;
    if (!mctxLoaded.ok || !mrxnLoaded.ok) {
      reactionDependencyMissing = true;
    } else {
      const ctxById = new Map(
        mctxLoaded.cache.snapshots.map((c) => [c.id, c]),
      );
      eligiblePairs = mrxnLoaded.cache.reactions.filter((r) => {
        const ctx = ctxById.get(r.marketContextId);
        return ctx ? isEligibleReactionPair(ctx, r, now) : false;
      }).length;
    }

    const preErrors: string[] = [];
    if (!live) {
      preErrors.push("live_opt_in_required");
      notes.push(
        "No --live flag: plan-only. Zero OpenAI/Alpaca calls. Not a full provider pass.",
      );
    }
    if (!openaiKey && live) {
      preErrors.push("missing_credentials");
      notes.push("OPENAI_API_KEY missing — OpenAI live stages unavailable.");
    }

    stages.push(
      stageBase("preflight", {
        status:
          publicDemo
            ? "failed"
            : live && !openaiKey
              ? "unavailable"
              : "passed",
        provider: "local",
        model: officialModel,
        attemptedCount: 0,
        validatedCount: 1,
        rejectedCount: 0,
        cachePreserved: true,
        errorCodes: preErrors,
        startedAt: preStart,
        completedAt: new Date().toISOString(),
      }),
    );
    notes.push(
      `Official model (CATALYST_LLM_MODEL): ${officialModel}; reaction model (CATALYST_REACTION_LLM_MODEL): ${reactionModel}.`,
    );
    notes.push(
      `Eligible official briefs: ${eligibleBriefs}; eligible 4A/4B pairs: ${eligiblePairs}.`,
    );
    notes.push(
      `Alpaca credentials: ${alpacaCreds ? "present" : "absent"}; feed: ${feed}.`,
    );

    // --- 2. Alpaca ---
    const alpacaStart = new Date().toISOString();
    const keyIdPresent = Boolean((env.APCA_API_KEY_ID ?? "").trim());
    const secretPresent = Boolean((env.APCA_API_SECRET_KEY ?? "").trim());
    const alpacaCredState = classifyAlpacaCredentialState({
      keyIdPresent,
      secretPresent,
    });
    if (alpacaCredState.status === "awaiting_valid_credentials") {
      stages.push(
        stageBase("alpaca_market_context", {
          status: "awaiting_valid_credentials",
          provider: "alpaca",
          feed,
          cachePreserved: true,
          errorCodes: ["awaiting_valid_credentials"],
          startedAt: alpacaStart,
          completedAt: new Date().toISOString(),
        }),
      );
      notes.push(
        "alpaca_market_context = awaiting_valid_credentials — no Alpaca call; no empty 4A cache written.",
      );
      if (mctxLoaded.ok) {
        notes.push(
          "Local 4A cache present — schema integrity checked later; not a live Alpaca result.",
        );
      }
    } else if (!live) {
      stages.push(
        stageBase("alpaca_market_context", {
          status: "awaiting_live_smoke",
          provider: "alpaca",
          feed,
          errorCodes: ["awaiting_live_smoke", "live_opt_in_required"],
          cachePreserved: true,
          startedAt: alpacaStart,
          completedAt: new Date().toISOString(),
        }),
      );
      notes.push(
        "Alpaca credential shape present but --live not set / smoke deferred — awaiting_live_smoke; zero Alpaca HTTP.",
      );
    } else {
      // Both key parts present but M2-5A-Lite does not run live Alpaca fetch
      // until credentials are validated end-to-end.
      stages.push(
        stageBase("alpaca_market_context", {
          status: "awaiting_live_smoke",
          provider: "alpaca",
          feed,
          errorCodes: ["awaiting_live_smoke"],
          cachePreserved: true,
          startedAt: alpacaStart,
          completedAt: new Date().toISOString(),
        }),
      );
      notes.push(
        "Alpaca live fetch deferred (awaiting_live_smoke). Zero Alpaca HTTP calls this run.",
      );
    }
    void alpacaCreds;

    // Isolated output root for live AI stages
    if (live && openaiKey) {
      isolatedRoot = mkdtempSync(join(tmpdir(), "gammadesk-ismoke-"));
    }

    // --- 3. OpenAI official brief ---
    const briefStart = new Date().toISOString();
    if (!live) {
      stages.push(
        stageBase("openai_official_brief", {
          status:
            eligibleBriefs > 0
              ? "skipped_dependency_unavailable"
              : "skipped_no_eligible_input",
          provider: "openai",
          model: officialModel,
          attemptedCount: Math.min(eligibleBriefs, maxEvents),
          errorCodes: ["live_opt_in_required"],
          cachePreserved: true,
          startedAt: briefStart,
          completedAt: new Date().toISOString(),
        }),
      );
    } else if (!openaiKey) {
      stages.push(
        stageBase("openai_official_brief", {
          status: "unavailable",
          provider: "openai",
          model: officialModel,
          errorCodes: ["missing_credentials"],
          cachePreserved: true,
          startedAt: briefStart,
          completedAt: new Date().toISOString(),
        }),
      );
    } else if (!briefsLoaded.ok || eligibleBriefs === 0) {
      stages.push(
        stageBase("openai_official_brief", {
          status: "skipped_no_eligible_input",
          provider: "openai",
          model: officialModel,
          errorCodes: briefsLoaded.ok
            ? ["no_eligible_input"]
            : ["dependency_unavailable"],
          cachePreserved: true,
          startedAt: briefStart,
          completedAt: new Date().toISOString(),
        }),
      );
    } else {
      const priorAiPath = aiBriefsLatestPath(dataRoot);
      const priorExisted = existsSync(priorAiPath);
      const priorHash = priorExisted
        ? createHash("sha256")
            .update(readFileSync(priorAiPath))
            .digest("hex")
        : null;

      const runtime = loadCatalystLlmConfig(env as NodeJS.ProcessEnv, {
        apiKey: openaiKey,
        model: officialModel,
        maxPerRun: maxEvents,
      });
      const baseNarrator =
        options.officialNarrator ??
        createOpenAiBriefNarrator({ config: runtime });
      const narrator = wrapNarrator(
        baseNarrator,
        "openai_official_brief",
        onCall,
      );

      try {
        const result = await enhanceOfficialBriefs({
          dataRoot: isolatedRoot!,
          briefsDataRoot: dataRoot,
          now,
          write: true,
          force: true,
          maxPerRun: maxEvents,
          narrator,
          config: runtime,
          publicDemo: false,
        });
        const validated = result.cache.briefs.filter(
          (b) =>
            (b.status === "complete" || b.status === "partial") &&
            b.validation.errors.length === 0,
        ).length;
        const rejected = result.cache.briefs.filter(
          (b) => b.status === "rejected" || b.status === "unavailable",
        ).length;
        const attempted = Math.min(eligibleBriefs, maxEvents);
        const liveCallsHappened = providerCalls > 0;
        const passed =
          liveCallsHappened &&
          validated > 0 &&
          rejected === 0 &&
          result.cache.buildStatus !== "failed" &&
          result.cache.buildStatus !== "unavailable";

        const codes: string[] = [];
        if (!liveCallsHappened) codes.push("unknown_error");
        for (const e of result.cache.errors) {
          codes.push(classifySmokeError(e.error));
        }
        if (!passed && validated === 0 && rejected === 0) {
          codes.push("no_eligible_input");
        }

        stages.push(
          stageBase("openai_official_brief", {
            status: passed
              ? "passed"
              : rejected > 0
                ? "failed"
                : result.cache.buildStatus === "unavailable"
                  ? "unavailable"
                  : "failed",
            provider: "openai",
            model: officialModel,
            attemptedCount: attempted,
            validatedCount: validated,
            rejectedCount: rejected,
            cachePreserved: true,
            errorCodes: [...new Set(codes)],
            startedAt: briefStart,
            completedAt: new Date().toISOString(),
          }),
        );

        if (updateCache && passed && result.path) {
          writeJsonAtomic(aiBriefsLatestPath(dataRoot), result.cache);
          notes.push("Updated production ai-briefs cache after validated smoke.");
        }

        if (priorExisted && priorHash) {
          const after = existsSync(priorAiPath)
            ? createHash("sha256")
                .update(readFileSync(priorAiPath))
                .digest("hex")
            : null;
          if (!updateCache && after !== priorHash) {
            notes.push(
              "WARNING: production AI brief cache changed unexpectedly during smoke.",
            );
          }
        }
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : String(error);
        stages.push(
          stageBase("openai_official_brief", {
            status: "failed",
            provider: "openai",
            model: officialModel,
            attemptedCount: Math.min(eligibleBriefs, maxEvents),
            cachePreserved: true,
            errorCodes: [classifySmokeError(message)],
            startedAt: briefStart,
            completedAt: new Date().toISOString(),
          }),
        );
      }
    }

    // --- 4. OpenAI market reaction ---
    const rxnStart = new Date().toISOString();
    const callsBeforeRxn = providerCalls;
    if (!live) {
      stages.push(
        stageBase("openai_market_reaction", {
          status: reactionDependencyMissing
            ? "skipped_dependency_unavailable"
            : eligiblePairs > 0
              ? "skipped_dependency_unavailable"
              : "skipped_no_eligible_input",
          provider: "openai",
          model: reactionModel,
          attemptedCount: Math.min(eligiblePairs, maxEvents),
          errorCodes: reactionDependencyMissing
            ? ["dependency_unavailable"]
            : ["live_opt_in_required"],
          cachePreserved: true,
          startedAt: rxnStart,
          completedAt: new Date().toISOString(),
        }),
      );
    } else if (!openaiKey) {
      stages.push(
        stageBase("openai_market_reaction", {
          status: "unavailable",
          provider: "openai",
          model: reactionModel,
          errorCodes: ["missing_credentials"],
          cachePreserved: true,
          startedAt: rxnStart,
          completedAt: new Date().toISOString(),
        }),
      );
    } else if (reactionDependencyMissing) {
      stages.push(
        stageBase("openai_market_reaction", {
          status: "skipped_dependency_unavailable",
          provider: "openai",
          model: reactionModel,
          errorCodes: ["dependency_unavailable"],
          cachePreserved: true,
          startedAt: rxnStart,
          completedAt: new Date().toISOString(),
        }),
      );
      notes.push(
        "OpenAI reaction smoke skipped — missing identity-consistent 4A/4B live caches (not filled with synthetic).",
      );
    } else if (eligiblePairs === 0) {
      stages.push(
        stageBase("openai_market_reaction", {
          status: "skipped_no_eligible_input",
          provider: "openai",
          model: reactionModel,
          errorCodes: ["no_eligible_input"],
          cachePreserved: true,
          startedAt: rxnStart,
          completedAt: new Date().toISOString(),
        }),
      );
    } else {
      const priorPath = aiMarketReactionsLatestPath(dataRoot);
      const priorExisted = existsSync(priorPath);
      const runtime = loadCatalystReactionLlmConfig(env as NodeJS.ProcessEnv, {
        apiKey: openaiKey,
        model: reactionModel,
        maxPerRun: maxEvents,
      });
      const baseNarrator =
        options.reactionNarrator ??
        createOpenAiMarketReactionNarrator({ config: runtime });
      const narrator = wrapNarrator(
        baseNarrator,
        "openai_market_reaction",
        onCall,
      );
      try {
        const result = await enhanceMarketReactions({
          dataRoot: isolatedRoot!,
          marketContextDataRoot: dataRoot,
          marketReactionsDataRoot: dataRoot,
          now,
          write: true,
          force: true,
          maxPerRun: maxEvents,
          narrator,
          config: runtime,
          publicDemo: false,
        });
        const validated = result.cache.narratives.filter(
          (n) =>
            (n.status === "complete" || n.status === "partial") &&
            n.validationErrors.length === 0,
        ).length;
        const rejected = result.cache.narratives.filter(
          (n) => n.status === "rejected" || n.status === "unavailable",
        ).length;
        const attempted = Math.min(eligiblePairs, maxEvents);
        const liveCallsHappened = providerCalls > callsBeforeRxn;
        const passed =
          liveCallsHappened &&
          validated > 0 &&
          rejected === 0 &&
          result.cache.buildStatus !== "failed" &&
          result.cache.buildStatus !== "unavailable";
        const codes: string[] = [];
        if (!liveCallsHappened) codes.push("unknown_error");
        for (const e of result.cache.errors) {
          codes.push(classifySmokeError(e.error));
        }
        stages.push(
          stageBase("openai_market_reaction", {
            status: passed
              ? "passed"
              : rejected > 0
                ? "failed"
                : result.cache.buildStatus === "unavailable"
                  ? "unavailable"
                  : "failed",
            provider: "openai",
            model: reactionModel,
            attemptedCount: attempted,
            validatedCount: validated,
            rejectedCount: rejected,
            cachePreserved: true,
            errorCodes: [...new Set(codes)],
            startedAt: rxnStart,
            completedAt: new Date().toISOString(),
          }),
        );
        if (updateCache && passed && result.path) {
          writeJsonAtomic(aiMarketReactionsLatestPath(dataRoot), result.cache);
          notes.push(
            "Updated production ai-market-reactions cache after validated smoke.",
          );
        }
        void priorExisted;
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : String(error);
        stages.push(
          stageBase("openai_market_reaction", {
            status: "failed",
            provider: "openai",
            model: reactionModel,
            attemptedCount: Math.min(eligiblePairs, maxEvents),
            cachePreserved: true,
            errorCodes: [classifySmokeError(message)],
            startedAt: rxnStart,
            completedAt: new Date().toISOString(),
          }),
        );
      }
    }

    // --- 5. Cache integrity ---
    const integStart = new Date().toISOString();
    const integCodes: string[] = [];
    try {
      if (briefsLoaded.ok) {
        // already parsed
      } else if (briefsLoaded.reason === "malformed") {
        integCodes.push("cache_integrity_failed");
      }
      if (mctxLoaded.ok) {
        // local 4A integrity only — not live Alpaca
      } else if (mctxLoaded.reason === "malformed") {
        integCodes.push("cache_integrity_failed");
      }
      if (mrxnLoaded.ok) {
        // ok
      } else if (mrxnLoaded.reason === "malformed") {
        integCodes.push("cache_integrity_failed");
      }
      stages.push(
        stageBase("cache_integrity", {
          status: integCodes.length ? "failed" : "passed",
          provider: "local",
          attemptedCount: 1,
          validatedCount: integCodes.length ? 0 : 1,
          rejectedCount: integCodes.length ? 1 : 0,
          cachePreserved: true,
          errorCodes: integCodes,
          startedAt: integStart,
          completedAt: new Date().toISOString(),
        }),
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      stages.push(
        stageBase("cache_integrity", {
          status: "failed",
          errorCodes: [classifySmokeError(message)],
          cachePreserved: true,
          startedAt: integStart,
          completedAt: new Date().toISOString(),
        }),
      );
    }

    notes.push(
      "Full M2-5A: partial until Alpaca live smoke succeeds (awaiting_valid_credentials / awaiting_live_smoke).",
    );
    notes.push(`Provider narrate() calls this run: ${providerCalls}.`);

    const overall = overallFromStages(stages, live);
    const report = CatalystIntegrationSmokeReport.parse({
      schemaVersion: "0.1.0",
      kind: "CatalystIntegrationSmokeReport",
      runId,
      mode: live ? "live" : "dry-run",
      startedAt,
      completedAt: new Date().toISOString(),
      overallStatus: overall,
      maxEvents,
      liveOptIn: live,
      updateCache,
      notes: notes.map(redactSecrets),
      stages,
    });
    return finalize(report, dataRoot, options.writeReport !== false, isolatedRoot);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const report = CatalystIntegrationSmokeReport.parse({
      schemaVersion: "0.1.0",
      kind: "CatalystIntegrationSmokeReport",
      runId,
      mode: live ? "live" : "dry-run",
      startedAt,
      completedAt: new Date().toISOString(),
      overallStatus: "failed",
      maxEvents,
      liveOptIn: live,
      updateCache: false,
      notes: [redactSecrets(`Runner failure: ${message}`)],
      stages: [
        ...stages,
        stageBase("runner", {
          status: "failed",
          errorCodes: [classifySmokeError(message)],
          cachePreserved: true,
        }),
      ],
    });
    return finalize(report, dataRoot, options.writeReport !== false, isolatedRoot);
  }
}

function finalize(
  report: CatalystIntegrationSmokeReport,
  dataRoot: string,
  writeReport: boolean,
  isolatedRoot: string | null,
): IntegrationSmokeResult {
  let reportPath: string | null = null;
  if (writeReport) {
    reportPath = integrationSmokeReportPath(dataRoot);
    writeJsonAtomic(reportPath, report);
  }
  if (isolatedRoot && existsSync(isolatedRoot)) {
    try {
      rmSync(isolatedRoot, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
  const summaryLines = formatSummary(report);
  return {
    report,
    reportPath,
    exitCode: exitCodeForReport(report),
    summaryLines,
  };
}

export function formatSummary(report: CatalystIntegrationSmokeReport): string[] {
  const label: Record<string, string> = {
    preflight: "Preflight",
    alpaca_market_context: "Alpaca market context",
    openai_official_brief: "OpenAI official brief",
    openai_market_reaction: "OpenAI reaction brief",
    cache_integrity: "Cache integrity",
    runner: "Runner",
  };
  const lines: string[] = [];
  for (const s of report.stages) {
    const name = (label[s.stage] ?? s.stage).padEnd(26);
    let detail: string = s.status;
    if (s.validatedCount > 0 || s.attemptedCount > 0) {
      if (s.status === "passed") {
        detail = `${s.status} (${s.validatedCount} events)`;
      } else if (
        s.attemptedCount > 0 &&
        s.status !== "awaiting_credentials" &&
        s.status !== "awaiting_valid_credentials" &&
        s.status !== "awaiting_live_smoke"
      ) {
        detail = `${s.status} (attempted ${s.attemptedCount})`;
      }
    }
    lines.push(`${name}${detail}`);
  }
  lines.push(`${"Overall".padEnd(26)}${report.overallStatus}`);
  if (report.mode === "dry-run") {
    lines.push("Note                      dry-run / no --live — zero provider calls");
  }
  if (
    report.stages.some(
      (s) =>
        s.stage === "alpaca_market_context" &&
        (s.status === "awaiting_credentials" ||
          s.status === "awaiting_valid_credentials" ||
          s.status === "awaiting_live_smoke"),
    )
  ) {
    lines.push(
      "Note                      Alpaca awaiting_valid_credentials / awaiting_live_smoke",
    );
  }
  return lines.map(redactSecrets);
}

export function parseIntegrationSmokeArgs(
  argv: readonly string[],
): IntegrationSmokeCliOptions {
  const live = argv.includes("--live");
  const dryRun = argv.includes("--dry-run");
  const updateCache = argv.includes("--update-cache");
  const maxArg = argv.find(
    (a) => a === "--max-events" || a.startsWith("--max-events="),
  );
  let maxEvents = INTEGRATION_SMOKE_DEFAULT_MAX_EVENTS;
  if (maxArg) {
    const eq = maxArg.includes("=")
      ? maxArg.split("=")[1]
      : argv[argv.indexOf(maxArg) + 1];
    const n = Number(eq);
    if (Number.isFinite(n) && n > 0) {
      maxEvents = Math.min(Math.floor(n), INTEGRATION_SMOKE_DEFAULT_MAX_EVENTS);
    }
  }
  return { live, dryRun, updateCache, maxEvents };
}
