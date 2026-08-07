import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyCronSecret } from "@/desk/cron/verify-cron-secret";

vi.mock("@/desk/breadth/produce-daily-spy-breadth", () => ({
  produceDailySpyBreadth: vi.fn(async () => ({
    status: "published",
    marketSessionDate: "2026-08-06",
    snapshotIdentity: "2026-08-06_20260806T220000000Z",
    publishedAt: "2026-08-06T22:00:00.000Z",
  })),
}));

vi.mock("@/desk/breadth/store/create-store", () => ({
  createBreadthSnapshotStoreFromEnv: vi.fn(() => ({
    mode: "filesystem",
    writeVersioned: vi.fn(),
    publishLatest: vi.fn(),
    readLatestPointer: vi.fn(),
    readSnapshot: vi.fn(),
  })),
}));

import { GET } from "@/app/api/cron/breadth-daily/route";
import { produceDailySpyBreadth } from "@/desk/breadth/produce-daily-spy-breadth";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.clearAllMocks();
});

describe("verifyCronSecret", () => {
  it("rejects when CRON_SECRET is missing", () => {
    const result = verifyCronSecret(
      new Request("http://localhost/api/cron/breadth-daily", {
        headers: { authorization: "Bearer anything" },
      }),
      {},
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("missing_secret");
  });

  it("authorizes matching bearer token", () => {
    const result = verifyCronSecret(
      new Request("http://localhost/api/cron/breadth-daily", {
        headers: { authorization: "Bearer test-secret" },
      }),
      { CRON_SECRET: "test-secret" },
    );
    expect(result).toEqual({ ok: true, reason: "authorized" });
  });
});

describe("GET /api/cron/breadth-daily", () => {
  it("returns 401 when CRON_SECRET is missing", async () => {
    delete process.env.CRON_SECRET;
    const response = await GET(
      new Request("http://localhost/api/cron/breadth-daily", {
        headers: { authorization: "Bearer test-secret" },
      }),
    );
    expect(response.status).toBe(401);
    expect(produceDailySpyBreadth).not.toHaveBeenCalled();
  });

  it("returns 401 for unauthorized requests", async () => {
    process.env.CRON_SECRET = "expected-secret";
    const response = await GET(
      new Request("http://localhost/api/cron/breadth-daily", {
        headers: { authorization: "Bearer wrong-secret" },
      }),
    );
    expect(response.status).toBe(401);
    expect(produceDailySpyBreadth).not.toHaveBeenCalled();
  });

  it("runs producer when authorized", async () => {
    process.env.CRON_SECRET = "expected-secret";
    const response = await GET(
      new Request("http://localhost/api/cron/breadth-daily", {
        headers: { authorization: "Bearer expected-secret" },
      }),
    );
    expect(response.status).toBe(200);
    expect(produceDailySpyBreadth).toHaveBeenCalledOnce();
    const body = (await response.json()) as {
      status: string;
      marketSessionDate: string;
      snapshotIdentity: string;
    };
    expect(body).toMatchObject({
      status: "published",
      marketSessionDate: "2026-08-06",
      snapshotIdentity: "2026-08-06_20260806T220000000Z",
    });
    expect(JSON.stringify(body)).not.toMatch(/secret|token|api_key/i);
  });
});
