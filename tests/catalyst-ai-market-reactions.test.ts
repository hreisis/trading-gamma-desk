import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  AI_REACTION_NARRATOR_JSON_SCHEMA,
  AI_REACTION_PROMPT_VERSION,
  AI_REACTION_SYSTEM_PROMPT,
  buildReactionNarratorPacket,
  classifyMarketReaction,
  createFakeMarketReactionNarrator,
  createOpenAiMarketReactionNarrator,
  enhanceMarketReactions,
  loadAiMarketReactionsCache,
  loadCatalystFeed,
  loadCatalystReactionLlmConfig,
  marketContextIdentity,
  marketReactionIdentity,
  resolveCatalystReactionLlmModel,
  resolveOpenAiApiKey,
  unavailableAiMarketReaction,
  validateAiMarketReactionOutput,
  aiMarketReactionIdFor,
} from "@/catalyst";
import { writeJsonAtomic } from "@/desk/atomic-write";
import {
  AiMarketReactionNarratorOutput,
  AiMarketReactionNarrative,
  type EventMarketContext,
} from "@/contracts";
import { marketContextLatestPath } from "@/catalyst/market-context/paths";
import { marketReactionsLatestPath } from "@/catalyst/market-reactions/paths";
import { aiMarketReactionsLatestPath } from "@/catalyst/market-reactions/ai/paths";
import syntheticAiMarketReactions from "../fixtures/catalyst/synthetic-ai-market-reactions.json";

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "gammadesk-m24c-"));
}

function env(partial: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return { ...process.env, ...partial };
}

function samplePair(now = "2026-07-29T20:00:00.000Z"): {
  context: EventMarketContext;
  reaction: ReturnType<typeof classifyMarketReaction>;
} {
  const feed = loadCatalystFeed(
    {},
    {
      forceSynthetic: true,
      publicDemo: true,
      now: new Date(now),
    },
  );
  const context = feed.marketContext![0]!;
  const reaction = classifyMarketReaction(context, { generatedAt: now });
  return { context, reaction };
}

describe("M2-4C LLM config", () => {
  it("resolves model from env or config default (not hardcoded in callers)", () => {
    expect(
      resolveCatalystReactionLlmModel(env({ CATALYST_REACTION_LLM_MODEL: "" })),
    ).toBe("gpt-5.6-luna");
    expect(
      resolveCatalystReactionLlmModel(
        env({ CATALYST_REACTION_LLM_MODEL: "gpt-test-rxn" }),
      ),
    ).toBe("gpt-test-rxn");
    expect(resolveOpenAiApiKey(env({ OPENAI_API_KEY: "" }))).toBeNull();
    const cfg = loadCatalystReactionLlmConfig(
      env({ CATALYST_REACTION_LLM_MODEL: "custom", OPENAI_API_KEY: "" }),
    );
    expect(cfg.model).toBe("custom");
    expect(cfg.apiKey).toBeNull();
    expect(cfg.maxConcurrency).toBe(2);
    expect(cfg.maxPerRun).toBe(12);
    expect(cfg.maxOutputTokens).toBe(800);
  });
});

describe("M2-4C prompt + schema", () => {
  it("exposes versioned system rules and strict schema", () => {
    expect(AI_REACTION_PROMPT_VERSION).toBe("0.1.0");
    expect(AI_REACTION_SYSTEM_PROMPT).toMatch(/supplied evidence/i);
    expect(AI_REACTION_SYSTEM_PROMPT).toMatch(/because/i);
    expect(AI_REACTION_SYSTEM_PROMPT).toMatch(/hawkish/i);
    expect(AI_REACTION_SYSTEM_PROMPT).toMatch(/DXY/i);
    expect(AI_REACTION_NARRATOR_JSON_SCHEMA.additionalProperties).toBe(false);
  });

  it("parses valid structured output and rejects invalid shapes", () => {
    const ok = AiMarketReactionNarratorOutput.safeParse({
      headline: "Observed ETF proxy moves around the release",
      bullets: [
        {
          id: "b1",
          text: "At +30m, equity ETF proxies were mixed.",
          evidenceIds: ["reaction:30m:equityBreadth"],
        },
        {
          id: "b2",
          text: "Over the observed window, SPY ETF proxy changed 0.1%.",
          evidenceIds: ["context:SPY:30m:changePct"],
        },
      ],
      limitations: [],
    });
    expect(ok.success).toBe(true);

    const bad = AiMarketReactionNarratorOutput.safeParse({
      headline: "x",
      bullets: [{ id: "b1", text: "only one", evidenceIds: ["e1"] }],
      limitations: [],
    });
    expect(bad.success).toBe(false);

    const noCite = AiMarketReactionNarratorOutput.safeParse({
      headline: "x",
      bullets: [
        { id: "b1", text: "a", evidenceIds: [] },
        { id: "b2", text: "b", evidenceIds: ["e1"] },
      ],
      limitations: [],
    });
    expect(noCite.success).toBe(false);
  });
});

describe("M2-4C local validation", () => {
  const generatedAt = "2026-07-29T20:00:00.000Z";

  it("accepts grounded rewrite", async () => {
    const { context, reaction } = samplePair();
    const ctxId = marketContextIdentity(context);
    const rxnId = marketReactionIdentity(reaction);
    const packet = buildReactionNarratorPacket(context, reaction, ctxId, rxnId);
    const narrated = await createFakeMarketReactionNarrator("ok").narrate(
      packet,
    );
    expect(narrated.ok).toBe(true);
    if (!narrated.ok) return;
    const validated = validateAiMarketReactionOutput({
      context,
      reaction,
      evidence: packet.evidence,
      marketContextIdentity: ctxId,
      marketReactionIdentity: rxnId,
      output: narrated.output,
      provider: "fake",
      model: "fake-model",
      generatedAt,
      synthetic: true,
      usage: narrated.usage,
    });
    expect(validated.status).toBe(
      reaction.status === "partial" ? "partial" : "complete",
    );
    expect(validated.validationErrors).toEqual([]);
    expect(validated.headline).toBeTruthy();
    expect(validated.bullets?.length).toBeGreaterThanOrEqual(2);
    expect(
      AiMarketReactionNarrative.safeParse(validated).success,
    ).toBe(true);
  });

  it("rejects unknown evidence IDs, missing citations, and hallucinated numbers", async () => {
    const { context, reaction } = samplePair();
    const ctxId = marketContextIdentity(context);
    const rxnId = marketReactionIdentity(reaction);
    const packet = buildReactionNarratorPacket(context, reaction, ctxId, rxnId);

    for (const mode of [
      "bad_citation",
      "no_citation",
      "hallucinated_number",
    ] as const) {
      const narrated = await createFakeMarketReactionNarrator(mode).narrate(
        packet,
      );
      expect(narrated.ok).toBe(true);
      if (!narrated.ok) continue;
      const validated = validateAiMarketReactionOutput({
        context,
        reaction,
        evidence: packet.evidence,
        marketContextIdentity: ctxId,
        marketReactionIdentity: rxnId,
        output: narrated.output,
        provider: "fake",
        model: "fake-model",
        generatedAt,
      });
      expect(validated.status).toBe("rejected");
      expect(validated.headline).toBeUndefined();
      expect(validated.bullets).toBeUndefined();
      expect(validated.validationErrors.length).toBeGreaterThan(0);
    }
  });

  it("rejects causal, tone, and bad entity rewrites", async () => {
    const { context, reaction } = samplePair();
    const ctxId = marketContextIdentity(context);
    const rxnId = marketReactionIdentity(reaction);
    const packet = buildReactionNarratorPacket(context, reaction, ctxId, rxnId);

    for (const mode of [
      "prohibited_causal",
      "prohibited_tone",
      "entity_yield",
      "entity_dxy",
      "mismatch_breadth",
    ] as const) {
      const narrated = await createFakeMarketReactionNarrator(mode).narrate(
        packet,
      );
      expect(narrated.ok).toBe(true);
      if (!narrated.ok) continue;
      const validated = validateAiMarketReactionOutput({
        context,
        reaction,
        evidence: packet.evidence,
        marketContextIdentity: ctxId,
        marketReactionIdentity: rxnId,
        output: narrated.output,
        provider: "fake",
        model: "fake-model",
        generatedAt,
      });
      expect(validated.status).toBe("rejected");
    }
  });

  it("rejects stale identity and rules-version mismatch via identity fields", () => {
    const { context, reaction } = samplePair();
    const ctxId = marketContextIdentity(context);
    const rxnId = marketReactionIdentity(reaction);
    const packet = buildReactionNarratorPacket(context, reaction, ctxId, rxnId);
    const validated = validateAiMarketReactionOutput({
      context,
      reaction,
      evidence: packet.evidence,
      marketContextIdentity: "stale-context-identity",
      marketReactionIdentity: rxnId,
      output: {
        headline: "Observed ETF proxy moves around the release",
        bullets: [
          {
            id: "b1",
            text: "At +30m, equity ETF proxy breadth was mixed.",
            evidenceIds: [packet.evidence[0]!.evidenceId],
          },
          {
            id: "b2",
            text: "Over the observed window, ETF proxy moves were recorded.",
            evidenceIds: [packet.evidence[1]!.evidenceId],
          },
        ],
        limitations: [],
      },
      provider: "fake",
      model: "fake-model",
      generatedAt,
    });
    expect(validated.status).toBe("rejected");
    expect(validated.validationErrors.join(" ")).toMatch(/identity/i);
  });

  it("inherits partial status from partial input", async () => {
    const { context, reaction } = samplePair();
    const partialCtx: EventMarketContext = {
      ...context,
      status: "partial",
    };
    const partialReaction = classifyMarketReaction(partialCtx, {
      generatedAt,
    });
    const ctxId = marketContextIdentity(partialCtx);
    const rxnId = marketReactionIdentity(partialReaction);
    const packet = buildReactionNarratorPacket(
      partialCtx,
      partialReaction,
      ctxId,
      rxnId,
    );
    const narrated = await createFakeMarketReactionNarrator("ok").narrate(
      packet,
    );
    expect(narrated.ok).toBe(true);
    if (!narrated.ok) return;
    const validated = validateAiMarketReactionOutput({
      context: partialCtx,
      reaction: partialReaction,
      evidence: packet.evidence,
      marketContextIdentity: ctxId,
      marketReactionIdentity: rxnId,
      output: narrated.output,
      provider: "fake",
      model: "fake-model",
      generatedAt,
    });
    expect(validated.status).toBe("partial");
  });

  it("builds stable ids excluding generatedAt/usage", () => {
    const a = aiMarketReactionIdFor({
      catalystId: "cat_x",
      marketContextIdentity: "c1",
      marketReactionIdentity: "r1",
      reactionRulesVersion: "0.1.0",
      promptVersion: "0.1.0",
      model: "m",
    });
    const b = aiMarketReactionIdFor({
      catalystId: "cat_x",
      marketContextIdentity: "c1",
      marketReactionIdentity: "r1",
      reactionRulesVersion: "0.1.0",
      promptVersion: "0.1.0",
      model: "m",
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^aimrxn_/);
  });
});

describe("M2-4C OpenAI narrator adapter", () => {
  it("returns unavailable without API key (no synthetic fake)", async () => {
    const narrator = createOpenAiMarketReactionNarrator({
      config: loadCatalystReactionLlmConfig(
        env({ OPENAI_API_KEY: "", CATALYST_REACTION_LLM_MODEL: "gpt-test" }),
      ),
    });
    const { context, reaction } = samplePair();
    const packet = buildReactionNarratorPacket(
      context,
      reaction,
      marketContextIdentity(context),
      marketReactionIdentity(reaction),
    );
    const result = await narrator.narrate(packet);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.unavailable).toBe(true);
    expect(result.error).toMatch(/OPENAI_API_KEY/i);
  });

  it("retries once then fails on timeout; isolates provider errors", async () => {
    const fetchImpl = vi.fn(async () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    });
    const narrator = createOpenAiMarketReactionNarrator({
      config: {
        ...loadCatalystReactionLlmConfig(
          env({ OPENAI_API_KEY: "sk-test", CATALYST_REACTION_LLM_MODEL: "m" }),
        ),
        timeoutMs: 1,
        maxRetries: 1,
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const { context, reaction } = samplePair();
    const packet = buildReactionNarratorPacket(
      context,
      reaction,
      marketContextIdentity(context),
      marketReactionIdentity(reaction),
    );
    const result = await narrator.narrate(packet);
    expect(result.ok).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("M2-4C enhance cache workflow", () => {
  it("no-key returns unavailable without writing fake cache", async () => {
    const root = tempRoot();
    const { context, reaction } = samplePair();
    writeJsonAtomic(marketContextLatestPath(root), {
      kind: "CatalystMarketContextCache",
      schemaVersion: "0.1.0",
      fetchedAt: "2026-07-29T20:00:00.000Z",
      provider: "fake",
      feed: "sip",
      calculationVersion: "0.1.0",
      buildStatus: "ok",
      inputRefs: [],
      snapshots: [context],
      revisions: [],
      errors: [],
      warnings: [],
    });
    writeJsonAtomic(marketReactionsLatestPath(root), {
      kind: "CatalystMarketReactionsCache",
      schemaVersion: "0.1.0",
      generatedAt: "2026-07-29T20:00:00.000Z",
      reactionRulesVersion: "0.1.0",
      buildStatus: "ok",
      inputRefs: [],
      reactions: [reaction],
      revisions: [],
      errors: [],
      warnings: [],
    });

    const { cache, path } = await enhanceMarketReactions({
      dataRoot: root,
      write: true,
      now: new Date("2026-07-29T20:00:00.000Z"),
      config: { apiKey: null, model: "gpt-test" },
    });
    expect(cache.buildStatus).toBe("unavailable");
    expect(path).toBeNull();
    expect(existsSync(aiMarketReactionsLatestPath(root))).toBe(false);
  });

  it("idempotent reuse + --force revision + atomic write", async () => {
    const root = tempRoot();
    const { context, reaction } = samplePair();
    const now = new Date("2026-07-29T20:00:00.000Z");
    const first = await enhanceMarketReactions({
      dataRoot: root,
      write: true,
      now,
      contexts: [context],
      reactions: [reaction],
      narrator: createFakeMarketReactionNarrator("ok", "fake-model"),
      config: { apiKey: "unused", model: "fake-model" },
    });
    expect(first.path).toBeTruthy();
    expect(first.cache.narratives[0]?.status).toMatch(/complete|partial/);

    const second = await enhanceMarketReactions({
      dataRoot: root,
      write: true,
      now: new Date("2026-07-29T21:00:00.000Z"),
      contexts: [context],
      reactions: [reaction],
      narrator: createFakeMarketReactionNarrator("ok", "fake-model"),
      config: { apiKey: "unused", model: "fake-model" },
    });
    expect(second.cache.narratives[0]?.id).toBe(first.cache.narratives[0]?.id);
    expect(second.cache.narratives[0]?.generatedAt).toBe(
      first.cache.narratives[0]?.generatedAt,
    );

    const forced = await enhanceMarketReactions({
      dataRoot: root,
      write: true,
      force: true,
      now: new Date("2026-07-29T22:00:00.000Z"),
      contexts: [context],
      reactions: [reaction],
      narrator: createFakeMarketReactionNarrator("ok", "fake-model"),
      config: { apiKey: "unused", model: "fake-model" },
    });
    expect(forced.cache.revisions.length).toBeGreaterThan(0);
    expect(forced.cache.narratives[0]?.generatedAt).toBe(
      "2026-07-29T22:00:00.000Z",
    );

    const loaded = loadAiMarketReactionsCache({ dataRoot: root, now });
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.cache.promptVersion).toBe(AI_REACTION_PROMPT_VERSION);
    }
  });

  it("invalidates on model/prompt change; preserves prior on provider-wide failure", async () => {
    const root = tempRoot();
    const { context, reaction } = samplePair();
    const now = new Date("2026-07-29T20:00:00.000Z");
    await enhanceMarketReactions({
      dataRoot: root,
      write: true,
      now,
      contexts: [context],
      reactions: [reaction],
      narrator: createFakeMarketReactionNarrator("ok", "model-a"),
      config: { apiKey: "unused", model: "model-a" },
    });
    const prior = readFileSync(aiMarketReactionsLatestPath(root), "utf8");

    const changed = await enhanceMarketReactions({
      dataRoot: root,
      write: true,
      now: new Date("2026-07-29T21:00:00.000Z"),
      contexts: [context],
      reactions: [reaction],
      narrator: createFakeMarketReactionNarrator("ok", "model-b"),
      config: { apiKey: "unused", model: "model-b" },
    });
    expect(changed.cache.narratives[0]?.model).toBe("model-b");
    expect(changed.cache.narratives[0]?.id).not.toBe(
      JSON.parse(prior).narratives[0].id,
    );

    const failed = await enhanceMarketReactions({
      dataRoot: root,
      write: true,
      force: true,
      now: new Date("2026-07-29T22:00:00.000Z"),
      contexts: [context],
      reactions: [reaction],
      narrator: createFakeMarketReactionNarrator("provider_error", "model-b"),
      config: { apiKey: "unused", model: "model-b" },
    });
    expect(failed.path).toBeNull();
    expect(readFileSync(aiMarketReactionsLatestPath(root), "utf8")).toContain(
      "model-b",
    );
    expect(failed.cache.warnings.join(" ")).toMatch(/untouched/i);
  });

  it("allows missing usage metadata; isolates single-event rejection", async () => {
    const { context, reaction } = samplePair();
    const result = await enhanceMarketReactions({
      dataRoot: tempRoot(),
      write: true,
      now: new Date("2026-07-29T20:00:00.000Z"),
      contexts: [context],
      reactions: [reaction],
      narrator: {
        providerId: "fake",
        async narrate(packet) {
          const base = await createFakeMarketReactionNarrator("ok").narrate(
            packet,
          );
          if (!base.ok) return base;
          return {
            ok: true,
            output: base.output,
            provider: "fake",
            model: "fake-model",
          };
        },
      },
      config: { apiKey: "unused", model: "fake-model" },
    });
    expect(result.cache.narratives[0]?.usage).toBeUndefined();

    const mixed = await enhanceMarketReactions({
      dataRoot: tempRoot(),
      write: true,
      now: new Date("2026-07-29T20:00:00.000Z"),
      contexts: [context],
      reactions: [reaction],
      narrator: createFakeMarketReactionNarrator("prohibited_causal"),
      config: { apiKey: "unused", model: "fake-model" },
    });
    expect(mixed.cache.narratives[0]?.status).toBe("rejected");
    expect(mixed.path).toBeTruthy();
  });

  it("refuses public-demo enhance", async () => {
    await expect(
      enhanceMarketReactions({
        publicDemo: true,
        contexts: [],
        reactions: [],
        narrator: createFakeMarketReactionNarrator(),
      }),
    ).rejects.toThrow(/public demo/i);
  });
});

describe("M2-4C public demo isolation", () => {
  it("serves synthetic AI reaction fixtures without network", () => {
    const feed = loadCatalystFeed({}, { publicDemo: true });
    expect(feed.source.aiMarketReactions?.status).toBe("synthetic");
    expect(feed.aiMarketReactions?.length).toBeGreaterThan(0);
    for (const n of feed.aiMarketReactions ?? []) {
      expect(n.synthetic).toBe(true);
      expect(n.status).toMatch(/complete|partial/);
      expect(n.provider).toBe("synthetic_fixture");
    }
    const batch = syntheticAiMarketReactions as {
      narratives: unknown[];
      disclaimer: string;
    };
    expect(batch.disclaimer).toMatch(/Synthetic/i);
    expect(batch.narratives.length).toBeGreaterThan(0);
  });

  it("keeps unavailableAiMarketReaction without fake prose", () => {
    const { context, reaction } = samplePair();
    const u = unavailableAiMarketReaction({
      context,
      reaction,
      marketContextIdentity: marketContextIdentity(context),
      marketReactionIdentity: marketReactionIdentity(reaction),
      provider: "openai",
      model: "gpt-test",
      generatedAt: "2026-07-29T20:00:00.000Z",
      error: "OPENAI_API_KEY missing",
    });
    expect(u.status).toBe("unavailable");
    expect(u.headline).toBeUndefined();
    expect(u.bullets).toBeUndefined();
  });
});
