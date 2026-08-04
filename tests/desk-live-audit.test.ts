import { describe, expect, it } from "vitest";
import {
  formatDeskLiveAuditMarkdown,
  runDeskLiveAudit,
} from "@/desk/live-audit/run-audit";

describe("desk live audit", () => {
  it("refuses public demo mode", async () => {
    await expect(
      runDeskLiveAudit({
        env: { GAMMADESK_PUBLIC_DEMO: "1" } as unknown as NodeJS.ProcessEnv,
        sessionDate: "2026-07-29",
      }),
    ).rejects.toThrow(/public demo mode/i);
  });

  it("builds offline audit report for explicit session", async () => {
    const report = await runDeskLiveAudit({
      env: {} as NodeJS.ProcessEnv,
      sessionDate: "2026-07-29",
      now: new Date("2026-08-04T12:00:00.000Z"),
    });

    expect(report.kind).toBe("DeskLiveAuditReport");
    expect(report.sessionDate).toBe("2026-07-29");
    expect(report.sources.length).toBeGreaterThan(0);
    expect(report.sources.some((s) => s.module === "market")).toBe(true);
    expect(formatDeskLiveAuditMarkdown(report)).toMatch(/Desk live audit/);
  });
});
