import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  AI_BRIEF_PROMPT_VERSION,
  AI_BRIEF_SYSTEM_PROMPT,
  BRIEF_EXTRACTOR_VERSION,
  createFakeBriefNarrator,
  createOpenAiBriefNarrator,
  enhanceOfficialBriefs,
  extractBriefFromDocument,
  loadAiBriefsCache,
  loadCatalystFeed,
  loadCatalystLlmConfig,
  resolveCatalystLlmModel,
  resolveOpenAiApiKey,
  validateAiBriefOutput,
  unavailableAiBrief,
  aiBriefIdFor,
  buildNarratorInputPacket,
  AI_NARRATOR_JSON_SCHEMA,
} from "@/catalyst";
import { AiNarratorOutput, OfficialAiBrief } from "@/contracts";
import type { OfficialBrief, OfficialDocument } from "@/contracts";
import { documentContentHash } from "@/catalyst/documents/hash";
import { FOMC_MAINTAIN, CPI_BODY } from "../fixtures/catalyst/briefs/sample-bodies";
import syntheticAiBriefs from "../fixtures/catalyst/synthetic-ai-briefs.json";

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "gammadesk-m23c-"));
}

function makeDoc(
  partial: Omit<OfficialDocument, "schemaVersion" | "contentHash"> & {
    contentHash?: string;
  },
): OfficialDocument {
  const contentHash =
    partial.contentHash ??
    documentContentHash({
      title: partial.title,
      contentText: partial.contentText,
      summaryFromSource: partial.summaryFromSource,
    });
  return {
    schemaVersion: "0.1.0",
    ...partial,
    contentHash,
  };
}

function sampleBrief(now = "2026-07-29T19:00:00.000Z"): OfficialBrief {
  return extractBriefFromDocument(
    makeDoc({
      id: "odoc_fomc_m",
      provider: "federal_reserve",
      sourceName: "Federal Reserve",
      canonicalUrl:
        "https://www.federalreserve.gov/newsevents/pressreleases/monetary20260729a.htm",
      title: "Federal Reserve issues FOMC statement",
      publishedAt: "2026-07-29T18:00:00.000Z",
      observedAt: "2026-07-29T18:05:00.000Z",
      documentType: "fomc_statement",
      releaseFamily: "fomc_policy",
      contentText: FOMC_MAINTAIN,
      synthetic: false,
    }),
    now,
  );
}

function cpiBrief(now = "2026-07-29T19:00:00.000Z"): OfficialBrief {
  return extractBriefFromDocument(
    makeDoc({
      id: "odoc_cpi",
      provider: "bls",
      sourceName: "BLS",
      canonicalUrl: "https://www.bls.gov/news.release/cpi.nr0.htm",
      title: "Consumer Price Index — June 2026",
      publishedAt: "2026-07-15T12:30:00.000Z",
      observedAt: "2026-07-15T12:35:00.000Z",
      documentType: "cpi_release",
      releaseFamily: "cpi",
      referencePeriod: "2026-06",
      contentText: CPI_BODY,
      synthetic: false,
    }),
    now,
  );
}

function env( partial: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return { ...process.env, ...partial };
}

describe("LLM config (no hardcoding in business helpers)", () => {
  it("resolves model from env or config default", () => {
    expect(resolveCatalystLlmModel(env({ CATALYST_LLM_MODEL: "" }))).toBe(
      "gpt-5.6-luna",
    );
    expect(resolveCatalystLlmModel(env({ CATALYST_LLM_MODEL: "gpt-test" }))).toBe(
      "gpt-test",
    );
    expect(resolveOpenAiApiKey(env({ OPENAI_API_KEY: "" }))).toBeNull();
    expect(resolveOpenAiApiKey(env({ OPENAI_API_KEY: " sk-test " }))).toBe(
      "sk-test",
    );
    const cfg = loadCatalystLlmConfig(
      env({ CATALYST_LLM_MODEL: "custom-model", OPENAI_API_KEY: "" }),
    );
    expect(cfg.model).toBe("custom-model");
    expect(cfg.apiKey).toBeNull();
  });
});

describe("prompt + structured schema", () => {
  it("exposes versioned system prompt rules", () => {
    expect(AI_BRIEF_PROMPT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(AI_BRIEF_SYSTEM_PROMPT).toMatch(/supplied facts/i);
    expect(AI_BRIEF_SYSTEM_PROMPT).toMatch(/hawkish/i);
    expect(AI_BRIEF_SYSTEM_PROMPT).toMatch(/factIds/i);
    expect(AI_NARRATOR_JSON_SCHEMA.additionalProperties).toBe(false);
  });

  it("parses strict narrator output and rejects invalid JSON shape", () => {
    const ok = AiNarratorOutput.safeParse({
      headline: "FOMC maintained range",
      bullets: [
        { id: "b1", text: "Maintained 4.25–4.50", factIds: ["f1"] },
        { id: "b2", text: "Vote 9–3", factIds: ["f2"] },
      ],
      limitations: [],
    });
    expect(ok.success).toBe(true);

    const bad = AiNarratorOutput.safeParse({
      headline: "x",
      bullets: [{ id: "b1", text: "only one", factIds: ["f1"] }],
      limitations: [],
    });
    expect(bad.success).toBe(false);

    const noCite = AiNarratorOutput.safeParse({
      headline: "x",
      bullets: [
        { id: "b1", text: "a", factIds: [] },
        { id: "b2", text: "b", factIds: ["f1"] },
      ],
      limitations: [],
    });
    expect(noCite.success).toBe(false);
  });

  it("builds input packet without full contentText", () => {
    const brief = sampleBrief();
    const packet = buildNarratorInputPacket(brief, {
      provider: "federal_reserve",
      publishedAt: "2026-07-29T18:00:00.000Z",
      sourceName: "Federal Reserve",
    });
    const serialized = JSON.stringify(packet);
    expect(serialized).not.toMatch(/contentText/);
    expect(packet.facts.length).toBeGreaterThan(0);
    expect(packet.facts[0]?.evidenceExcerpt.length).toBeGreaterThan(0);
  });
});

describe("local AI brief validation", () => {
  const generatedAt = "2026-07-29T20:00:00.000Z";

  it("accepts grounded rewrite", () => {
    const input = sampleBrief();
    const out = validateAiBriefOutput({
      input,
      output: {
        headline: `${input.releaseFamily} update`,
        bullets: [
          {
            id: "b1",
            text: input.facts[0]!.text,
            factIds: [input.facts[0]!.id],
          },
          {
            id: "b2",
            text: input.facts[1]!.text,
            factIds: [input.facts[1]!.id],
          },
        ],
        limitations:
          input.status === "partial"
            ? ["Summary is incomplete because the source brief is partial."]
            : [],
      },
      provider: "fake",
      model: "fake-model",
      generatedAt,
    });
    expect(out.status).toBe(input.status === "partial" ? "partial" : "complete");
    expect(out.validation.errors).toEqual([]);
    expect(out.documentContentHash).toBe(input.documentContentHash);
    expect(out.extractorVersion).toBe(input.extractorVersion);
  });

  it("rejects unknown factIds, missing citations, hallucinated numbers", () => {
    const input = sampleBrief();
    const unknown = validateAiBriefOutput({
      input,
      output: {
        headline: "x",
        bullets: [
          { id: "b1", text: input.facts[0]!.text, factIds: ["nope"] },
          { id: "b2", text: input.facts[0]!.text, factIds: [input.facts[0]!.id] },
        ],
        limitations: ["incomplete"],
      },
      provider: "fake",
      model: "m",
      generatedAt,
    });
    expect(unknown.status).toBe("rejected");
    expect(unknown.validation.citationsValid).toBe(false);

    const noCite = validateAiBriefOutput({
      input,
      output: {
        headline: "x",
        bullets: [
          { id: "b1", text: input.facts[0]!.text, factIds: [] },
          { id: "b2", text: input.facts[0]!.text, factIds: [input.facts[0]!.id] },
        ],
        limitations: ["incomplete"],
      },
      provider: "fake",
      model: "m",
      generatedAt,
    });
    expect(noCite.status).toBe("rejected");

    const hallu = validateAiBriefOutput({
      input,
      output: {
        headline: "Payrolls 999999",
        bullets: [
          {
            id: "b1",
            text: "Payrolls surged by 999999 thousand.",
            factIds: [input.facts[0]!.id],
          },
          {
            id: "b2",
            text: input.facts[0]!.text,
            factIds: [input.facts[0]!.id],
          },
        ],
        limitations: ["incomplete"],
      },
      provider: "fake",
      model: "m",
      generatedAt,
    });
    expect(hallu.status).toBe("rejected");
    expect(hallu.validation.numbersValid).toBe(false);
  });

  it("rejects prohibited inference and beat/miss vs consensus", () => {
    const input = cpiBrief();
    const prohibited = validateAiBriefOutput({
      input,
      output: {
        headline: "Hawkish CPI print",
        bullets: [
          {
            id: "b1",
            text: "Hotter than expected inflation kept markets bearish.",
            factIds: [input.facts[0]!.id],
          },
          {
            id: "b2",
            text: input.facts[0]!.text,
            factIds: [input.facts[0]!.id],
          },
        ],
        limitations: [],
      },
      provider: "fake",
      model: "m",
      generatedAt,
    });
    expect(prohibited.status).toBe("rejected");
    expect(prohibited.validation.prohibitedInferenceDetected).toBe(true);

    const beat = validateAiBriefOutput({
      input,
      output: {
        headline: "CPI",
        bullets: [
          {
            id: "b1",
            text: "The print beat consensus expectations handily.",
            factIds: [input.facts[0]!.id],
          },
          {
            id: "b2",
            text: input.facts[0]!.text,
            factIds: [input.facts[0]!.id],
          },
        ],
        limitations: [],
      },
      provider: "fake",
      model: "m",
      generatedAt,
    });
    expect(beat.status).toBe("rejected");
  });

  it("inherits partial status and requires incompleteness limitation", () => {
    const input = sampleBrief();
    expect(input.status).toBe("partial");
    const missingLim = validateAiBriefOutput({
      input,
      output: {
        headline: "x",
        bullets: [
          {
            id: "b1",
            text: input.facts[0]!.text,
            factIds: [input.facts[0]!.id],
          },
          {
            id: "b2",
            text: input.facts[1]!.text,
            factIds: [input.facts[1]!.id],
          },
        ],
        limitations: [],
      },
      provider: "fake",
      model: "m",
      generatedAt,
    });
    expect(missingLim.status).toBe("rejected");

    const ok = validateAiBriefOutput({
      input,
      output: {
        headline: "x",
        bullets: [
          {
            id: "b1",
            text: input.facts[0]!.text,
            factIds: [input.facts[0]!.id],
          },
          {
            id: "b2",
            text: input.facts[1]!.text,
            factIds: [input.facts[1]!.id],
          },
        ],
        limitations: ["Summary is incomplete / partial."],
      },
      provider: "fake",
      model: "m",
      generatedAt,
    });
    expect(ok.status).toBe("partial");
  });

  it("rejects unexpected reference period entity", () => {
    const input = cpiBrief();
    const bad = validateAiBriefOutput({
      input,
      output: {
        headline: "CPI",
        bullets: [
          {
            id: "b1",
            text: `Figures for 2025-01 show ${input.facts[0]!.text}`,
            factIds: [input.facts[0]!.id],
          },
          {
            id: "b2",
            text: input.facts[0]!.text,
            factIds: [input.facts[0]!.id],
          },
        ],
        limitations: [],
      },
      provider: "fake",
      model: "m",
      generatedAt,
    });
    expect(bad.status).toBe("rejected");
    expect(bad.validation.errors.some((e) => e.includes("period"))).toBe(true);
  });

  it("unavailable helper marks status unavailable", () => {
    const u = unavailableAiBrief({
      input: sampleBrief(),
      provider: "openai",
      model: "gpt-5.6-luna",
      generatedAt,
      error: "OPENAI_API_KEY missing — AI brief unavailable",
    });
    expect(u.status).toBe("unavailable");
    expect(u.bullets).toEqual([]);
  });
});

describe("OpenAI narrator adapter (fake fetch)", () => {
  it("returns unavailable without API key", async () => {
    const narrator = createOpenAiBriefNarrator({
      config: loadCatalystLlmConfig(env({}), { apiKey: null, model: "gpt-test" }),
    });
    const result = await narrator.narrate(
      buildNarratorInputPacket(sampleBrief(), {
        provider: "federal_reserve",
        publishedAt: "2026-07-29T18:00:00.000Z",
        sourceName: "Federal Reserve",
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.unavailable).toBe(true);
      expect(result.error).toMatch(/OPENAI_API_KEY/);
    }
  });

  it("parses structured Responses API payload and retries once on failure", async () => {
    const input = sampleBrief();
    const packet = buildNarratorInputPacket(input, {
      provider: "federal_reserve",
      publishedAt: "2026-07-29T18:00:00.000Z",
      sourceName: "Federal Reserve",
    });
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return new Response("server error", { status: 500 });
      }
      const body = {
        output_text: JSON.stringify({
          headline: input.facts[0]!.text.slice(0, 40),
          bullets: [
            {
              id: "b1",
              text: input.facts[0]!.text,
              factIds: [input.facts[0]!.id],
            },
            {
              id: "b2",
              text: input.facts[1]!.text,
              factIds: [input.facts[1]!.id],
            },
          ],
          limitations: ["Summary is incomplete because the source brief is partial."],
        }),
        usage: { input_tokens: 11, output_tokens: 22, total_tokens: 33 },
      };
      return new Response(JSON.stringify(body), { status: 200 });
    });

    const narrator = createOpenAiBriefNarrator({
      config: loadCatalystLlmConfig(env({}), {
        apiKey: "sk-test",
        model: "gpt-test",
        maxRetries: 1,
      }),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await narrator.narrate(packet);
    expect(result.ok).toBe(true);
    expect(calls).toBe(2);
    if (result.ok) {
      expect(result.usage?.totalTokens).toBe(33);
    }
  });

  it("surfaces timeout errors", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      await new Promise<void>((_, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
      return new Response("{}", { status: 200 });
    });
    const narrator = createOpenAiBriefNarrator({
      config: loadCatalystLlmConfig(env({}), {
        apiKey: "sk-test",
        model: "gpt-test",
        timeoutMs: 5,
        maxRetries: 0,
      }),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await narrator.narrate(
      buildNarratorInputPacket(sampleBrief(), {
        provider: "federal_reserve",
        publishedAt: "2026-07-29T18:00:00.000Z",
        sourceName: "Federal Reserve",
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/timed out/i);
  });
});

describe("enhance workflow + cache", () => {
  it("uses fake narrator; caches successfully; second run is idempotent", async () => {
    const root = tempRoot();
    mkdirSync(join(root, "catalyst"), { recursive: true });
    const brief = sampleBrief();
    const now = new Date("2026-07-29T21:00:00.000Z");
    const first = await enhanceOfficialBriefs({
      dataRoot: root,
      write: true,
      now,
      briefs: [brief],
      publishedAtByDocumentId: new Map([
        [brief.documentId, "2026-07-29T18:00:00.000Z"],
      ]),
      narrator: createFakeBriefNarrator("ok", "fake-model"),
      config: { model: "fake-model", apiKey: "unused" },
    });
    expect(first.path).toBeTruthy();
    expect(first.cache.briefs[0]?.status).toBe("partial");
    expect(first.cache.briefs[0]?.validation.errors).toEqual([]);
    expect(existsSync(first.path!)).toBe(true);

    const second = await enhanceOfficialBriefs({
      dataRoot: root,
      write: true,
      now: new Date("2026-07-29T22:00:00.000Z"),
      briefs: [brief],
      publishedAtByDocumentId: new Map([
        [brief.documentId, "2026-07-29T18:00:00.000Z"],
      ]),
      narrator: createFakeBriefNarrator("ok", "fake-model"),
      config: { model: "fake-model", apiKey: "unused" },
    });
    expect(second.cache.briefs[0]?.id).toBe(first.cache.briefs[0]?.id);
    expect(second.cache.briefs[0]?.generatedAt).toBe(
      first.cache.briefs[0]?.generatedAt,
    );
  });

  it("invalidates when prompt version / model / document hash changes", async () => {
    const root = tempRoot();
    const brief = sampleBrief();
    const now = new Date("2026-07-29T21:00:00.000Z");
    await enhanceOfficialBriefs({
      dataRoot: root,
      write: true,
      now,
      briefs: [brief],
      publishedAtByDocumentId: new Map([
        [brief.documentId, "2026-07-29T18:00:00.000Z"],
      ]),
      narrator: createFakeBriefNarrator("ok", "model-a"),
      config: { model: "model-a", apiKey: "x" },
    });
    const changed = await enhanceOfficialBriefs({
      dataRoot: root,
      write: true,
      now: new Date("2026-07-29T22:00:00.000Z"),
      briefs: [brief],
      publishedAtByDocumentId: new Map([
        [brief.documentId, "2026-07-29T18:00:00.000Z"],
      ]),
      narrator: createFakeBriefNarrator("ok", "model-b"),
      config: { model: "model-b", apiKey: "x" },
    });
    expect(changed.cache.briefs[0]?.model).toBe("model-b");
    expect(changed.cache.briefs[0]?.id).toBe(
      aiBriefIdFor({
        inputBriefId: brief.id,
        documentContentHash: brief.documentContentHash,
        extractorVersion: brief.extractorVersion,
        promptVersion: AI_BRIEF_PROMPT_VERSION,
        model: "model-b",
      }),
    );

    const staleHash = {
      ...brief,
      documentContentHash: "a".repeat(64),
    };
    const regen = await enhanceOfficialBriefs({
      dataRoot: root,
      write: true,
      force: true,
      now: new Date("2026-07-29T23:00:00.000Z"),
      briefs: [staleHash],
      publishedAtByDocumentId: new Map([
        [brief.documentId, "2026-07-29T18:00:00.000Z"],
      ]),
      narrator: createFakeBriefNarrator("ok", "model-b"),
      config: { model: "model-b", apiKey: "x" },
    });
    expect(regen.cache.briefs[0]?.documentContentHash).toBe("a".repeat(64));
  });

  it("rejects hallucinated / bad citation via fake narrator; isolates failures", async () => {
    const root = tempRoot();
    const a = sampleBrief();
    const b = cpiBrief();
    const result = await enhanceOfficialBriefs({
      dataRoot: root,
      write: true,
      now: new Date("2026-07-29T21:00:00.000Z"),
      briefs: [a, b],
      publishedAtByDocumentId: new Map([
        [a.documentId, "2026-07-29T18:00:00.000Z"],
        [b.documentId, "2026-07-15T12:30:00.000Z"],
      ]),
      narrator: {
        providerId: "fake",
        async narrate(packet) {
          if (packet.briefId === a.id) {
            return createFakeBriefNarrator("hallucinated_number").narrate(packet);
          }
          return createFakeBriefNarrator("ok").narrate(packet);
        },
      },
      config: { model: "fake-model", apiKey: "x" },
    });
    const byInput = new Map(result.cache.briefs.map((x) => [x.inputBriefId, x]));
    expect(byInput.get(a.id)?.status).toBe("rejected");
    expect(byInput.get(b.id)?.status).toBe("complete");
    expect(result.cache.buildStatus).toBe("partial");
  });

  it("provider-wide failure preserves prior good cache on disk", async () => {
    const root = tempRoot();
    const brief = sampleBrief();
    const now = new Date("2026-07-29T21:00:00.000Z");
    const good = await enhanceOfficialBriefs({
      dataRoot: root,
      write: true,
      now,
      briefs: [brief],
      publishedAtByDocumentId: new Map([
        [brief.documentId, "2026-07-29T18:00:00.000Z"],
      ]),
      narrator: createFakeBriefNarrator("ok"),
      config: { model: "fake-model", apiKey: "x" },
      force: true,
    });
    expect(good.path).toBeTruthy();
    const before = readFileSync(good.path!, "utf8");

    const failed = await enhanceOfficialBriefs({
      dataRoot: root,
      write: true,
      now: new Date("2026-07-29T22:00:00.000Z"),
      briefs: [brief],
      publishedAtByDocumentId: new Map([
        [brief.documentId, "2026-07-29T18:00:00.000Z"],
      ]),
      narrator: createFakeBriefNarrator("provider_error"),
      config: { model: "fake-model", apiKey: "x" },
      force: true,
    });
    expect(failed.path).toBeNull();
    expect(failed.cache.buildStatus).toBe("failed");
    expect(readFileSync(good.path!, "utf8")).toBe(before);
  });

  it("no-key unavailable without wiping prior cache", async () => {
    const root = tempRoot();
    const brief = sampleBrief();
    const good = await enhanceOfficialBriefs({
      dataRoot: root,
      write: true,
      now: new Date("2026-07-29T21:00:00.000Z"),
      briefs: [brief],
      publishedAtByDocumentId: new Map([
        [brief.documentId, "2026-07-29T18:00:00.000Z"],
      ]),
      narrator: createFakeBriefNarrator("ok"),
      config: { model: "fake-model", apiKey: "x" },
    });
    const before = readFileSync(good.path!, "utf8");

    const missing = await enhanceOfficialBriefs({
      dataRoot: root,
      write: true,
      now: new Date("2026-07-29T22:00:00.000Z"),
      briefs: [brief],
      publishedAtByDocumentId: new Map([
        [brief.documentId, "2026-07-29T18:00:00.000Z"],
      ]),
      config: { model: "gpt-5.6-luna", apiKey: null },
      // no narrator → OpenAI path, no key
    });
    expect(missing.cache.buildStatus).toBe("unavailable");
    expect(missing.path).toBeNull();
    expect(readFileSync(good.path!, "utf8")).toBe(before);
    const loaded = loadAiBriefsCache({ dataRoot: root });
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.cache.briefs[0]?.status).toBe("partial");
    }
  });

  it("records usage when provided and tolerates missing usage", async () => {
    const root = tempRoot();
    const brief = sampleBrief();
    const withUsage = await enhanceOfficialBriefs({
      dataRoot: root,
      write: true,
      now: new Date("2026-07-29T21:00:00.000Z"),
      briefs: [brief],
      publishedAtByDocumentId: new Map([
        [brief.documentId, "2026-07-29T18:00:00.000Z"],
      ]),
      narrator: createFakeBriefNarrator("ok"),
      config: { model: "fake-model", apiKey: "x" },
      force: true,
    });
    expect(withUsage.cache.usage.length).toBeGreaterThan(0);

    const noUsageNarrator = {
      providerId: "fake",
      async narrate(packet: Parameters<ReturnType<typeof createFakeBriefNarrator>["narrate"]>[0]) {
        const r = await createFakeBriefNarrator("ok").narrate(packet);
        if (!r.ok) return r;
        return { ok: true as const, output: r.output, provider: r.provider, model: r.model };
      },
    };
    const without = await enhanceOfficialBriefs({
      dataRoot: root,
      write: true,
      now: new Date("2026-07-29T22:00:00.000Z"),
      briefs: [brief],
      publishedAtByDocumentId: new Map([
        [brief.documentId, "2026-07-29T18:00:00.000Z"],
      ]),
      narrator: noUsageNarrator,
      config: { model: "fake-model", apiKey: "x" },
      force: true,
    });
    expect(without.cache.briefs[0]?.status).toBe("partial");
  });

  it("refuses public demo enhance", async () => {
    await expect(
      enhanceOfficialBriefs({
        publicDemo: true,
        write: false,
        briefs: [sampleBrief()],
        narrator: createFakeBriefNarrator("ok"),
      }),
    ).rejects.toThrow(/public demo/i);
  });

  it("skips unavailable deterministic briefs", async () => {
    const unavailable: OfficialBrief = {
      ...sampleBrief(),
      status: "unavailable",
      facts: [],
      headline: "unavailable",
    };
    const result = await enhanceOfficialBriefs({
      dataRoot: tempRoot(),
      write: false,
      now: new Date("2026-07-29T21:00:00.000Z"),
      briefs: [unavailable],
      narrator: createFakeBriefNarrator("ok"),
      config: { model: "fake-model", apiKey: "x" },
    });
    expect(result.cache.briefs.length).toBe(0);
  });
});

describe("public demo isolation + fixtures", () => {
  it("serves synthetic AI briefs with Demo label contract fields", () => {
    const feed = loadCatalystFeed(
      {},
      { publicDemo: true, now: new Date("2026-07-29T20:00:00.000Z") },
    );
    expect(feed.source.aiBriefs?.status).toBe("synthetic");
    expect(feed.aiBriefs?.length).toBeGreaterThan(0);
    for (const b of feed.aiBriefs ?? []) {
      expect(b.synthetic).toBe(true);
      expect(b.provider).toBe("synthetic_fixture");
      expect(b.validation.errors).toEqual([]);
      expect(b.status === "complete" || b.status === "partial").toBe(true);
      for (const bullet of b.bullets) {
        expect(bullet.factIds.length).toBeGreaterThan(0);
      }
    }
    expect(feed.disclaimer).toMatch(/Demo AI briefs|AI briefs/i);
    expect(feed.disclaimer).toMatch(/not live LLM/i);
  });

  it("checked-in fixture parses as OfficialAiBrief and stays synthetic", () => {
    for (const b of syntheticAiBriefs.briefs) {
      const parsed = OfficialAiBrief.safeParse(b);
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.synthetic).toBe(true);
    }
  });

  it("rejects stale document hash at feed boundary", () => {
    const feed = loadCatalystFeed(
      {},
      { publicDemo: true, now: new Date("2026-07-29T20:00:00.000Z") },
    );
    const brief = feed.briefs?.[0];
    const ai = feed.aiBriefs?.find((a) => a.inputBriefId === brief?.id);
    expect(brief && ai).toBeTruthy();
    if (brief && ai) {
      expect(ai.documentContentHash).toBe(brief.documentContentHash);
      expect(ai.extractorVersion).toBe(brief.extractorVersion);
      expect(ai.extractorVersion).toBe(BRIEF_EXTRACTOR_VERSION);
    }
  });

  it("public demo never reads gitignored AI cache (synthetic fixtures only)", () => {
    const feed = loadCatalystFeed(
      {},
      { publicDemo: true, now: new Date("2026-07-29T20:00:00.000Z") },
    );
    expect(feed.mode).toBe("synthetic_demo");
    expect(feed.source.type).toBe("fixture");
    expect(feed.source.aiBriefs?.status).toBe("synthetic");
    for (const b of feed.aiBriefs ?? []) {
      expect(b.provider).not.toBe("openai");
      expect(b.synthetic).toBe(true);
    }
  });
});

describe("UI fallback contract", () => {
  it("exposes AI briefs separately from deterministic briefs", () => {
    const feed = loadCatalystFeed(
      {},
      { publicDemo: true, now: new Date("2026-07-29T20:00:00.000Z") },
    );
    expect(feed.briefs?.length).toBeGreaterThan(0);
    expect(feed.aiBriefs?.length).toBeGreaterThan(0);
    // Rejected/unavailable AI must not appear in feed.aiBriefs
    for (const a of feed.aiBriefs ?? []) {
      expect(["complete", "partial"]).toContain(a.status);
    }
  });
});

describe("fake narrator modes", () => {
  it.each([
    ["bad_citation", "rejected"],
    ["no_citation", "rejected"],
    ["prohibited", "rejected"],
    ["beat_miss", "rejected"],
  ] as const)("%s → %s", async (mode, status) => {
    const brief = sampleBrief();
    const result = await enhanceOfficialBriefs({
      dataRoot: tempRoot(),
      write: false,
      now: new Date("2026-07-29T21:00:00.000Z"),
      briefs: [brief],
      publishedAtByDocumentId: new Map([
        [brief.documentId, "2026-07-29T18:00:00.000Z"],
      ]),
      narrator: createFakeBriefNarrator(mode),
      config: { model: "fake-model", apiKey: "x" },
    });
    expect(result.cache.briefs[0]?.status).toBe(status);
  });
});
