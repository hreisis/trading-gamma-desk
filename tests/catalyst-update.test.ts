import { existsSync, mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  acquireUpdateLock,
  classifyAlpacaCredentialState,
  classifyMarketReaction,
  classifyUpdateError,
  createFakeBriefNarrator,
  createFakeMarketReactionNarrator,
  extractBriefFromDocument,
  loadCatalystFeed,
  parseCatalystUpdateArgs,
  readUpdateLock,
  releaseUpdateLock,
  runCatalystUpdate,
} from "@/catalyst";
import { writeJsonAtomic } from "@/desk/atomic-write";
import { CatalystUpdateManifest, type OfficialDocument } from "@/contracts";
import { documentContentHash } from "@/catalyst/documents/hash";
import { FOMC_MAINTAIN } from "../fixtures/catalyst/briefs/sample-bodies";
import { briefsLatestPath } from "@/catalyst/briefs/paths";
import { aiBriefsLatestPath } from "@/catalyst/briefs/ai/paths";
import { documentsLatestPath } from "@/catalyst/documents/paths";
import { marketContextLatestPath } from "@/catalyst/market-context/paths";
import { marketReactionsLatestPath } from "@/catalyst/market-reactions/paths";
import { catalystUpdateLockPath } from "@/catalyst/update/paths";
import { catalystUpdateManifestPath } from "@/catalyst/update/paths";
import type { MarketDataProvider } from "@/catalyst/market-context/provider";

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "gammadesk-m25b-"));
}

function makeDoc(): OfficialDocument {
  const contentText = FOMC_MAINTAIN;
  return {
    schemaVersion: "0.1.0",
    id: "odoc_fomc_upd",
    provider: "federal_reserve",
    sourceName: "Federal Reserve",
    canonicalUrl:
      "https://www.federalreserve.gov/newsevents/pressreleases/monetary20260729a.htm",
    title: "Federal Reserve issues FOMC statement",
    publishedAt: "2026-07-29T18:00:00.000Z",
    observedAt: "2026-07-29T18:05:00.000Z",
    documentType: "fomc_statement",
    releaseFamily: "fomc_policy",
    contentText,
    contentHash: documentContentHash({
      title: "Federal Reserve issues FOMC statement",
      contentText,
    }),
    synthetic: false,
  };
}

function seedDocuments(root: string, now = "2026-07-29T20:00:00.000Z"): void {
  const doc = makeDoc();
  writeJsonAtomic(documentsLatestPath(root), {
    kind: "CatalystDocumentsCache",
    schemaVersion: "0.1.0",
    fetchedAt: now,
    requestedWindow: {
      now,
      feedStart: "2026-06-29T20:00:00.000Z",
      feedEnd: now,
    },
    partialFailure: false,
    sources: [],
    documents: [doc],
    revisions: [],
    validationErrors: [],
    linkingWarnings: [],
  });
}

function seedBriefs(root: string, now = "2026-07-29T20:00:00.000Z"): void {
  const doc = makeDoc();
  const brief = extractBriefFromDocument(doc, now);
  writeJsonAtomic(briefsLatestPath(root), {
    kind: "CatalystBriefsCache",
    schemaVersion: "0.1.0",
    generatedAt: now,
    extractorVersion: brief.extractorVersion,
    buildStatus: "ok",
    inputDocuments: [
      {
        documentId: brief.documentId,
        contentHash: brief.documentContentHash,
        documentType: doc.documentType,
        releaseFamily: doc.releaseFamily ?? "fomc_policy",
        publishedAt: doc.publishedAt,
      },
    ],
    briefs: [brief],
    revisions: [],
    errors: [],
    warnings: [],
  });
}

function seedReactionCaches(root: string, now = "2026-07-29T20:00:00.000Z"): void {
  const feed = loadCatalystFeed(
    {},
    { forceSynthetic: true, publicDemo: true, now: new Date(now) },
  );
  const ctx = feed.marketContext![0]!;
  const reaction = classifyMarketReaction(ctx, { generatedAt: now });
  writeJsonAtomic(marketContextLatestPath(root), {
    kind: "CatalystMarketContextCache",
    schemaVersion: "0.1.0",
    fetchedAt: now,
    provider: "fake",
    feed: "sip",
    calculationVersion: ctx.calculationVersion,
    buildStatus: "ok",
    inputRefs: [],
    snapshots: [{ ...ctx, synthetic: false }],
    revisions: [],
    errors: [],
    warnings: [],
  });
  writeJsonAtomic(marketReactionsLatestPath(root), {
    kind: "CatalystMarketReactionsCache",
    schemaVersion: "0.1.0",
    generatedAt: now,
    reactionRulesVersion: reaction.reactionRulesVersion,
    buildStatus: "ok",
    inputRefs: [],
    reactions: [{ ...reaction, synthetic: false }],
    revisions: [],
    errors: [],
    warnings: [],
  });
}

describe("M2-5B args + error classification", () => {
  it("wires reaction_4b to official_facts + market_context_4a", async () => {
    const root = tempRoot();
    seedDocuments(root);
    seedBriefs(root);
    const result = await runCatalystUpdate({
      dataRoot: root,
      dryRun: true,
      now: new Date("2026-07-29T20:00:00.000Z"),
      env: {
        OPENAI_API_KEY: "sk-test",
        APCA_API_KEY_ID: "",
        APCA_API_SECRET_KEY: "",
      },
      skipLock: true,
      writeManifest: false,
    });
    const rxn = result.manifest.stages.find((s) => s.stage === "reaction_4b");
    expect(rxn?.dependsOn).toEqual(["official_facts", "market_context_4a"]);
    expect(
      result.manifest.stages.find((s) => s.stage === "openai_reaction_4c")
        ?.dependsOn,
    ).toEqual(["reaction_4b"]);
    // No 4A cache → 4B dependency unavailable even when facts ok
    expect(rxn?.status).toBe("skipped_dependency_unavailable");
  });

  it("parses dry-run and caps max-events at 2", () => {
    expect(parseCatalystUpdateArgs(["--dry-run"]).dryRun).toBe(true);
    expect(parseCatalystUpdateArgs(["--max-events", "9"]).maxEvents).toBe(2);
    expect(parseCatalystUpdateArgs(["--force"]).force).toBe(true);
  });

  it("classifies quota before auth; Alpaca credential states", () => {
    expect(
      classifyUpdateError(
        'OpenAI HTTP 403: {"error":{"type":"insufficient_quota"}}',
      ),
    ).toBe("insufficient_quota");
    expect(
      classifyAlpacaCredentialState({
        keyIdPresent: true,
        secretPresent: false,
      }).status,
    ).toBe("awaiting_valid_credentials");
    expect(
      classifyAlpacaCredentialState({
        keyIdPresent: true,
        secretPresent: true,
      }).status,
    ).toBe("awaiting_live_smoke");
    expect(
      classifyAlpacaCredentialState({
        keyIdPresent: true,
        secretPresent: true,
        fetchAttempted: true,
        fetchError: "OpenAI HTTP 401: unauthorized",
      }).status,
    ).toBe("authentication_error");
  });
});

describe("M2-5B run lock", () => {
  it("acquires, blocks concurrent, recovers stale lock", () => {
    const root = tempRoot();
    mkdirSync(join(root, "catalyst"), { recursive: true });
    const first = acquireUpdateLock({ dataRoot: root, runId: "upd_a" });
    expect(first.ok).toBe(true);
    const second = acquireUpdateLock({ dataRoot: root, runId: "upd_b" });
    expect(second.ok).toBe(false);
    if (first.ok) releaseUpdateLock({ dataRoot: root, runId: "upd_a" });
    expect(readUpdateLock(root)).toBeNull();

    writeJsonAtomic(catalystUpdateLockPath(root), {
      kind: "CatalystUpdateLock",
      schemaVersion: "0.1.0",
      runId: "upd_stale",
      pid: 99999999,
      startedAt: "2000-01-01T00:00:00.000Z",
    });
    const recovered = acquireUpdateLock({
      dataRoot: root,
      runId: "upd_c",
      now: new Date("2026-07-29T20:00:00.000Z"),
    });
    expect(recovered.ok).toBe(true);
    if (recovered.ok) releaseUpdateLock({ dataRoot: root, runId: "upd_c" });
  });
});

describe("M2-5B dry-run", () => {
  it("zero provider calls and zero business cache mutation", async () => {
    const root = tempRoot();
    seedDocuments(root);
    seedBriefs(root);
    let calls = 0;
    const beforeAi = existsSync(aiBriefsLatestPath(root));
    const result = await runCatalystUpdate({
      dataRoot: root,
      dryRun: true,
      now: new Date("2026-07-29T20:00:00.000Z"),
      env: {
        OPENAI_API_KEY: "sk-test",
        APCA_API_KEY_ID: "",
        APCA_API_SECRET_KEY: "",
      },
      officialNarrator: createFakeBriefNarrator("ok"),
      reactionNarrator: createFakeMarketReactionNarrator("ok"),
      onProviderCall: () => {
        calls += 1;
      },
      skipLock: true,
      writeManifest: true,
    });
    expect(calls).toBe(0);
    expect(result.manifest.mode).toBe("dry-run");
    expect(existsSync(aiBriefsLatestPath(root))).toBe(beforeAi);
    expect(existsSync(catalystUpdateManifestPath(root))).toBe(true);
    expect(
      CatalystUpdateManifest.safeParse(result.manifest).success,
    ).toBe(true);
    expect(
      result.manifest.stages.find((s) => s.stage === "market_context_4a")
        ?.status,
    ).toBe("awaiting_valid_credentials");
    expect(result.exitCode).not.toBe(0);
  });
});

describe("M2-5B live orchestration with fakes", () => {
  it("OpenAI official succeeds while Alpaca awaiting does not block or overwrite 4A", async () => {
    const root = tempRoot();
    seedDocuments(root);
    seedBriefs(root);
    // Seed a prior 4A that must be preserved (no calendar/results → 4A not re-fetched)
    seedReactionCaches(root);
    const priorMctx = readFileSync(marketContextLatestPath(root), "utf8");

    let alpacaCalls = 0;
    const authFailProvider: MarketDataProvider = {
      providerId: "alpaca",
      async fetchBars(req) {
        alpacaCalls += 1;
        return {
          ok: false,
          symbol: req.symbol,
          provider: "alpaca",
          feed: req.feed,
          error: "HTTP 401: unauthorized — invalid API secret",
        };
      },
    };

    const stageOrder: string[] = [];
    const result = await runCatalystUpdate({
      dataRoot: root,
      dryRun: false,
      maxEvents: 2,
      now: new Date("2026-07-29T20:00:00.000Z"),
      env: {
        OPENAI_API_KEY: "sk-test",
        // key without usable secret shape for resolveAlpacaCredentials when provider not used;
        // with missing calendar/results, 4A is dependency-skipped / awaiting — never overwrites.
        APCA_API_KEY_ID: "PKTEST",
        APCA_API_SECRET_KEY: "",
        CATALYST_LLM_MODEL: "fake-official",
        CATALYST_REACTION_LLM_MODEL: "fake-reaction",
      },
      officialNarrator: createFakeBriefNarrator("ok", "fake-official"),
      reactionNarrator: createFakeMarketReactionNarrator("ok", "fake-reaction"),
      marketProvider: authFailProvider,
      onProviderCall: (s) => stageOrder.push(s),
      skipLock: true,
      writeManifest: true,
    });

    const names = result.manifest.stages.map((s) => s.stage);
    expect(names).toEqual([
      "official_facts",
      "openai_official_brief",
      "market_context_4a",
      "reaction_4b",
      "openai_reaction_4c",
    ]);

    expect(
      result.manifest.stages.find((s) => s.stage === "openai_official_brief")
        ?.status,
    ).toBe("passed");
    const mctxStage = result.manifest.stages.find(
      (s) => s.stage === "market_context_4a",
    );
    expect(mctxStage?.status).toMatch(
      /awaiting_valid_credentials|skipped_dependency_unavailable/,
    );
    expect(mctxStage?.cachePreserved).toBe(true);
    expect(alpacaCalls).toBe(0);
    expect(readFileSync(marketContextLatestPath(root), "utf8")).toBe(priorMctx);
    expect(stageOrder).toContain("openai_official_brief");
    expect(
      result.manifest.stages.find((s) => s.stage === "openai_reaction_4c")
        ?.status,
    ).toBe("passed");
    expect(result.manifest.overallStatus).toBe("partial");
  });

  it("runs 4C when 4A/4B present; respects max-events 2", async () => {
    const root = tempRoot();
    seedDocuments(root);
    seedBriefs(root);
    seedReactionCaches(root);
    let reactionCalls = 0;
    const result = await runCatalystUpdate({
      dataRoot: root,
      dryRun: false,
      maxEvents: 2,
      now: new Date("2026-07-29T20:00:00.000Z"),
      env: {
        OPENAI_API_KEY: "sk-test",
        APCA_API_KEY_ID: "",
        APCA_API_SECRET_KEY: "",
      },
      officialNarrator: createFakeBriefNarrator("ok"),
      reactionNarrator: {
        providerId: "fake",
        async narrate(packet) {
          reactionCalls += 1;
          return createFakeMarketReactionNarrator("ok").narrate(packet);
        },
      },
      skipLock: true,
      writeManifest: false,
    });
    expect(reactionCalls).toBeGreaterThan(0);
    expect(reactionCalls).toBeLessThanOrEqual(2);
    expect(
      result.manifest.stages.find((s) => s.stage === "openai_reaction_4c")
        ?.status,
    ).toBe("passed");
    expect(
      result.manifest.stages.find((s) => s.stage === "market_context_4a")
        ?.status,
    ).toBe("awaiting_valid_credentials");
  });

  it("preserves prior AI cache on provider-wide failure", async () => {
    const root = tempRoot();
    seedDocuments(root);
    seedBriefs(root);
    const brief = extractBriefFromDocument(makeDoc(), "2026-07-29T19:00:00.000Z");
    writeJsonAtomic(aiBriefsLatestPath(root), {
      kind: "CatalystAiBriefsCache",
      schemaVersion: "0.1.0",
      generatedAt: "2026-07-29T19:00:00.000Z",
      provider: "prior",
      model: "prior-model",
      promptVersion: "0.1.0",
      extractorVersion: brief.extractorVersion,
      buildStatus: "ok",
      inputRefs: [],
      briefs: [
        {
          schemaVersion: "0.1.0",
          id: "oaibrief_prior_keep",
          inputBriefId: "other_brief",
          documentId: "other_doc",
          documentContentHash: "abc",
          extractorVersion: brief.extractorVersion,
          promptVersion: "0.1.0",
          provider: "prior",
          model: "prior-model",
          generatedAt: "2026-07-29T19:00:00.000Z",
          status: "complete",
          headline: "keep-me prior brief",
          bullets: [
            { id: "b1", text: "a", factIds: ["f1"] },
            { id: "b2", text: "b", factIds: ["f2"] },
          ],
          limitations: [],
          validation: {
            schemaValid: true,
            citationsValid: true,
            numbersValid: true,
            prohibitedInferenceDetected: false,
            errors: [],
          },
          synthetic: false,
        },
      ],
      usage: [],
      errors: [],
      warnings: ["keep-me"],
    });
    await runCatalystUpdate({
      dataRoot: root,
      dryRun: false,
      now: new Date("2026-07-29T20:00:00.000Z"),
      env: { OPENAI_API_KEY: "sk-test" },
      officialNarrator: createFakeBriefNarrator("provider_error"),
      skipLock: true,
      writeManifest: false,
    });
    expect(readFileSync(aiBriefsLatestPath(root), "utf8")).toContain("keep-me");
  });

  it("blocks public demo; redacts secrets in manifest", async () => {
    const blocked = await runCatalystUpdate({
      publicDemo: true,
      dryRun: false,
      env: { OPENAI_API_KEY: "sk-secret-value-xyz", GAMMADESK_PUBLIC_DEMO: "1" },
      skipLock: true,
      writeManifest: false,
    });
    expect(blocked.manifest.overallStatus).toBe("failed");

    const root = tempRoot();
    seedDocuments(root);
    seedBriefs(root);
    const result = await runCatalystUpdate({
      dataRoot: root,
      dryRun: true,
      now: new Date("2026-07-29T20:00:00.000Z"),
      env: { OPENAI_API_KEY: "sk-secret-value-xyz" },
      skipLock: true,
      writeManifest: true,
    });
    const blob = JSON.stringify(result.manifest);
    expect(blob).not.toContain("sk-secret-value-xyz");
  });

  it("second run skips up-to-date when identities unchanged", async () => {
    const root = tempRoot();
    seedDocuments(root);
    seedBriefs(root);
    seedReactionCaches(root);
    const env = {
      OPENAI_API_KEY: "sk-test",
      CATALYST_LLM_MODEL: "fake-model",
      CATALYST_REACTION_LLM_MODEL: "fake-model",
    };
    const first = await runCatalystUpdate({
      dataRoot: root,
      dryRun: false,
      now: new Date("2026-07-29T20:00:00.000Z"),
      env,
      officialNarrator: createFakeBriefNarrator("ok", "fake-model"),
      reactionNarrator: createFakeMarketReactionNarrator("ok", "fake-model"),
      skipLock: true,
      writeManifest: false,
    });
    expect(
      first.manifest.stages.find((s) => s.stage === "openai_official_brief")
        ?.status,
    ).toBe("passed");

    let calls = 0;
    const second = await runCatalystUpdate({
      dataRoot: root,
      dryRun: false,
      now: new Date("2026-07-29T20:05:00.000Z"),
      env,
      officialNarrator: {
        providerId: "fake",
        async narrate(packet) {
          calls += 1;
          return createFakeBriefNarrator("ok", "fake-model").narrate(packet);
        },
      },
      reactionNarrator: {
        providerId: "fake",
        async narrate(packet) {
          calls += 1;
          return createFakeMarketReactionNarrator("ok", "fake-model").narrate(
            packet,
          );
        },
      },
      skipLock: true,
      writeManifest: false,
    });
    // Identity reuse inside enhance → zero narrate calls
    expect(calls).toBe(0);
    expect(
      second.manifest.stages.find((s) => s.stage === "openai_official_brief")
        ?.status,
    ).toBe("skipped_up_to_date");
    expect(second.manifest.stages.length).toBe(5);
  });
});
