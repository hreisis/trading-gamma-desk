import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FIXTURE_DRIVER_PATH,
  deskSourceLabel,
  formatConfidenceScore,
  formatSignedChange,
  formatZScore,
  isFallbackRegime,
  loadMacroDesk,
  sessionBannerText,
  writeJsonAtomic,
  writePipelineError,
  writePipelineOk,
} from "@/desk";
import { interpretAndWriteDriver } from "@/pipeline";

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "gammadesk-m110-"));
}

function copyFixtureDriver(root: string, session: string): string {
  const dir = join(root, "drivers");
  mkdirSync(dir, { recursive: true });
  const raw = JSON.parse(readFileSync(FIXTURE_DRIVER_PATH, "utf8")) as {
    marketSessionDate: string;
  };
  raw.marketSessionDate = session;
  const path = join(dir, `${session}.json`);
  writeFileSync(path, JSON.stringify(raw, null, 2) + "\n");
  return path;
}

describe("loadMacroDesk provenance", () => {
  it("uses demo fixture when no live drivers exist", () => {
    const root = tempRoot();
    const view = loadMacroDesk({
      dataRoot: root,
      fixturePath: FIXTURE_DRIVER_PATH,
    });
    expect(view.status).toBe("ready");
    expect(view.source).toBe("fixture");
    expect(view.isDemo).toBe(true);
    expect(view.sourceLabel).toBe("demo · fixture fallback");
    expect(view.driver?.confidence.calibrated).toBe(false);
  });

  it("prefers live driver over fixture", () => {
    const root = tempRoot();
    copyFixtureDriver(root, "2026-07-28");
    const view = loadMacroDesk({
      dataRoot: root,
      fixturePath: FIXTURE_DRIVER_PATH,
    });
    expect(view.source).toBe("local_driver");
    expect(view.isDemo).toBe(false);
    expect(view.sourceLabel).toBe("live driver");
    expect(view.driverPath).toContain("2026-07-28.json");
  });

  it("never silently falls back to fixture when latest live driver is malformed", () => {
    const root = tempRoot();
    copyFixtureDriver(root, "2026-07-27");
    const badPath = join(root, "drivers", "2026-07-28.json");
    writeFileSync(badPath, "{ not-valid-dominant-driver\n");

    const view = loadMacroDesk({
      dataRoot: root,
      fixturePath: FIXTURE_DRIVER_PATH,
    });

    expect(view.status).toBe("malformed");
    expect(view.isDemo).toBe(false);
    expect(view.source).toBe("local_driver");
    expect(view.error?.code).toBe("malformed");
    expect(view.driver?.marketSessionDate).toBe("2026-07-27");
    expect(view.sessionStale).toBe(true);
    expect(view.driverPath).toContain("2026-07-27.json");
  });

  it("reports empty when live-only and no drivers exist", () => {
    const root = tempRoot();
    const view = loadMacroDesk({
      dataRoot: root,
      fixturePath: FIXTURE_DRIVER_PATH,
      allowFixture: false,
    });
    expect(view.status).toBe("empty");
    expect(view.driver).toBeNull();
    expect(view.isDemo).toBe(false);
  });

  it("surfaces pipeline error while keeping the last good driver", () => {
    const root = tempRoot();
    const path = copyFixtureDriver(root, "2026-07-28");
    writePipelineError({
      dataRoot: root,
      stage: "ingest",
      error: "Tiingo timeout",
      attemptedSession: "2026-07-29",
      lastGoodSession: "2026-07-28",
      lastGoodDriverPath: path,
    });

    const view = loadMacroDesk({
      dataRoot: root,
      fixturePath: FIXTURE_DRIVER_PATH,
    });
    expect(view.status).toBe("pipeline_error");
    expect(view.driver).not.toBeNull();
    expect(view.error?.code).toBe("pipeline");
    expect(view.error?.message).toMatch(/Tiingo timeout/);
    expect(view.sessionStale).toBe(true);
    expect(view.isDemo).toBe(false);
  });

  it("honors preferFixture for manual demo acceptance", () => {
    const root = tempRoot();
    copyFixtureDriver(root, "2026-07-28");
    const view = loadMacroDesk({
      dataRoot: root,
      fixturePath: FIXTURE_DRIVER_PATH,
      preferFixture: true,
    });
    expect(view.isDemo).toBe(true);
    expect(view.source).toBe("fixture");
    expect(deskSourceLabel("fixture")).toBe("demo · fixture fallback");
  });
});

describe("atomic driver write", () => {
  it("replaces a driver only after a full write", () => {
    const root = tempRoot();
    const path = join(root, "drivers", "2026-07-28.json");
    writeJsonAtomic(path, { ok: true, n: 1 });
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ ok: true, n: 1 });
    writeJsonAtomic(path, { ok: true, n: 2 });
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ ok: true, n: 2 });
  });

  it("leaves the previous driver intact when interpret fails", () => {
    const root = tempRoot();
    const good = copyFixtureDriver(root, "2026-07-28");
    const before = readFileSync(good, "utf8");
    mkdirSync(join(root, "snapshots"), { recursive: true });
    writeFileSync(
      join(root, "snapshots", "2026-07-29.json"),
      JSON.stringify({ kind: "not-a-snapshot" }),
    );

    expect(() =>
      interpretAndWriteDriver({
        dataRoot: root,
        session: "2026-07-29",
        updatePipelineStatus: true,
      }),
    ).toThrow();

    expect(readFileSync(good, "utf8")).toBe(before);
    expect(
      loadMacroDesk({ dataRoot: root, fixturePath: FIXTURE_DRIVER_PATH }).driver
        ?.marketSessionDate,
    ).toBe("2026-07-28");
  });

  it("records pipeline ok after a successful status write helper", () => {
    const root = tempRoot();
    const path = copyFixtureDriver(root, "2026-07-28");
    writePipelineOk({
      dataRoot: root,
      stage: "interpret",
      session: "2026-07-28",
      driverPath: path,
    });
    const view = loadMacroDesk({
      dataRoot: root,
      fixturePath: FIXTURE_DRIVER_PATH,
    });
    expect(view.pipeline?.ok).toBe(true);
    expect(view.status).toBe("ready");
  });
});

describe("desk confidence copy", () => {
  it("marks uncalibrated scores and never invents band labels", () => {
    const root = tempRoot();
    const view = loadMacroDesk({
      dataRoot: root,
      fixturePath: FIXTURE_DRIVER_PATH,
    });
    expect(view.driver).not.toBeNull();
    const text = formatConfidenceScore(view.driver!.confidence);
    expect(text).toBe("60/100 (uncalibrated)");
    expect(text.toLowerCase()).not.toMatch(/\b(high|medium|low)\b/);
  });

  it("formats moves and z-scores for display only", () => {
    expect(formatSignedChange(-8, "bps")).toBe("−8 bps");
    expect(formatSignedChange(2.4, "pct")).toBe("+2.40%");
    expect(formatZScore(-1.8)).toBe("−1.80");
    expect(formatZScore(null)).toBe("—");
  });

  it("uses the incomplete-session banner when alignment is not clean", () => {
    const root = tempRoot();
    const view = loadMacroDesk({
      dataRoot: root,
      fixturePath: FIXTURE_DRIVER_PATH,
    });
    const incomplete = {
      ...view.driver!,
      isCompleteSession: false,
      sessionAlignment: "partial" as const,
    };
    expect(sessionBannerText(incomplete)).toMatch(
      /^Latest complete macro snapshot/,
    );
    expect(isFallbackRegime("mixed_unresolved")).toBe(true);
    expect(isFallbackRegime("fed_rates")).toBe(false);
  });
});
