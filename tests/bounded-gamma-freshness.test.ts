import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi, beforeEach } from "vitest";
import spyFixture from "../fixtures/gamma/providers/marketdata-app/spy-bounded-ui.json";
import {
  boundedGammaFreshnessLabel,
  isBoundedGammaSessionStale,
  resolveBoundedGammaTargetSession,
  wallStrikeWhenAvailable,
} from "@/desk/bounded-gamma-freshness";
import {
  applyBoundedGammaSessionGate,
  loadBoundedGammaDeskView,
} from "@/desk/load-bounded-gamma";
import { loadBoundedGammaDeskViewAsync } from "@/desk/production-runtime";
import { runBoundedGammaProvider } from "@/gamma/marketdata-app/run";

vi.mock("@/gamma/marketdata-app/run", () => ({
  runBoundedGammaProvider: vi.fn(),
}));

const mockedRun = vi.mocked(runBoundedGammaProvider);

function snapshotWithSession(sessionDate: string, status = "available") {
  const base = {
    ...spyFixture,
    sessionDate,
    status,
    generatedAt: "2026-08-11T12:00:00.000Z",
  };
  if (status === "available") {
    return {
      ...base,
      boundedCallWall: { ...spyFixture.boundedCallWall, status: "available" },
      boundedPutWall: { ...spyFixture.boundedPutWall, status: "available" },
    };
  }
  return base;
}

function writeArtifact(root: string, symbol: string, body: unknown) {
  writeFileSync(join(root, `${symbol}-bounded-latest.json`), JSON.stringify(body));
}

describe("bounded gamma session freshness", () => {
  beforeEach(() => {
    mockedRun.mockReset();
  });

  it("marks stale when generatedAt is new but sessionDate lags target", () => {
    const view = applyBoundedGammaSessionGate(
      {
        status: "ready",
        snapshot: snapshotWithSession("2026-08-07") as never,
        withheldSnapshot: null,
        sourceLabel: "test",
        isFixture: false,
      },
      "2026-08-10",
    );
    expect(view.status).toBe("ready");
    expect(view.freshness).toBe("stale");
    expect(view.snapshot?.sessionDate).toBe("2026-08-07");
    expect(view.withheldSnapshot).toBeNull();
  });

  it("keeps incomplete as incomplete when session is fresh", () => {
    const snap = snapshotWithSession("2026-08-10", "incomplete");
    const view = applyBoundedGammaSessionGate(
      {
        status: "incomplete",
        snapshot: snap as never,
        withheldSnapshot: null,
        sourceLabel: "test",
        isFixture: false,
        freshness: "incomplete",
      },
      "2026-08-10",
    );
    expect(view.status).toBe("incomplete");
    expect(view.freshness).toBe("incomplete");
    expect(boundedGammaFreshnessLabel(snap as never, "2026-08-10")).toBe(
      "incomplete",
    );
  });

  it("refreshes on stale session then becomes ready when vendor catches up", async () => {
    const root = mkdtempSync(join(tmpdir(), "gamma-fresh-"));
    writeArtifact(root, "SPY", snapshotWithSession("2026-08-07"));

    mockedRun.mockImplementation(async (input) => {
      writeFileSync(
        join(input.dataRoot!, "SPY-bounded-latest.json"),
        JSON.stringify(snapshotWithSession("2026-08-10")),
      );
      return {
        ok: true,
        snapshot: snapshotWithSession("2026-08-10") as never,
        path: join(input.dataRoot!, "SPY-bounded-latest.json"),
        requestPath: "/options/chain/SPY",
      };
    });

    const view = await loadBoundedGammaDeskViewAsync({
      symbol: "SPY",
      dataRoot: root,
      env: { ...process.env, MARKETDATA_API_TOKEN: "test-token" },
      targetSession: "2026-08-10",
    });

    expect(mockedRun).toHaveBeenCalledOnce();
    expect(view.status).toBe("ready");
    expect(view.freshness).toBe("fresh");
    expect(view.snapshot?.sessionDate).toBe("2026-08-10");
  });

  it("fail closed when refresh still returns stale vendor session", async () => {
    const root = mkdtempSync(join(tmpdir(), "gamma-stale-"));
    writeArtifact(root, "SPY", snapshotWithSession("2026-08-07"));

    mockedRun.mockImplementation(async (input) => {
      writeFileSync(
        join(input.dataRoot!, "SPY-bounded-latest.json"),
        JSON.stringify(snapshotWithSession("2026-08-07")),
      );
      return {
        ok: true,
        snapshot: snapshotWithSession("2026-08-07") as never,
        path: join(input.dataRoot!, "SPY-bounded-latest.json"),
        requestPath: "/options/chain/SPY",
      };
    });

    const view = await loadBoundedGammaDeskViewAsync({
      symbol: "SPY",
      dataRoot: root,
      env: { ...process.env, MARKETDATA_API_TOKEN: "test-token" },
      targetSession: "2026-08-10",
    });

    expect(view.status).toBe("ready");
    expect(view.freshness).toBe("stale");
    expect(view.snapshot?.sessionDate).toBe("2026-08-07");
    expect(view.withheldSnapshot).toBeNull();
  });

  it("keeps cached snapshot when bounded refresh fails", async () => {
    const root = mkdtempSync(join(tmpdir(), "gamma-cache-"));
    writeArtifact(root, "SPY", snapshotWithSession("2026-08-07"));

    const view = await loadBoundedGammaDeskViewAsync({
      symbol: "SPY",
      dataRoot: root,
      env: { ...process.env, MARKETDATA_API_TOKEN: "" },
      targetSession: "2026-08-10",
    });

    expect(view.snapshot?.sessionDate).toBe("2026-08-07");
    expect(view.freshness).toBe("stale");
    expect(view.status).toBe("ready");
    expect(view.error?.code).toBe("refresh_failed");
  });

  it("handles SPY and QQQ independently", async () => {
    const root = mkdtempSync(join(tmpdir(), "gamma-sym-"));
    writeArtifact(root, "SPY", snapshotWithSession("2026-08-10"));
    writeArtifact(root, "QQQ", snapshotWithSession("2026-08-07"));

    const spy = loadBoundedGammaDeskView({
      symbol: "SPY",
      dataRoot: root,
      targetSession: "2026-08-10",
    });
    const qqq = loadBoundedGammaDeskView({
      symbol: "QQQ",
      dataRoot: root,
      targetSession: "2026-08-10",
    });

    expect(spy.status).toBe("ready");
    expect(qqq.status).toBe("ready");
    expect(qqq.freshness).toBe("stale");
    expect(qqq.snapshot?.sessionDate).toBe("2026-08-07");
  });

  it("resolves last completed session on weekends and before regular close", () => {
    const saturday = new Date("2026-08-08T16:00:00.000Z");
    expect(resolveBoundedGammaTargetSession(saturday)).toBe("2026-08-07");

    const mondayPremarket = new Date("2026-08-10T10:00:00.000Z");
    expect(resolveBoundedGammaTargetSession(mondayPremarket)).toBe("2026-08-07");

    const mondayAfterClose = new Date("2026-08-10T22:00:00.000Z");
    expect(resolveBoundedGammaTargetSession(mondayAfterClose)).toBe("2026-08-10");
    expect(
      isBoundedGammaSessionStale("2026-08-07", resolveBoundedGammaTargetSession(mondayAfterClose)),
    ).toBe(true);
  });

  it("returns incomplete bounded wall strikes for desk display", () => {
    const incompletePut = spyFixture.boundedPutWall;
    expect(wallStrikeWhenAvailable(incompletePut as never)).toBe(743);
    expect(wallStrikeWhenAvailable(spyFixture.boundedCallWall as never)).toBe(745);
    expect(
      wallStrikeWhenAvailable({
        status: "unavailable",
        reason: "No negative put GEX at any strike",
        scope: "bounded_single_expiry",
      }),
    ).toBeNull();
  });
});
