import { mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildMarketReactions,
  classifyDirection,
  classifyEquityBreadth,
  classifyEquityLeadership,
  classifyDevelopmentPath,
  classifyMarketReaction,
  DEADBAND_PCT,
  deadbandFor,
  formatCrossAssetSignatureText,
  LEADERSHIP_THRESHOLD_PCT,
  loadCatalystFeed,
  marketContextIdentity,
  REACTION_RULES_VERSION,
} from "@/catalyst";
import { writeJsonAtomic } from "@/desk/atomic-write";
import type { EventMarketContext } from "@/contracts";
import { EventMarketReaction } from "@/contracts";
import { marketContextLatestPath } from "@/catalyst/market-context/paths";

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "gammadesk-m24b-"));
}

function baseCtx(
  overrides: Partial<EventMarketContext> & {
    symbols: EventMarketContext["symbols"];
  },
): EventMarketContext {
  return {
    schemaVersion: "0.1.0",
    id: "mctx_test",
    catalystId: "cat_test",
    eventTimestamp: "2026-07-15T12:30:00.000Z",
    provider: "fake",
    feed: "sip",
    calculationVersion: "0.1.0",
    timeframe: "1Min",
    timezone: "America/New_York",
    status: "complete",
    fetchedAt: "2026-07-15T20:00:00.000Z",
    session: {
      easternDate: "2026-07-15",
      timezone: "America/New_York",
      isHoliday: false,
      isWeekend: false,
      isEarlyClose: false,
      regularSessionOpenEt: "09:30",
      regularSessionCloseEt: "16:00",
      eventInPremarket: true,
      eventInRegularSession: false,
    },
    errors: [],
    synthetic: false,
    ...overrides,
  };
}

function sym(
  symbol: string,
  pcts: {
    plus5m?: number | null;
    plus30m?: number | null;
    plus2h?: number | null;
    sessionClose?: number | null;
  },
  label = `${symbol} ETF proxy`,
): EventMarketContext["symbols"][number] {
  const mk = (kind: "plus5m" | "plus30m" | "plus2h" | "sessionClose", pct: number | null | undefined) => {
    if (pct === null || pct === undefined) {
      return {
        kind,
        status: "unavailable" as const,
        pctChange: null,
      };
    }
    return {
      kind,
      status: "available" as const,
      price: 100 + pct,
      barTimestamp: "2026-07-15T13:00:00.000Z",
      pctChange: pct,
    };
  };
  return {
    symbol,
    instrumentLabel: label,
    proxyRole: symbol,
    baseline: {
      price: 100,
      barTimestamp: "2026-07-15T12:29:00.000Z",
    },
    windows: [
      mk("plus5m", pcts.plus5m),
      mk("plus30m", pcts.plus30m),
      mk("plus2h", pcts.plus2h),
      mk("sessionClose", pcts.sessionClose),
    ],
    missingWindows: [],
  };
}

describe("atomic direction + deadbands", () => {
  it("classifies up/down/flat/unavailable with boundary = flat", () => {
    expect(classifyDirection(0.06, 0.05)).toBe("up");
    expect(classifyDirection(-0.06, 0.05)).toBe("down");
    expect(classifyDirection(0.05, 0.05)).toBe("flat");
    expect(classifyDirection(-0.05, 0.05)).toBe("flat");
    expect(classifyDirection(0.049, 0.05)).toBe("flat");
    expect(classifyDirection(null, 0.05)).toBe("unavailable");
  });

  it("uses symbol- and window-specific deadbands", () => {
    expect(deadbandFor("SPY", "5m")).toBe(DEADBAND_PCT.equity["5m"]);
    expect(deadbandFor("TLT", "5m")).toBe(DEADBAND_PCT.treasury["5m"]);
    expect(deadbandFor("UUP", "session_close")).toBe(
      DEADBAND_PCT.dollar.session_close,
    );
    expect(deadbandFor("SPY", "5m")).not.toBe(deadbandFor("SPY", "session_close"));
  });
});

describe("equity breadth", () => {
  it("requires majority without opposite moves", () => {
    expect(classifyEquityBreadth(["up", "up", "up"])).toBe("broadly_higher");
    expect(classifyEquityBreadth(["up", "up", "flat"])).toBe("broadly_higher");
    expect(classifyEquityBreadth(["down", "down", "flat"])).toBe("broadly_lower");
    expect(classifyEquityBreadth(["up", "down", "flat"])).toBe("mixed");
    expect(classifyEquityBreadth(["flat", "flat", "flat"])).toBe("flat");
    expect(classifyEquityBreadth(["up", "flat", "flat"])).toBe("unavailable");
    expect(classifyEquityBreadth(["up", "unavailable", "unavailable"])).toBe(
      "unavailable",
    );
    // Only QQQ up is never broadly_higher
    expect(classifyEquityBreadth(["flat", "up", "flat"])).toBe("unavailable");
    expect(classifyEquityBreadth(["up", "up"])).toBe("broadly_higher");
    expect(classifyEquityBreadth(["up", "flat"])).toBe("unavailable");
  });
});

describe("leadership", () => {
  it("applies explicit threshold and mixed conflicts", () => {
    expect(LEADERSHIP_THRESHOLD_PCT).toBe(0.1);
    expect(
      classifyEquityLeadership({
        spyPct: 0.2,
        qqqPct: 0.45,
        iwmPct: 0.22,
      }).status,
    ).toBe("nasdaq_proxy_leads");
    expect(
      classifyEquityLeadership({
        spyPct: 0.2,
        qqqPct: 0.22,
        iwmPct: 0.45,
      }).status,
    ).toBe("small_cap_proxy_leads");
    expect(
      classifyEquityLeadership({
        spyPct: 0.2,
        qqqPct: 0.22,
        iwmPct: 0.21,
      }).status,
    ).toBe("no_clear_leader");
    expect(
      classifyEquityLeadership({
        spyPct: 0.2,
        qqqPct: 0.5,
        iwmPct: 0.5,
      }).status,
    ).toBe("mixed");
    expect(
      classifyEquityLeadership({
        spyPct: null,
        qqqPct: 0.5,
        iwmPct: 0.5,
      }).status,
    ).toBe("unavailable");
  });
});

describe("development path", () => {
  it("classifies extended/held/faded/reversed", () => {
    expect(
      classifyDevelopmentPath({
        earlierPct: 0.2,
        laterPct: 0.4,
        earlierDirection: "up",
        laterDirection: "up",
      }),
    ).toBe("extended");
    expect(
      classifyDevelopmentPath({
        earlierPct: 0.2,
        laterPct: 0.21,
        earlierDirection: "up",
        laterDirection: "up",
      }),
    ).toBe("held");
    expect(
      classifyDevelopmentPath({
        earlierPct: 0.4,
        laterPct: 0.2,
        earlierDirection: "up",
        laterDirection: "up",
      }),
    ).toBe("faded");
    expect(
      classifyDevelopmentPath({
        earlierPct: 0.3,
        laterPct: -0.3,
        earlierDirection: "up",
        laterDirection: "down",
      }),
    ).toBe("reversed");
    expect(
      classifyDevelopmentPath({
        earlierPct: null,
        laterPct: 0.2,
        earlierDirection: "unavailable",
        laterDirection: "up",
      }),
    ).toBe("unavailable");
  });
});

describe("full classification", () => {
  it("produces complete reaction with observations and no banned phrasing", () => {
    const ctx = baseCtx({
      symbols: [
        sym("SPY", { plus5m: 0.2, plus30m: 0.35, plus2h: 0.5, sessionClose: 0.2 }),
        sym("QQQ", {
          plus5m: 0.25,
          plus30m: 0.5,
          plus2h: 0.8,
          sessionClose: 0.3,
        }),
        sym("IWM", {
          plus5m: 0.18,
          plus30m: 0.32,
          plus2h: 0.45,
          sessionClose: 0.15,
        }),
        sym("TLT", {
          plus5m: -0.2,
          plus30m: -0.25,
          plus2h: -0.3,
          sessionClose: -0.2,
        }),
        sym("UUP", {
          plus5m: 0.1,
          plus30m: 0.12,
          plus2h: 0.15,
          sessionClose: 0.1,
        }),
        sym("GLD", {
          plus5m: 0.02,
          plus30m: 0.03,
          plus2h: 0.04,
          sessionClose: 0.02,
        }),
      ],
    });
    const reaction = classifyMarketReaction(ctx, {
      generatedAt: "2026-07-15T21:00:00.000Z",
    });
    expect(EventMarketReaction.safeParse(reaction).success).toBe(true);
    expect(reaction.status).toBe("complete");
    expect(reaction.reactionRulesVersion).toBe(REACTION_RULES_VERSION);
    expect(reaction.marketContextIdentity).toBe(marketContextIdentity(ctx));
    expect(reaction.officialFactsIdentity.length).toBeGreaterThan(0);
    expect(reaction.officialFactsIdentity).toContain(ctx.catalystId);
    const w30 = reaction.windows.find((w) => w.window === "30m")!;
    expect(w30.equityBreadth).toBe("broadly_higher");
    expect(w30.crossAssetSignature.longTreasuryEtf).toBe("down");
    expect(w30.crossAssetSignature.dollarEtf).toBe("up");
    expect(formatCrossAssetSignatureText(w30.crossAssetSignature)).toMatch(
      /Long Treasury ETF lower/,
    );
    expect(formatCrossAssetSignatureText(w30.crossAssetSignature)).not.toMatch(
      /yield/i,
    );
    expect(reaction.observations.length).toBeGreaterThan(0);
    expect(reaction.observations.length).toBeLessThanOrEqual(4);
    for (const o of reaction.observations) {
      expect(o.ruleId.length).toBeGreaterThan(0);
      expect(o.text).not.toMatch(/liked|disliked|bullish|bearish|risk-on|risk-off|because/i);
      expect(o.sourceValues).toBeTruthy();
    }
    expect(reaction.development.from5mTo30m).not.toBe("unavailable");
  });

  it("marks insufficient when all windows missing", () => {
    const ctx = baseCtx({
      status: "unavailable",
      symbols: [
        sym("SPY", {}),
        sym("QQQ", {}),
        sym("IWM", {}),
        sym("TLT", {}),
        sym("UUP", {}),
        sym("GLD", {}),
      ],
    });
    // clear baselines to force unavailable
    for (const s of ctx.symbols) {
      (s as { baseline: null }).baseline = null;
      s.windows = s.windows.map((w) => ({
        ...w,
        status: "unavailable" as const,
        pctChange: null,
      }));
    }
    const reaction = classifyMarketReaction(ctx, {
      generatedAt: "2026-07-15T21:00:00.000Z",
    });
    expect(reaction.status).toBe("insufficient");
  });

  it("disables intoSessionClose when close is before event", () => {
    const ctx = baseCtx({
      eventTimestamp: "2026-07-15T21:00:00.000Z",
      session: {
        easternDate: "2026-07-15",
        timezone: "America/New_York",
        isHoliday: false,
        isWeekend: false,
        isEarlyClose: false,
        regularSessionOpenEt: "09:30",
        regularSessionCloseEt: "16:00",
        eventInPremarket: false,
        eventInRegularSession: false,
      },
      symbols: [
        sym("SPY", { plus5m: 0.2, plus30m: 0.3, plus2h: 0.4, sessionClose: 0.5 }),
        sym("QQQ", { plus5m: 0.2, plus30m: 0.3, plus2h: 0.4, sessionClose: 0.5 }),
        sym("IWM", { plus5m: 0.2, plus30m: 0.3, plus2h: 0.4, sessionClose: 0.5 }),
        sym("TLT", { plus5m: 0.1, plus30m: 0.1, plus2h: 0.1, sessionClose: 0.1 }),
        sym("UUP", { plus5m: 0.1, plus30m: 0.1, plus2h: 0.1, sessionClose: 0.1 }),
        sym("GLD", { plus5m: 0.1, plus30m: 0.1, plus2h: 0.1, sessionClose: 0.1 }),
      ],
    });
    // session close bar timestamp earlier than event
    for (const s of ctx.symbols) {
      const close = s.windows.find((w) => w.kind === "sessionClose")!;
      (close as { barTimestamp: string }).barTimestamp =
        "2026-07-15T19:59:00.000Z";
    }
    const reaction = classifyMarketReaction(ctx, {
      generatedAt: "2026-07-15T22:00:00.000Z",
    });
    expect(reaction.development.intoSessionClose).toBe("unavailable");
  });
});

describe("build cache", () => {
  it("is idempotent on identity; force rebuilds; rules version is identity", () => {
    const root = tempRoot();
    mkdirSync(join(root, "catalyst"), { recursive: true });
    const ctx = baseCtx({
      symbols: [
        sym("SPY", { plus5m: 0.2, plus30m: 0.3, plus2h: 0.4, sessionClose: 0.5 }),
        sym("QQQ", { plus5m: 0.2, plus30m: 0.3, plus2h: 0.4, sessionClose: 0.5 }),
        sym("IWM", { plus5m: 0.2, plus30m: 0.3, plus2h: 0.4, sessionClose: 0.5 }),
        sym("TLT", { plus5m: -0.2, plus30m: -0.2, plus2h: -0.2, sessionClose: -0.2 }),
        sym("UUP", { plus5m: 0.1, plus30m: 0.1, plus2h: 0.1, sessionClose: 0.1 }),
        sym("GLD", { plus5m: 0.02, plus30m: 0.02, plus2h: 0.02, sessionClose: 0.02 }),
      ],
    });
    writeJsonAtomic(marketContextLatestPath(root), {
      kind: "CatalystMarketContextCache",
      schemaVersion: "0.1.0",
      fetchedAt: "2026-07-29T18:00:00.000Z",
      provider: "fake",
      feed: "sip",
      calculationVersion: "0.1.0",
      buildStatus: "ok",
      inputRefs: [],
      snapshots: [ctx],
      revisions: [],
      errors: [],
      warnings: [],
    });

    const first = buildMarketReactions({
      dataRoot: root,
      marketContextDataRoot: root,
      write: true,
      now: new Date("2026-07-29T20:00:00.000Z"),
    });
    expect(first.path).toBeTruthy();
    expect(first.cache.reactions[0]?.status).toBe("complete");

    const second = buildMarketReactions({
      dataRoot: root,
      marketContextDataRoot: root,
      write: true,
      now: new Date("2026-07-29T21:00:00.000Z"),
    });
    expect(second.cache.reactions[0]?.id).toBe(first.cache.reactions[0]?.id);
    expect(second.cache.reactions[0]?.generatedAt).toBe(
      first.cache.reactions[0]?.generatedAt,
    );

    const forced = buildMarketReactions({
      dataRoot: root,
      marketContextDataRoot: root,
      write: true,
      force: true,
      now: new Date("2026-07-29T22:00:00.000Z"),
    });
    expect(forced.cache.reactions[0]?.generatedAt).toBe(
      "2026-07-29T22:00:00.000Z",
    );
    expect(existsFile(first.path!)).toBe(true);
  });

  it("rebuilds when officialFactsIdentity changes", () => {
    const root = tempRoot();
    const ctx = baseCtx({
      symbols: [
        sym("SPY", {
          plus5m: 0.2,
          plus30m: 0.25,
          plus2h: 0.3,
          sessionClose: 0.2,
        }),
        sym("QQQ", {
          plus5m: 0.22,
          plus30m: 0.28,
          plus2h: 0.32,
          sessionClose: 0.22,
        }),
        sym("IWM", {
          plus5m: 0.18,
          plus30m: 0.2,
          plus2h: 0.24,
          sessionClose: 0.18,
        }),
        sym("TLT", {
          plus5m: -0.1,
          plus30m: -0.12,
          plus2h: -0.14,
          sessionClose: -0.1,
        }),
        sym("UUP", {
          plus5m: 0.05,
          plus30m: 0.06,
          plus2h: 0.07,
          sessionClose: 0.05,
        }),
        sym("GLD", {
          plus5m: 0.01,
          plus30m: 0.02,
          plus2h: 0.02,
          sessionClose: 0.01,
        }),
      ],
    });
    writeJsonAtomic(marketContextLatestPath(root), {
      kind: "CatalystMarketContextCache",
      schemaVersion: "0.1.0",
      fetchedAt: "2026-07-29T20:00:00.000Z",
      provider: "fake",
      feed: "sip",
      calculationVersion: ctx.calculationVersion,
      buildStatus: "ok",
      inputRefs: [],
      snapshots: [ctx],
      revisions: [],
      errors: [],
      warnings: [],
    });

    const first = buildMarketReactions({
      dataRoot: root,
      marketContextDataRoot: root,
      write: true,
      now: new Date("2026-07-29T20:00:00.000Z"),
      officialFactsIdentityByCatalystId: new Map([
        [ctx.catalystId, "facts-v1"],
      ]),
    });
    const second = buildMarketReactions({
      dataRoot: root,
      marketContextDataRoot: root,
      write: true,
      now: new Date("2026-07-29T21:00:00.000Z"),
      officialFactsIdentityByCatalystId: new Map([
        [ctx.catalystId, "facts-v2"],
      ]),
    });
    expect(second.cache.reactions[0]?.id).not.toBe(first.cache.reactions[0]?.id);
    expect(second.cache.reactions[0]?.officialFactsIdentity).toBe("facts-v2");
    expect(second.cache.revisions.some((r) =>
      r.reason.includes("official facts identity"),
    )).toBe(true);
  });

  it("fails clearly when market-context cache missing", () => {
    const root = tempRoot();
    expect(() =>
      buildMarketReactions({
        dataRoot: root,
        marketContextDataRoot: root,
        write: false,
        now: new Date("2026-07-29T20:00:00.000Z"),
      }),
    ).toThrow(/Cannot build market reactions/);
  });

  it("refuses public demo", () => {
    expect(() =>
      buildMarketReactions({
        publicDemo: true,
        write: false,
        snapshots: [],
      }),
    ).toThrow(/public demo/i);
  });
});

function existsFile(path: string): boolean {
  try {
    readFileSync(path);
    return true;
  } catch {
    return false;
  }
}

describe("public demo isolation", () => {
  it("derives synthetic reactions from synthetic market context", () => {
    const feed = loadCatalystFeed(
      {},
      { publicDemo: true, now: new Date("2026-07-29T20:00:00.000Z") },
    );
    expect(feed.source.marketReactions?.status).toBe("synthetic");
    expect(feed.marketReactions?.length).toBeGreaterThan(0);
    for (const r of feed.marketReactions ?? []) {
      expect(r.synthetic).toBe(true);
      expect(r.reactionRulesVersion).toBe(REACTION_RULES_VERSION);
      expect(r.status).not.toBe("insufficient");
      for (const w of r.windows) {
        for (const i of w.instruments) {
          expect(i.proxyLabel).toMatch(/ETF/);
          expect(i.proxyLabel).not.toMatch(/\bDXY\b/);
        }
      }
    }
    expect(feed.disclaimer).toMatch(/causation/i);
  });
});
