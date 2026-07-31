import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ESTIMATED_GAMMA_SCHEMA_VERSION,
  EstimatedGammaStructure,
  GEX_METHODOLOGY_VERSION,
} from "@/contracts";
import {
  computeEstimatedGammaStructure,
  FixtureOptionsChainProvider,
  loadOptionsChainFixtureFile,
  normalizeShareOfGrossGex,
  parseOptionsChainFixture,
  SHARE_OF_GROSS_GEX_EPS,
} from "@/gamma";

describe("M4-1B contract versions", () => {
  it("bumps schema and methodology for shareOfGrossGex contract", () => {
    expect(ESTIMATED_GAMMA_SCHEMA_VERSION).toBe("0.1.1");
    expect(GEX_METHODOLOGY_VERSION).toBe("0.1.1");
    const out = computeEstimatedGammaStructure({
      kind: "OptionsChainSnapshot",
      underlying: "TEST",
      asOf: "2026-07-29T15:00:00.000Z",
      sessionDate: "2026-07-29",
      spot: 100,
      dataDelay: "fixture",
      source: {
        provider: "fixture",
        name: "inline",
        fetchedAt: "2026-07-29T15:00:00.000Z",
      },
      contracts: [
        {
          symbol: "T",
          underlying: "TEST",
          expiry: "2026-07-29",
          strike: 100,
          right: "call",
          openInterest: 10,
          gamma: 0.01,
          multiplier: 100,
        },
      ],
      synthetic: true,
    });
    expect(out.schemaVersion).toBe("0.1.1");
    expect(out.methodology.version).toBe("0.1.1");
    expect(EstimatedGammaStructure.safeParse(out).success).toBe(true);
  });
});

describe("M4-1B shareOfGrossGex bounds", () => {
  it("normalizes values within float epsilon of 0 and 1", () => {
    expect(normalizeShareOfGrossGex(0)).toBe(0);
    expect(normalizeShareOfGrossGex(SHARE_OF_GROSS_GEX_EPS / 2)).toBe(0);
    expect(normalizeShareOfGrossGex(1)).toBe(1);
    expect(normalizeShareOfGrossGex(1 - SHARE_OF_GROSS_GEX_EPS / 2)).toBe(1);
    expect(normalizeShareOfGrossGex(0.42)).toBe(0.42);
  });

  it("rejects shares outside [0, 1] beyond epsilon", () => {
    expect(() => normalizeShareOfGrossGex(-0.01)).toThrow(/out of range/i);
    expect(() => normalizeShareOfGrossGex(1.01)).toThrow(/out of range/i);
  });

  it("rejects invalid payload share via Zod", () => {
    const base = computeEstimatedGammaStructure({
      kind: "OptionsChainSnapshot",
      underlying: "TEST",
      asOf: "2026-07-29T15:00:00.000Z",
      sessionDate: "2026-07-29",
      spot: 100,
      dataDelay: "fixture",
      source: {
        provider: "fixture",
        name: "inline",
        fetchedAt: "2026-07-29T15:00:00.000Z",
      },
      contracts: [
        {
          symbol: "T",
          underlying: "TEST",
          expiry: "2026-07-29",
          strike: 100,
          right: "call",
          openInterest: 10,
          gamma: 0.01,
          multiplier: 100,
        },
      ],
      synthetic: true,
    });
    const bad = {
      ...base,
      zeroDte: { ...base.zeroDte, shareOfGrossGex: 1.5 },
    };
    expect(EstimatedGammaStructure.safeParse(bad).success).toBe(false);
  });
});

describe("M4-1B fixture provider errors", () => {
  it("returns null for a missing fixture file", () => {
    const provider = new FixtureOptionsChainProvider(
      join(process.cwd(), "fixtures/gamma/does-not-exist"),
    );
    expect(
      provider.loadChain({ underlying: "SPX", sessionDate: "2099-01-01" }),
    ).toBeNull();
  });

  it("propagates parse errors with fixture path context", () => {
    const dir = mkdtempSync(join(tmpdir(), "gammadesk-gamma-m41b-"));
    const file = join(dir, "spx.2026-07-29.json");
    writeFileSync(file, "{ not valid json");
    expect(() => loadOptionsChainFixtureFile(file)).toThrow(
      /options chain fixture.*invalid JSON/i,
    );
    expect(() => loadOptionsChainFixtureFile(file)).toThrow(file);
  });

  it("propagates validation errors with fixture path context", () => {
    const dir = mkdtempSync(join(tmpdir(), "gammadesk-gamma-m41b-"));
    const file = join(dir, "spx.2026-07-29.json");
    writeFileSync(
      file,
      JSON.stringify({
        underlying: "SPX",
        asOf: "2026-07-29T14:30:00.000Z",
        sessionDate: "2026-07-29",
        spot: 100,
        dataDelay: "not_a_delay",
        source: {
          provider: "fixture",
          name: "bad",
          fetchedAt: "2026-07-29T14:30:00.000Z",
        },
        contracts: [],
        synthetic: true,
      }),
    );
    expect(() => loadOptionsChainFixtureFile(file)).toThrow(
      /options chain fixture.*dataDelay/i,
    );
  });

  it("throws on malformed contract rows via provider when file exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "gammadesk-gamma-m41b-"));
    const file = join(dir, "spx.2026-07-29.json");
    writeFileSync(
      file,
      JSON.stringify({
        underlying: "SPX",
        asOf: "2026-07-29T14:30:00.000Z",
        sessionDate: "2026-07-29",
        spot: 100,
        dataDelay: "fixture",
        source: {
          provider: "fixture",
          name: "bad",
          fetchedAt: "2026-07-29T14:30:00.000Z",
        },
        contracts: [{ strike: 100 }],
        synthetic: true,
      }),
    );
    const provider = new FixtureOptionsChainProvider(dir);
    expect(() =>
      provider.loadChain({ underlying: "SPX", sessionDate: "2026-07-29" }),
    ).toThrow(/options chain fixture.*contracts\[0\]/i);
  });

  it("parseOptionsChainFixture still throws without path prefix", () => {
    expect(() => parseOptionsChainFixture(null)).toThrow(/root must be an object/);
  });
});
