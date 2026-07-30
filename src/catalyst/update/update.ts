import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { writeJsonAtomic } from "@/desk/atomic-write";
import { isPublicDemoMode } from "@/desk/public-demo";
import {
  CatalystUpdateManifest,
  type CatalystUpdateStageId,
  type CatalystUpdateStageManifest,
  type CatalystUpdateStageStatus,
} from "@/contracts";
import { loadDocumentsCache } from "../documents/cache";
import { loadCalendarCache } from "../cache";
import { loadResultsCache } from "../results/cache";
import { buildOfficialBriefs } from "../briefs/build-briefs";
import { loadBriefsCache } from "../briefs/cache";
import {
  enhanceOfficialBriefs,
  isEligibleOfficialBrief,
} from "../briefs/ai/enhance";
import {
  loadCatalystLlmConfig,
  resolveCatalystLlmModel,
  resolveOpenAiApiKey,
} from "../briefs/ai/config";
import { AI_BRIEF_PROMPT_VERSION } from "../briefs/ai/prompt";
import { aiBriefIdFor } from "../briefs/ai/validate";
import type { BriefNarrator } from "../briefs/ai/narrator";
import { createOpenAiBriefNarrator } from "../briefs/ai/openai-narrator";
import { aiBriefsLatestPath } from "../briefs/ai/paths";
import { fetchOfficialMarketContext } from "../market-context/fetch-market-context";
import { loadMarketContextCache } from "../market-context/cache";
import {
  loadMarketContextConfig,
  resolveAlpacaCredentials,
  resolveCatalystMarketFeed,
} from "../market-context/config";
import type { MarketDataProvider } from "../market-context/provider";
import { marketContextLatestPath } from "../market-context/paths";
import { buildMarketReactions } from "../market-reactions/build-reactions";
import { loadMarketReactionsCache } from "../market-reactions/cache";
import { marketContextIdentity } from "../market-reactions/classify";
import { REACTION_RULES_VERSION } from "../market-reactions/version";
import {
  enhanceMarketReactions,
  isEligibleReactionPair,
} from "../market-reactions/ai/enhance";
import {
  loadCatalystReactionLlmConfig,
  resolveCatalystReactionLlmModel,
} from "../market-reactions/ai/config";
import { AI_REACTION_PROMPT_VERSION } from "../market-reactions/ai/prompt";
import { aiMarketReactionIdFor } from "../market-reactions/ai/validate";
import {
  marketReactionIdentity,
} from "../market-reactions/ai/evidence";
import type { MarketReactionNarrator } from "../market-reactions/ai/narrator";
import { createOpenAiMarketReactionNarrator } from "../market-reactions/ai/openai-narrator";
import { aiMarketReactionsLatestPath } from "../market-reactions/ai/paths";
import { redactSecrets } from "../integration-smoke/redaction";
import {
  classifyAlpacaCredentialState,
  classifyUpdateError,
} from "./errors";
import { acquireUpdateLock, releaseUpdateLock } from "./lock";
import {
  DEFAULT_CATALYST_UPDATE_DATA_ROOT,
  catalystUpdateManifestPath,
} from "./paths";

export const CATALYST_UPDATE_DEFAULT_MAX_EVENTS = 2;

const STAGE_DEPS: Record<CatalystUpdateStageId, CatalystUpdateStageId[]> = {
  official_facts: [],
  openai_official_brief: ["official_facts"],
  market_context_4a: [],
  reaction_4b: ["official_facts", "market_context_4a"],
  openai_reaction_4c: ["reaction_4b"],
};

export interface CatalystUpdateOptions {
  readonly dryRun?: boolean;
  readonly maxEvents?: number;
  readonly force?: boolean;
  readonly dataRoot?: string;
  readonly now?: Date;
  readonly publicDemo?: boolean;
  readonly env?: Record<string, string | undefined>;
  readonly writeManifest?: boolean;
  /** Test injection */
  readonly officialNarrator?: BriefNarrator;
  readonly reactionNarrator?: MarketReactionNarrator;
  readonly marketProvider?: MarketDataProvider;
  readonly onProviderCall?: (stage: string) => void;
  readonly skipLock?: boolean;
}

export interface CatalystUpdateResult {
  readonly manifest: CatalystUpdateManifest;
  readonly manifestPath: string | null;
  readonly exitCode: number;
  readonly summaryLines: string[];
}

function stageBase(
  stage: CatalystUpdateStageId,
  partial: Partial<CatalystUpdateStageManifest> & {
    status: CatalystUpdateStageStatus;
  },
): CatalystUpdateStageManifest {
  return {
    stage,
    dependsOn: STAGE_DEPS[stage],
    attemptedCount: 0,
    updatedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    cachePreserved: true,
    errorCodes: [],
    ...partial,
  };
}

function overallFromStages(
  stages: readonly CatalystUpdateStageManifest[],
  dryRun: boolean,
): CatalystUpdateManifest["overallStatus"] {
  if (dryRun) return "unavailable";
  const anyPassed = stages.some((s) => s.status === "passed");
  const anyFailed = stages.some((s) => s.status === "failed");
  // Branch isolation: Alpaca/4A failure must not mark the whole run failed
  // when the official-brief branch succeeded.
  if (anyFailed && !anyPassed) return "failed";
  const anyBlocking = stages.some(
    (s) =>
      s.status === "failed" ||
      s.status === "awaiting_valid_credentials" ||
      s.status === "awaiting_live_smoke" ||
      s.status === "unavailable" ||
      s.status === "skipped_dependency_unavailable" ||
      s.status === "skipped_no_eligible_input",
  );
  if (anyPassed && anyBlocking) return "partial";
  if (anyPassed) return "passed";
  return "unavailable";
}

export function exitCodeForUpdateManifest(
  manifest: CatalystUpdateManifest,
): number {
  if (manifest.overallStatus === "passed") return 0;
  if (manifest.mode === "dry-run" && manifest.overallStatus !== "failed") {
    return 2;
  }
  if (manifest.overallStatus === "partial") return 3;
  if (manifest.overallStatus === "unavailable") return 4;
  return 1;
}

export function parseCatalystUpdateArgs(
  argv: readonly string[],
): Pick<CatalystUpdateOptions, "dryRun" | "maxEvents" | "force"> {
  const dryRun = argv.includes("--dry-run");
  const force = argv.includes("--force");
  const maxArg = argv.find(
    (a) => a === "--max-events" || a.startsWith("--max-events="),
  );
  let maxEvents = CATALYST_UPDATE_DEFAULT_MAX_EVENTS;
  if (maxArg) {
    const eq = maxArg.includes("=")
      ? maxArg.split("=")[1]
      : argv[argv.indexOf(maxArg) + 1];
    const n = Number(eq);
    if (Number.isFinite(n) && n > 0) {
      maxEvents = Math.min(Math.floor(n), CATALYST_UPDATE_DEFAULT_MAX_EVENTS);
    }
  }
  return { dryRun, force, maxEvents };
}

export function formatUpdateSummary(
  manifest: CatalystUpdateManifest,
): string[] {
  const labels: Record<string, string> = {
    official_facts: "Official facts",
    openai_official_brief: "OpenAI official brief",
    market_context_4a: "Market context (4A)",
    reaction_4b: "Reaction pattern (4B)",
    openai_reaction_4c: "OpenAI reaction (4C)",
  };
  const lines: string[] = [];
  for (const s of manifest.stages) {
    const name = (labels[s.stage] ?? s.stage).padEnd(26);
    let detail: string = s.status;
    if (s.status === "passed" && s.updatedCount > 0) {
      detail = `${s.status} (updated ${s.updatedCount})`;
    } else if (s.status === "skipped_up_to_date") {
      detail = `${s.status} (${s.skippedCount})`;
    } else if (s.attemptedCount > 0 && s.status === "failed") {
      detail = `${s.status} (failed ${s.failedCount}/${s.attemptedCount})`;
    }
    lines.push(`${name}${detail}`);
  }
  lines.push(`${"Overall".padEnd(26)}${manifest.overallStatus}`);
  if (manifest.mode === "dry-run") {
    lines.push(
      "Note                      dry-run — zero provider calls, zero cache mutation",
    );
  }
  return lines.map(redactSecrets);
}

/**
 * Unified incremental catalyst update (M2-5B). Manual orchestration only.
 * Reuses existing stage adapters; does not fetch calendar/docs/results itself
 * (those remain independent fetch scripts). Branches:
 *   documents → official_facts → openai_official_brief
 *   calendar+results → 4A → 4B → 4C
 */
export async function runCatalystUpdate(
  options: CatalystUpdateOptions = {},
): Promise<CatalystUpdateResult> {
  const env = options.env ?? process.env;
  const publicDemo = options.publicDemo ?? isPublicDemoMode(env);
  const dryRun = Boolean(options.dryRun);
  const force = Boolean(options.force);
  const maxEvents = Math.max(
    1,
    Math.min(
      options.maxEvents ?? CATALYST_UPDATE_DEFAULT_MAX_EVENTS,
      CATALYST_UPDATE_DEFAULT_MAX_EVENTS,
    ),
  );
  const dataRoot = options.dataRoot ?? DEFAULT_CATALYST_UPDATE_DATA_ROOT;
  const now = options.now ?? new Date();
  const startedAt = now.toISOString();
  const runId = `upd_${randomUUID().slice(0, 12)}`;
  const stages: CatalystUpdateStageManifest[] = [];
  const notes: string[] = [];
  let lockHeld = false;
  let providerCalls = 0;

  const onCall = (stage: string) => {
    providerCalls += 1;
    options.onProviderCall?.(stage);
  };

  const finish = (
    overallOverride?: CatalystUpdateManifest["overallStatus"],
  ): CatalystUpdateResult => {
    const overall =
      overallOverride ?? overallFromStages(stages, dryRun);
    const manifest = CatalystUpdateManifest.parse({
      schemaVersion: "0.1.0",
      kind: "CatalystUpdateManifest",
      runId,
      mode: dryRun ? "dry-run" : "live",
      startedAt,
      completedAt: new Date().toISOString(),
      overallStatus: overall,
      maxEvents,
      force,
      notes: notes.map(redactSecrets),
      stages,
    });
    let manifestPath: string | null = null;
    if (options.writeManifest !== false) {
      manifestPath = catalystUpdateManifestPath(dataRoot);
      writeJsonAtomic(manifestPath, manifest);
    }
    if (lockHeld) {
      releaseUpdateLock({ dataRoot, runId });
      lockHeld = false;
    }
    return {
      manifest,
      manifestPath,
      exitCode: exitCodeForUpdateManifest(manifest),
      summaryLines: formatUpdateSummary(manifest),
    };
  };

  if (publicDemo) {
    notes.push("Blocked in public demo (GAMMADESK_PUBLIC_DEMO).");
    stages.push(
      stageBase("official_facts", {
        status: "failed",
        errorCodes: ["public_demo_blocked"],
      }),
    );
    return finish("failed");
  }

  if (!dryRun && !options.skipLock) {
    const lock = acquireUpdateLock({ dataRoot, runId, now });
    if (!lock.ok) {
      notes.push(redactSecrets(lock.error));
      stages.push(
        stageBase("official_facts", {
          status: "failed",
          errorCodes: ["runner_error"],
        }),
      );
      return finish("failed");
    }
    lockHeld = true;
  }

  const openaiKey = resolveOpenAiApiKey(env as NodeJS.ProcessEnv);
  const officialModel = resolveCatalystLlmModel(env as NodeJS.ProcessEnv);
  const reactionModel = resolveCatalystReactionLlmModel(
    env as NodeJS.ProcessEnv,
  );
  const alpacaCreds = resolveAlpacaCredentials(env as NodeJS.ProcessEnv);
  const keyIdPresent = Boolean((env.APCA_API_KEY_ID ?? "").trim());
  const secretPresent = Boolean((env.APCA_API_SECRET_KEY ?? "").trim());
  const feed = resolveCatalystMarketFeed(env as NodeJS.ProcessEnv);

  notes.push(
    `Official model: ${officialModel}; reaction model: ${reactionModel}; feed: ${feed}.`,
  );
  notes.push(
    `Alpaca keyId: ${keyIdPresent ? "present" : "absent"}; secret: ${secretPresent ? "present" : "absent"}.`,
  );
  if (dryRun) {
    notes.push(
      "dry-run — incremental plan only; zero OpenAI/Alpaca calls; no business cache writes.",
    );
  }

  const docs = loadDocumentsCache({ dataRoot, now });
  const calendar = loadCalendarCache({ dataRoot, now });
  const results = loadResultsCache({ dataRoot, now });
  const briefs = loadBriefsCache({ dataRoot, now });
  const aiBriefs = existsSync(aiBriefsLatestPath(dataRoot));
  const mctx = loadMarketContextCache({ dataRoot, now });
  const mrxn = loadMarketReactionsCache({ dataRoot, now });
  void aiBriefs;

  // ── Branch A: official facts → AI brief ──────────────────────────
  let factsOk = false;
  {
    const t0 = new Date().toISOString();
    if (!docs.ok) {
      stages.push(
        stageBase("official_facts", {
          status: "skipped_dependency_unavailable",
          errorCodes: ["dependency_unavailable"],
          startedAt: t0,
          completedAt: new Date().toISOString(),
        }),
      );
      notes.push("Official facts skipped — documents cache unavailable.");
    } else if (dryRun) {
      const prior = briefs.ok ? briefs.cache.briefs : [];
      const docCount = docs.cache.documents.length;
      const plannedSkip = force
        ? 0
        : prior.filter((b) =>
            docs.cache.documents.some(
              (d) =>
                d.id === b.documentId &&
                d.contentHash === b.documentContentHash,
            ),
          ).length;
      const plannedUpdate = Math.max(0, docCount - plannedSkip);
      stages.push(
        stageBase("official_facts", {
          status:
            plannedUpdate === 0 && docCount > 0
              ? "skipped_up_to_date"
              : docCount === 0
                ? "skipped_no_eligible_input"
                : "passed",
          attemptedCount: Math.min(docCount, maxEvents),
          updatedCount: Math.min(plannedUpdate, maxEvents),
          skippedCount: plannedSkip,
          startedAt: t0,
          completedAt: new Date().toISOString(),
        }),
      );
      factsOk = docCount > 0 || briefs.ok;
    } else {
      try {
        const beforePath = existsSync(
          `${dataRoot}/catalyst/briefs-latest.json`,
        );
        const result = buildOfficialBriefs({
          dataRoot,
          now,
          write: true,
          publicDemo: false,
        });
        const updated = result.cache.revisions.length;
        const total = result.cache.briefs.length;
        const failed = result.cache.errors.length;
        factsOk = result.path !== null || result.cache.buildStatus !== "failed";
        stages.push(
          stageBase("official_facts", {
            status:
              result.cache.buildStatus === "failed"
                ? "failed"
                : updated === 0 && total > 0
                  ? "skipped_up_to_date"
                  : "passed",
            attemptedCount: Math.min(total, maxEvents),
            updatedCount: updated,
            skippedCount: Math.max(0, total - updated),
            failedCount: failed,
            cachePreserved: result.path !== null || beforePath,
            errorCodes: result.cache.errors.map((e) =>
              classifyUpdateError(e.error),
            ),
            startedAt: t0,
            completedAt: new Date().toISOString(),
          }),
        );
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        stages.push(
          stageBase("official_facts", {
            status: "failed",
            errorCodes: [classifyUpdateError(message)],
            startedAt: t0,
            completedAt: new Date().toISOString(),
          }),
        );
      }
    }
  }

  // Refresh briefs after facts stage
  const briefsAfter = loadBriefsCache({ dataRoot, now });
  factsOk =
    factsOk ||
    (briefsAfter.ok && briefsAfter.cache.briefs.length > 0) ||
    (briefs.ok && briefs.cache.briefs.length > 0);

  {
    const t0 = new Date().toISOString();
    const factsStage = stages.find((s) => s.stage === "official_facts");
    const factsFailedHard = factsStage?.status === "failed";
    const briefsLoaded = briefsAfter.ok ? briefsAfter : briefs;

    if (factsFailedHard && !briefsLoaded.ok) {
      stages.push(
        stageBase("openai_official_brief", {
          status: "skipped_dependency_unavailable",
          provider: "openai",
          model: officialModel,
          errorCodes: ["dependency_unavailable"],
          startedAt: t0,
          completedAt: new Date().toISOString(),
        }),
      );
    } else if (!briefsLoaded.ok) {
      stages.push(
        stageBase("openai_official_brief", {
          status: "skipped_dependency_unavailable",
          provider: "openai",
          model: officialModel,
          errorCodes: ["dependency_unavailable"],
          startedAt: t0,
          completedAt: new Date().toISOString(),
        }),
      );
    } else if (!openaiKey && !options.officialNarrator && !dryRun) {
      stages.push(
        stageBase("openai_official_brief", {
          status: "unavailable",
          provider: "openai",
          model: officialModel,
          errorCodes: ["missing_credentials"],
          startedAt: t0,
          completedAt: new Date().toISOString(),
        }),
      );
    } else {
      const published = new Map(
        briefsLoaded.cache.inputDocuments.map((d) => [
          d.documentId,
          d.publishedAt,
        ]),
      );
      const eligible = briefsLoaded.cache.briefs.filter((b) =>
        isEligibleOfficialBrief(b, published.get(b.documentId), now),
      );
      const priorAi = existsSync(aiBriefsLatestPath(dataRoot));

      if (eligible.length === 0) {
        stages.push(
          stageBase("openai_official_brief", {
            status: "skipped_no_eligible_input",
            provider: "openai",
            model: officialModel,
            errorCodes: ["no_eligible_input"],
            startedAt: t0,
            completedAt: new Date().toISOString(),
          }),
        );
      } else if (dryRun) {
        stages.push(
          stageBase("openai_official_brief", {
            status: "passed",
            provider: "openai",
            model: officialModel,
            attemptedCount: Math.min(eligible.length, maxEvents),
            updatedCount: Math.min(eligible.length, maxEvents),
            startedAt: t0,
            completedAt: new Date().toISOString(),
          }),
        );
        notes.push(
          `Plan: enhance up to ${Math.min(eligible.length, maxEvents)} official AI briefs (identity skip applied at enhance time).`,
        );
      } else {
        const runtime = loadCatalystLlmConfig(env as NodeJS.ProcessEnv, {
          apiKey: openaiKey,
          model: officialModel,
          maxPerRun: maxEvents,
        });
        const base =
          options.officialNarrator ??
          createOpenAiBriefNarrator({ config: runtime });
        const narrator: BriefNarrator = {
          providerId: base.providerId,
          async narrate(packet) {
            onCall("openai_official_brief");
            return base.narrate(packet);
          },
        };
        const callsBefore = providerCalls;
        try {
          const result = await enhanceOfficialBriefs({
            dataRoot,
            now,
            write: true,
            force,
            maxPerRun: maxEvents,
            narrator,
            config: runtime,
            publicDemo: false,
          });
          const called = providerCalls - callsBefore;
          const validated = result.cache.briefs.filter(
            (b) =>
              (b.status === "complete" || b.status === "partial") &&
              b.validation.errors.length === 0,
          ).length;
          const rejected = result.cache.errors.length;
          const preserved = result.path === null && priorAi;
          const allReused = called === 0 && validated > 0 && rejected === 0;
          stages.push(
            stageBase("openai_official_brief", {
              status: allReused
                ? "skipped_up_to_date"
                : validated > 0 && rejected === 0
                  ? "passed"
                  : rejected > 0
                    ? "failed"
                    : result.cache.buildStatus === "unavailable"
                      ? "unavailable"
                      : "failed",
              provider: "openai",
              model: officialModel,
              attemptedCount: Math.min(eligible.length, maxEvents),
              updatedCount: allReused ? 0 : Math.min(called, validated),
              skippedCount: allReused
                ? Math.min(eligible.length, maxEvents)
                : 0,
              failedCount: rejected,
              cachePreserved: preserved || result.path !== null || !priorAi,
              errorCodes: result.cache.errors.map((e) =>
                classifyUpdateError(e.error),
              ),
              startedAt: t0,
              completedAt: new Date().toISOString(),
            }),
          );
          void aiBriefIdFor;
          void AI_BRIEF_PROMPT_VERSION;
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          stages.push(
            stageBase("openai_official_brief", {
              status: "failed",
              provider: "openai",
              model: officialModel,
              errorCodes: [classifyUpdateError(message)],
              cachePreserved: priorAi,
              startedAt: t0,
              completedAt: new Date().toISOString(),
            }),
          );
        }
      }
    }
  }

  // ── Branch B: 4A → 4B → 4C ───────────────────────────────────────
  let mctxOk = false;
  {
    const t0 = new Date().toISOString();
    const alpacaState = classifyAlpacaCredentialState({
      keyIdPresent,
      secretPresent,
    });

    if (alpacaState.status === "awaiting_valid_credentials") {
      stages.push(
        stageBase("market_context_4a", {
          status: "awaiting_valid_credentials",
          provider: "alpaca",
          feed,
          errorCodes: ["awaiting_valid_credentials"],
          cachePreserved: mctx.ok,
          startedAt: t0,
          completedAt: new Date().toISOString(),
        }),
      );
      notes.push(
        "4A awaiting_valid_credentials — no Alpaca call; prior 4A preserved; no synthetic fill.",
      );
      mctxOk = mctx.ok;
    } else if (!calendar.ok || !results.ok) {
      stages.push(
        stageBase("market_context_4a", {
          status: "skipped_dependency_unavailable",
          provider: "alpaca",
          feed,
          errorCodes: ["dependency_unavailable"],
          cachePreserved: mctx.ok,
          startedAt: t0,
          completedAt: new Date().toISOString(),
        }),
      );
      notes.push(
        "4A skipped — calendar/results cache unavailable (official brief branch unaffected).",
      );
      mctxOk = mctx.ok;
    } else if (dryRun) {
      stages.push(
        stageBase("market_context_4a", {
          status: "awaiting_live_smoke",
          provider: "alpaca",
          feed,
          errorCodes: ["awaiting_live_smoke"],
          attemptedCount: 0,
          cachePreserved: true,
          startedAt: t0,
          completedAt: new Date().toISOString(),
        }),
      );
      notes.push(
        "4A dry-run: credentials shape present — awaiting_live_smoke (zero Alpaca HTTP).",
      );
      mctxOk = mctx.ok;
    } else {
      const priorPath = existsSync(marketContextLatestPath(dataRoot));
      const priorHashOk = mctx.ok;
      const runtime = loadMarketContextConfig(env as NodeJS.ProcessEnv);
      try {
        const result = await fetchOfficialMarketContext({
          dataRoot,
          now,
          write: true,
          force,
          maxPerRun: maxEvents,
          publicDemo: false,
          provider: options.marketProvider,
          config: runtime,
        });
        const errors = result.cache.errors.map((e) => e.error);
        const authish = errors.some((e) =>
          /401|403|authentication|unauthorized|forbidden|invalid/i.test(e),
        );
        const fetchAttempted = Boolean(options.marketProvider) || Boolean(alpacaCreds);
        if (
          result.cache.buildStatus === "unavailable" &&
          !alpacaCreds &&
          !options.marketProvider
        ) {
          stages.push(
            stageBase("market_context_4a", {
              status: "awaiting_valid_credentials",
              provider: "alpaca",
              feed,
              errorCodes: ["awaiting_valid_credentials"],
              cachePreserved: true,
              startedAt: t0,
              completedAt: new Date().toISOString(),
            }),
          );
        } else if (authish || (result.path === null && fetchAttempted && result.cache.buildStatus === "failed")) {
          const state = classifyAlpacaCredentialState({
            keyIdPresent: true,
            secretPresent: true,
            fetchAttempted: true,
            fetchError: errors[0] ?? "authentication_error",
          });
          stages.push(
            stageBase("market_context_4a", {
              status:
                state.status === "authentication_error"
                  ? "failed"
                  : "awaiting_valid_credentials",
              provider: "alpaca",
              feed,
              attemptedCount: Math.min(maxEvents, result.cache.snapshots.length || maxEvents),
              failedCount: result.cache.errors.length,
              cachePreserved: result.path === null || priorHashOk,
              errorCodes: [
                state.errorCode,
                ...errors.map(classifyUpdateError),
              ].filter((v, i, a) => a.indexOf(v) === i),
              startedAt: t0,
              completedAt: new Date().toISOString(),
            }),
          );
          notes.push(
            "4A Alpaca auth/credential failure — prior cache preserved; official brief branch unaffected.",
          );
          mctxOk = priorHashOk;
        } else {
          const updated = result.cache.revisions.length;
          mctxOk =
            result.cache.snapshots.some(
              (s) => s.status === "complete" || s.status === "partial",
            ) || priorHashOk;
          stages.push(
            stageBase("market_context_4a", {
              status:
                result.cache.buildStatus === "failed"
                  ? "failed"
                  : updated === 0 && result.cache.snapshots.length > 0
                    ? "skipped_up_to_date"
                    : "passed",
              provider: "alpaca",
              feed,
              attemptedCount: Math.min(
                maxEvents,
                result.cache.snapshots.length,
              ),
              updatedCount: updated,
              skippedCount: Math.max(0, result.cache.snapshots.length - updated),
              failedCount: result.cache.errors.length,
              cachePreserved: result.path !== null || priorPath,
              errorCodes: errors.map(classifyUpdateError),
              startedAt: t0,
              completedAt: new Date().toISOString(),
            }),
          );
        }
        void onCall;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const code = classifyUpdateError(message);
        stages.push(
          stageBase("market_context_4a", {
            status:
              code === "authentication_error" ||
              code === "awaiting_valid_credentials"
                ? "failed"
                : "failed",
            provider: "alpaca",
            feed,
            errorCodes: [code],
            cachePreserved: priorHashOk,
            startedAt: t0,
            completedAt: new Date().toISOString(),
          }),
        );
        mctxOk = priorHashOk;
        notes.push(
          "4A stage error isolated — official brief branch unaffected; prior 4A preserved.",
        );
      }
    }
  }

  // Refresh 4A
  const mctxAfter = loadMarketContextCache({ dataRoot, now });
  mctxOk =
    mctxOk ||
    (mctxAfter.ok &&
      mctxAfter.cache.snapshots.some(
        (s) => s.status === "complete" || s.status === "partial",
      ));

  let mrxnOk = false;
  {
    const t0 = new Date().toISOString();
    const mctxUsable = mctxAfter.ok || mctx.ok;
    if (!factsOk || !mctxUsable) {
      stages.push(
        stageBase("reaction_4b", {
          status: "skipped_dependency_unavailable",
          errorCodes: ["dependency_unavailable"],
          startedAt: t0,
          completedAt: new Date().toISOString(),
        }),
      );
      if (!factsOk) {
        notes.push(
          "4B skipped — official_facts unavailable (required for official event/facts identity).",
        );
      }
      if (!mctxUsable) {
        notes.push(
          "4B skipped — market_context_4a unavailable (not filled with synthetic).",
        );
      }
    } else if (dryRun) {
      const snaps = mctxUsable
        ? (mctxAfter.ok ? mctxAfter.cache : mctx.ok ? mctx.cache : null)
            ?.snapshots ?? []
        : [];
      const eligible = snaps.filter((s) => s.status !== "unavailable").length;
      stages.push(
        stageBase("reaction_4b", {
          status:
            eligible === 0 ? "skipped_no_eligible_input" : "passed",
          attemptedCount: Math.min(eligible, maxEvents),
          updatedCount: Math.min(eligible, maxEvents),
          startedAt: t0,
          completedAt: new Date().toISOString(),
        }),
      );
      mrxnOk = eligible > 0 || mrxn.ok;
    } else {
      try {
        const result = buildMarketReactions({
          dataRoot,
          now,
          write: true,
          force,
          maxPerRun: maxEvents,
          publicDemo: false,
        });
        const updated = result.cache.revisions.length;
        mrxnOk = result.cache.reactions.some(
          (r) => r.status === "complete" || r.status === "partial",
        );
        stages.push(
          stageBase("reaction_4b", {
            status:
              result.cache.buildStatus === "failed"
                ? "failed"
                : updated === 0 && result.cache.reactions.length > 0
                  ? "skipped_up_to_date"
                  : mrxnOk
                    ? "passed"
                    : "skipped_no_eligible_input",
            attemptedCount: Math.min(
              maxEvents,
              result.cache.reactions.length,
            ),
            updatedCount: updated,
            skippedCount: Math.max(
              0,
              result.cache.reactions.length - updated,
            ),
            failedCount: result.cache.errors.length,
            cachePreserved: result.path !== null,
            errorCodes: result.cache.errors.map((e) =>
              classifyUpdateError(e.error),
            ),
            startedAt: t0,
            completedAt: new Date().toISOString(),
          }),
        );
        void marketContextIdentity;
        void REACTION_RULES_VERSION;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        stages.push(
          stageBase("reaction_4b", {
            status: "failed",
            errorCodes: [classifyUpdateError(message)],
            cachePreserved: mrxn.ok,
            startedAt: t0,
            completedAt: new Date().toISOString(),
          }),
        );
        mrxnOk = mrxn.ok;
      }
    }
  }

  const mrxnAfter = loadMarketReactionsCache({ dataRoot, now });
  mrxnOk =
    mrxnOk ||
    (mrxnAfter.ok &&
      mrxnAfter.cache.reactions.some(
        (r) => r.status === "complete" || r.status === "partial",
      ));

  {
    const t0 = new Date().toISOString();
    const ctxLoaded = mctxAfter.ok ? mctxAfter : mctx;
    const rxnStage = stages.find((s) => s.stage === "reaction_4b");
    const rxnLoaded = mrxnAfter.ok ? mrxnAfter : mrxn;
    const rxnUsable =
      mrxnOk &&
      ctxLoaded.ok &&
      rxnLoaded.ok &&
      rxnStage?.status !== "skipped_dependency_unavailable" &&
      rxnStage?.status !== "skipped_no_eligible_input" &&
      rxnStage?.status !== "failed";
    if (!rxnUsable) {
      stages.push(
        stageBase("openai_reaction_4c", {
          status: "skipped_dependency_unavailable",
          provider: "openai",
          model: reactionModel,
          errorCodes: ["dependency_unavailable"],
          startedAt: t0,
          completedAt: new Date().toISOString(),
        }),
      );
      notes.push(
        "4C skipped — reaction_4b unavailable (requires official_facts + market_context_4a).",
      );
    } else if (!openaiKey && !options.reactionNarrator && !dryRun) {
      stages.push(
        stageBase("openai_reaction_4c", {
          status: "unavailable",
          provider: "openai",
          model: reactionModel,
          errorCodes: ["missing_credentials"],
          startedAt: t0,
          completedAt: new Date().toISOString(),
        }),
      );
    } else {
      const ctxById = new Map(
        ctxLoaded.cache.snapshots.map((c) => [c.id, c]),
      );
      const pairs = rxnLoaded.cache.reactions.filter((r) => {
        const ctx = ctxById.get(r.marketContextId);
        return ctx ? isEligibleReactionPair(ctx, r, now) : false;
      });
      if (pairs.length === 0) {
        stages.push(
          stageBase("openai_reaction_4c", {
            status: "skipped_no_eligible_input",
            provider: "openai",
            model: reactionModel,
            errorCodes: ["no_eligible_input"],
            startedAt: t0,
            completedAt: new Date().toISOString(),
          }),
        );
      } else if (dryRun) {
        stages.push(
          stageBase("openai_reaction_4c", {
            status: "passed",
            provider: "openai",
            model: reactionModel,
            attemptedCount: Math.min(pairs.length, maxEvents),
            updatedCount: Math.min(pairs.length, maxEvents),
            startedAt: t0,
            completedAt: new Date().toISOString(),
          }),
        );
        notes.push(
          `Plan: enhance up to ${Math.min(pairs.length, maxEvents)} AI reaction narratives.`,
        );
      } else {
        const priorPath = existsSync(aiMarketReactionsLatestPath(dataRoot));
        const runtime = loadCatalystReactionLlmConfig(
          env as NodeJS.ProcessEnv,
          {
            apiKey: openaiKey,
            model: reactionModel,
            maxPerRun: maxEvents,
          },
        );
        const base =
          options.reactionNarrator ??
          createOpenAiMarketReactionNarrator({ config: runtime });
        const narrator: MarketReactionNarrator = {
          providerId: base.providerId,
          async narrate(packet) {
            onCall("openai_reaction_4c");
            return base.narrate(packet);
          },
        };
        const callsBefore = providerCalls;
        try {
          const result = await enhanceMarketReactions({
            dataRoot,
            now,
            write: true,
            force,
            maxPerRun: maxEvents,
            narrator,
            config: runtime,
            publicDemo: false,
          });
          const called = providerCalls - callsBefore;
          const validated = result.cache.narratives.filter(
            (n) =>
              (n.status === "complete" || n.status === "partial") &&
              n.validationErrors.length === 0,
          ).length;
          const rejected = result.cache.errors.length;
          const allReused = called === 0 && validated > 0 && rejected === 0;
          stages.push(
            stageBase("openai_reaction_4c", {
              status: allReused
                ? "skipped_up_to_date"
                : validated > 0 && rejected === 0
                  ? "passed"
                  : rejected > 0
                    ? "failed"
                    : result.cache.buildStatus === "unavailable"
                      ? "unavailable"
                      : "failed",
              provider: "openai",
              model: reactionModel,
              attemptedCount: Math.min(pairs.length, maxEvents),
              updatedCount: allReused ? 0 : Math.min(called, validated),
              skippedCount: allReused ? Math.min(pairs.length, maxEvents) : 0,
              failedCount: rejected,
              cachePreserved:
                result.path !== null || priorPath || result.path === null,
              errorCodes: result.cache.errors.map((e) =>
                classifyUpdateError(e.error),
              ),
              startedAt: t0,
              completedAt: new Date().toISOString(),
            }),
          );
          void aiMarketReactionIdFor;
          void marketReactionIdentity;
          void AI_REACTION_PROMPT_VERSION;
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          stages.push(
            stageBase("openai_reaction_4c", {
              status: "failed",
              provider: "openai",
              model: reactionModel,
              errorCodes: [classifyUpdateError(message)],
              cachePreserved: priorPath,
              startedAt: t0,
              completedAt: new Date().toISOString(),
            }),
          );
        }
      }
    }
  }

  notes.push(`Provider narrate()/fetch calls this run: ${providerCalls}.`);
  notes.push(
    "Incremental identity: recompute only when input identity / rules / prompt / model / dependency version changes.",
  );
  return finish();
}
