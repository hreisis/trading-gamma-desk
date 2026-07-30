import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CATALYST_DEMO_BANNER,
  CATALYST_DEMO_DISCLAIMER,
} from "@/catalyst";
import {
  LIVE_DATA_UNAVAILABLE_MESSAGE,
  PUBLIC_DEMO_BANNER,
  PUBLIC_DEMO_COMPACT_BANNER,
  PUBLIC_DEMO_DRIVER,
} from "@/desk";

/**
 * Hits a real `next start` process with GAMMADESK_PUBLIC_DEMO=1.
 * Expects a prior `next build` (CI / smoke:demo:prod runs build first).
 */
const START_TIMEOUT_MS = 60_000;
const FETCH_TIMEOUT_MS = 15_000;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close();
        reject(new Error("could not allocate port"));
        return;
      }
      const { port } = addr;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

async function waitForReady(
  baseUrl: string,
  child: ChildProcess,
): Promise<void> {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`next start exited early with code ${child.exitCode}`);
    }
    try {
      const res = await fetch(baseUrl, {
        signal: AbortSignal.timeout(2_000),
      });
      if (res.ok || res.status === 500) return;
    } catch {
      // still booting
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`server not ready at ${baseUrl} within ${START_TIMEOUT_MS}ms`);
}

describe("public demo production build", () => {
  let child: ChildProcess | null = null;
  let baseUrl = "";

  beforeAll(async () => {
    if (!existsSync(".next")) {
      throw new Error(
        "missing .next — run GAMMADESK_PUBLIC_DEMO=1 npm run build first",
      );
    }
    const port = await freePort();
    baseUrl = `http://127.0.0.1:${port}`;
    child = spawn(
      "npx",
      ["next", "start", "--hostname", "127.0.0.1", "--port", String(port)],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          GAMMADESK_PUBLIC_DEMO: "1",
          PORT: String(port),
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    await waitForReady(baseUrl, child);
  }, START_TIMEOUT_MS + 5_000);

  afterAll(async () => {
    if (!child || child.killed) return;
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        child?.kill("SIGKILL");
        resolve();
      }, 5_000);
      child?.once("exit", () => {
        clearTimeout(t);
        resolve();
      });
    });
  });

  it("serves / with illustrative synthetic demo chrome and driver", async () => {
    const res = await fetch(baseUrl + "/", {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(PUBLIC_DEMO_COMPACT_BANNER);
    expect(html).toContain("not actual market or catalyst observations");
    expect(html).toContain(PUBLIC_DEMO_DRIVER.label);
    expect(html).toContain(
      `${PUBLIC_DEMO_DRIVER.confidence.score}/100 (uncalibrated)`,
    );
    expect(html).toContain("Catalyst feed");
    expect(html).toContain('data-testid="driver-risk-light"');
    expect(html).toContain(CATALYST_DEMO_DISCLAIMER);
    // Duplicate macro/catalyst demo banners are collapsed into one chrome line.
    expect(html).not.toContain("Illustrative catalyst demo · synthetic events");
    expect(html.toLowerCase()).not.toContain("live driver");
    expect(html).not.toContain("fixture missing or invalid");
    expect(html).not.toContain("ENOENT");
  });

  it("serves /?source=live as live data unavailable without a driver", async () => {
    const res = await fetch(baseUrl + "/?source=live", {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(LIVE_DATA_UNAVAILABLE_MESSAGE);
    expect(html).toContain("Live data unavailable in public demo");
    expect(html).not.toContain(PUBLIC_DEMO_DRIVER.label);
    expect(html.toLowerCase()).not.toContain("live driver");
  });

  it("API mirrors the same public-demo provenance", async () => {
    const home = await fetch(baseUrl + "/api/macro/latest", {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    }).then((r) => r.json());
    expect(home.isPublicDemo).toBe(true);
    expect(home.isLiveDriver).toBe(false);
    expect(home.sourceLabel).toBe(PUBLIC_DEMO_BANNER);
    expect(home.driver?.label).toBe(PUBLIC_DEMO_DRIVER.label);

    const live = await fetch(baseUrl + "/api/macro/latest?source=live", {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    }).then((r) => r.json());
    expect(live.status).toBe("live_unavailable");
    expect(live.driver).toBeNull();
    expect(live.error?.message).toBe(LIVE_DATA_UNAVAILABLE_MESSAGE);

    const catalysts = await fetch(baseUrl + "/api/catalysts", {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    }).then((r) => r.json());
    expect(catalysts.mode).toBe("synthetic_demo");
    expect(catalysts.banner).toBe(CATALYST_DEMO_BANNER);
    expect(catalysts.isPublicDemo).toBe(true);
    expect(Array.isArray(catalysts.catalysts)).toBe(true);
  });
});
