import { existsSync, mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyMarketReaction,
  classifySmokeError,
  createFakeBriefNarrator,
  createFakeMarketReactionNarrator,
  exitCodeForReport,
  extractBriefFromDocument,
  formatSummary,
  loadCatalystFeed,
  parseIntegrationSmokeArgs,
  redactSecrets,
  runCatalystIntegrationSmoke,
} from "@/catalyst";
import { writeJsonAtomic } from "@/desk/atomic-write";
import { CatalystIntegrationSmokeReport } from "@/contracts";
import { documentContentHash } from "@/catalyst/documents/hash";
import type { OfficialDocument } from "@/contracts";
import { FOMC_MAINTAIN } from "../fixtures/catalyst/briefs/sample-bodies";
import { integrationSmokeReportPath } from "@/catalyst/integration-smoke/paths";
import { aiBriefsLatestPath } from "@/catalyst/briefs/ai/paths";
import { marketContextLatestPath } from "@/catalyst/market-context/paths";
import { marketReactionsLatestPath } from "@/catalyst/market-reactions/paths";
import { briefsLatestPath } from "@/catalyst/briefs/paths";

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "gammadesk-m25a-"));
}

function makeDoc(): OfficialDocument {
  const contentText = FOMC_MAINTAIN;
  return {
    schemaVersion: "0.1.0",
    id: "odoc_fomc_smoke",
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

function seedBriefsCache(root: string, now = "2026-07-29T20:00:00.000Z"): void {
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
    {
      forceSynthetic: true,
      publicDemo: true,
      now: new Date(now),
    },
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

describe("M2-5A-Lite redaction + error codes", () => {
  it("redacts keys, bearer tokens, and authorization headers", () => {
    const raw =
      "OPENAI_API_KEY=sk-abc123456789 Authorization: Bearer tok_secret APCA_API_SECRET_KEY=sec";
    const out = redactSecrets(raw);
    expect(out).not.toMatch(/sk-abc/);
    expect(out).not.toMatch(/tok_secret/);
    expect(out).toMatch(/REDACTED/);
  });

  it("classifies provider errors safely", () => {
    expect(classifySmokeError("OpenAI HTTP 429: rate")).toBe("rate_limit");
    expect(
      classifySmokeError(
        'OpenAI HTTP 429: {"error":{"type":"insufficient_quota","message":"You exceeded your current quota"}}',
      ),
    ).toBe("insufficient_quota");
    expect(
      classifySmokeError(
        "OpenAI HTTP 403: forbidden — exceeded your current quota, check billing",
      ),
    ).toBe("insufficient_quota");
    expect(
      classifySmokeError("OpenAI HTTP 403: invalid API key provided"),
    ).toBe("authentication_error");
    expect(classifySmokeError("OpenAI timed out after 1ms")).toBe("timeout");
    expect(classifySmokeError("OpenAI HTTP 500: x")).toBe("provider_5xx");
    expect(classifySmokeError("OpenAI HTTP 400: x")).toBe("provider_4xx");
    expect(classifySmokeError("Model output schema invalid")).toBe(
      "schema_invalid",
    );
    expect(classifySmokeError("validation rejected citation")).toBe(
      "validation_rejected",
    );
    expect(classifySmokeError("OPENAI_API_KEY missing")).toBe(
      "missing_credentials",
    );
  });
});

describe("M2-5A-Lite CLI args", () => {
  it("requires --live; caps max-events at 2", () => {
    expect(parseIntegrationSmokeArgs(["--dry-run"]).live).toBe(false);
    expect(parseIntegrationSmokeArgs(["--live"]).live).toBe(true);
    expect(parseIntegrationSmokeArgs(["--max-events", "9"]).maxEvents).toBe(2);
    expect(parseIntegrationSmokeArgs(["--max-events=1"]).maxEvents).toBe(1);
  });
});

describe("M2-5A-Lite dry-run / opt-in", () => {
  it("dry-run: zero provider calls, zero business cache mutation, writes report", async () => {
    const root = tempRoot();
    seedBriefsCache(root);
    let calls = 0;
    const result = await runCatalystIntegrationSmoke({
      dataRoot: root,
      dryRun: true,
      live: false,
      now: new Date("2026-07-29T20:00:00.000Z"),
      env: {
        OPENAI_API_KEY: "sk-test-should-not-be-used",
        APCA_API_KEY_ID: "",
        APCA_API_SECRET_KEY: "",
      },
      officialNarrator: createFakeBriefNarrator("ok"),
      reactionNarrator: createFakeMarketReactionNarrator("ok"),
      onProviderCall: () => {
        calls += 1;
      },
      writeReport: true,
    });
    expect(calls).toBe(0);
    expect(result.report.mode).toBe("dry-run");
    expect(result.report.liveOptIn).toBe(false);
    expect(
      result.report.stages.find((s) => s.stage === "alpaca_market_context")
        ?.status,
    ).toBe("awaiting_valid_credentials");
    expect(existsSync(aiBriefsLatestPath(root))).toBe(false);
    expect(existsSync(integrationSmokeReportPath(root))).toBe(true);
    expect(
      CatalystIntegrationSmokeReport.safeParse(result.report).success,
    ).toBe(true);
    expect(result.exitCode).not.toBe(0);
  });

  it("without --live never calls providers even if keys exist", async () => {
    const root = tempRoot();
    let calls = 0;
    const result = await runCatalystIntegrationSmoke({
      dataRoot: root,
      live: false,
      now: new Date("2026-07-29T20:00:00.000Z"),
      env: {
        OPENAI_API_KEY: "sk-present",
        APCA_API_KEY_ID: "id",
        APCA_API_SECRET_KEY: "secret",
      },
      onProviderCall: () => {
        calls += 1;
      },
      writeReport: false,
    });
    expect(calls).toBe(0);
    expect(result.report.mode).toBe("dry-run");
  });
});

describe("M2-5A-Lite live stages with fake narrators", () => {
  it("OpenAI present + Alpaca missing → alpaca awaiting; official AI can pass", async () => {
    const root = tempRoot();
    seedBriefsCache(root);
    const stageOrder: string[] = [];
    const result = await runCatalystIntegrationSmoke({
      dataRoot: root,
      live: true,
      maxEvents: 2,
      now: new Date("2026-07-29T20:00:00.000Z"),
      env: {
        OPENAI_API_KEY: "sk-test",
        CATALYST_LLM_MODEL: "fake-official",
        CATALYST_REACTION_LLM_MODEL: "fake-reaction",
        APCA_API_KEY_ID: "",
        APCA_API_SECRET_KEY: "",
      },
      officialNarrator: createFakeBriefNarrator("ok", "fake-official"),
      reactionNarrator: createFakeMarketReactionNarrator("ok", "fake-reaction"),
      onProviderCall: (s) => stageOrder.push(s),
      writeReport: true,
    });

    const names = result.report.stages.map((s) => s.stage);
    expect(names.indexOf("preflight")).toBeLessThan(
      names.indexOf("alpaca_market_context"),
    );
    expect(names.indexOf("alpaca_market_context")).toBeLessThan(
      names.indexOf("openai_official_brief"),
    );
    expect(names.indexOf("openai_official_brief")).toBeLessThan(
      names.indexOf("openai_market_reaction"),
    );
    expect(names.indexOf("openai_market_reaction")).toBeLessThan(
      names.indexOf("cache_integrity"),
    );

    expect(
      result.report.stages.find((s) => s.stage === "alpaca_market_context")
        ?.status,
    ).toBe("awaiting_valid_credentials");
    expect(
      result.report.stages.find((s) => s.stage === "openai_official_brief")
        ?.status,
    ).toBe("passed");
    expect(
      result.report.stages.find((s) => s.stage === "openai_market_reaction")
        ?.status,
    ).toBe("skipped_dependency_unavailable");
    expect(result.report.overallStatus).toBe("partial");
    expect(exitCodeForReport(result.report)).toBe(3);
    expect(existsSync(aiBriefsLatestPath(root))).toBe(false);
    expect(stageOrder).toContain("openai_official_brief");
    expect(stageOrder).not.toContain("openai_market_reaction");
  });

  it("runs reaction AI when 4A/4B present; respects max 2 events", async () => {
    const root = tempRoot();
    seedBriefsCache(root);
    seedReactionCaches(root);
    let officialCalls = 0;
    let reactionCalls = 0;
    const result = await runCatalystIntegrationSmoke({
      dataRoot: root,
      live: true,
      maxEvents: 2,
      now: new Date("2026-07-29T20:00:00.000Z"),
      env: {
        OPENAI_API_KEY: "sk-test",
        APCA_API_KEY_ID: "",
        APCA_API_SECRET_KEY: "",
      },
      officialNarrator: {
        providerId: "fake",
        async narrate(packet) {
          officialCalls += 1;
          return createFakeBriefNarrator("ok").narrate(packet);
        },
      },
      reactionNarrator: {
        providerId: "fake",
        async narrate(packet) {
          reactionCalls += 1;
          return createFakeMarketReactionNarrator("ok").narrate(packet);
        },
      },
      writeReport: false,
    });
    expect(officialCalls).toBeLessThanOrEqual(2);
    expect(reactionCalls).toBeLessThanOrEqual(2);
    expect(reactionCalls).toBeGreaterThan(0);
    expect(
      result.report.stages.find((s) => s.stage === "openai_market_reaction")
        ?.status,
    ).toBe("passed");
    expect(result.report.overallStatus).toBe("partial");
  });

  it("isolates single-event rejection; preserves production AI cache", async () => {
    const root = tempRoot();
    seedBriefsCache(root);
    writeJsonAtomic(aiBriefsLatestPath(root), {
      kind: "CatalystAiBriefsCache",
      schemaVersion: "0.1.0",
      generatedAt: "2026-07-29T19:00:00.000Z",
      provider: "prior",
      model: "prior-model",
      promptVersion: "0.1.0",
      extractorVersion: "0.1.0",
      buildStatus: "ok",
      inputRefs: [],
      briefs: [],
      usage: [],
      errors: [],
      warnings: ["keep-me"],
    });
    const before = readFileSync(aiBriefsLatestPath(root), "utf8");

    const result = await runCatalystIntegrationSmoke({
      dataRoot: root,
      live: true,
      now: new Date("2026-07-29T20:00:00.000Z"),
      env: { OPENAI_API_KEY: "sk-test" },
      officialNarrator: createFakeBriefNarrator("prohibited"),
      writeReport: false,
    });
    expect(
      result.report.stages.find((s) => s.stage === "openai_official_brief")
        ?.status,
    ).toBe("failed");
    expect(readFileSync(aiBriefsLatestPath(root), "utf8")).toBe(before);
  });

  it("invalid schema / validator rejection surface as failed with codes", async () => {
    const root = tempRoot();
    seedBriefsCache(root);
    const result = await runCatalystIntegrationSmoke({
      dataRoot: root,
      live: true,
      now: new Date("2026-07-29T20:00:00.000Z"),
      env: { OPENAI_API_KEY: "sk-test" },
      officialNarrator: createFakeBriefNarrator("invalid_json_shape"),
      writeReport: false,
    });
    const stage = result.report.stages.find(
      (s) => s.stage === "openai_official_brief",
    );
    expect(stage?.status).toMatch(/failed|unavailable/);
    expect(stage?.errorCodes.length).toBeGreaterThan(0);
  });

  it("no eligible official facts → skipped_no_eligible_input", async () => {
    const root = tempRoot();
    mkdirSync(join(root, "catalyst"), { recursive: true });
    writeJsonAtomic(briefsLatestPath(root), {
      kind: "CatalystBriefsCache",
      schemaVersion: "0.1.0",
      generatedAt: "2026-07-29T20:00:00.000Z",
      extractorVersion: "0.1.0",
      buildStatus: "ok",
      inputDocuments: [],
      briefs: [],
      revisions: [],
      errors: [],
      warnings: [],
    });
    const result = await runCatalystIntegrationSmoke({
      dataRoot: root,
      live: true,
      now: new Date("2026-07-29T20:00:00.000Z"),
      env: { OPENAI_API_KEY: "sk-test" },
      officialNarrator: createFakeBriefNarrator("ok"),
      writeReport: false,
    });
    expect(
      result.report.stages.find((s) => s.stage === "openai_official_brief")
        ?.status,
    ).toBe("skipped_no_eligible_input");
  });

  it("blocks public demo; CI with key still needs explicit live+narrator path", async () => {
    await expect(
      runCatalystIntegrationSmoke({
        publicDemo: true,
        live: true,
        env: { OPENAI_API_KEY: "sk-test", GAMMADESK_PUBLIC_DEMO: "1" },
        writeReport: false,
      }),
    ).resolves.toMatchObject({
      report: { overallStatus: "failed" },
    });
  });

  it("summary + report omit secrets", async () => {
    const root = tempRoot();
    seedBriefsCache(root);
    const result = await runCatalystIntegrationSmoke({
      dataRoot: root,
      live: true,
      now: new Date("2026-07-29T20:00:00.000Z"),
      env: { OPENAI_API_KEY: "sk-super-secret-key-value" },
      officialNarrator: createFakeBriefNarrator("ok"),
      writeReport: true,
    });
    const blob = JSON.stringify(result.report) + formatSummary(result.report).join("\n");
    expect(blob).not.toContain("sk-super-secret-key-value");
  });
});

describe("M2-5A-Lite timeout/retry classification via fake narrator", () => {
  it("maps timeout narrator failure", async () => {
    const root = tempRoot();
    seedBriefsCache(root);
    const result = await runCatalystIntegrationSmoke({
      dataRoot: root,
      live: true,
      now: new Date("2026-07-29T20:00:00.000Z"),
      env: { OPENAI_API_KEY: "sk-test" },
      officialNarrator: createFakeBriefNarrator("timeout"),
      writeReport: false,
    });
    const codes =
      result.report.stages.find((s) => s.stage === "openai_official_brief")
        ?.errorCodes ?? [];
    expect(codes.some((c) => c === "timeout" || c === "unknown_error")).toBe(
      true,
    );
  });
});
