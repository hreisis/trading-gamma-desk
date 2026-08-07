import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CATALYST_DEMO_BANNER,
} from "@/catalyst";
import {
  PUBLIC_DEMO_DRIVER,
  PUBLIC_DEMO_FIXTURE_PATH,
} from "@/desk";

/**
 * Hits a real `next start` process built with GAMMADESK_PUBLIC_DEMO=1.
 * `/` stays current/live even when that env is set; synthetic fixtures are
 * only served on `/demo` or `?demo=1`.
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

  it("serves / in live V2 mode with an honest empty state", async () => {
    const desk = await fetch(baseUrl + "/api/macro/latest", {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    }).then((r) => r.json());

    expect(desk.isPublicDemo).toBe(false);
    expect(desk.isDemo).toBe(false);
    expect(desk.driverPath).not.toBe(PUBLIC_DEMO_FIXTURE_PATH);

    const res = await fetch(baseUrl + "/", {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    expect(res.status).toBe(200);
    const html = await res.text();

    expect(html).toContain('class="v2-app"');
    expect(html).not.toContain('data-testid="banner-illustrative-demo"');
    expect(html).not.toContain('data-testid="demo-route-banner"');
    expect(html).toContain("Live decision withheld");

    if (desk.status === "empty") {
      expect(html).toContain("No aligned macro snapshot");
      expect(desk.driver).toBeNull();
    } else {
      expect(desk.isLiveDriver).toBe(true);
      expect(html).toContain(desk.driver.label);
    }
  });

  it("serves /demo in explicit synthetic V2 mode with fixture provenance", async () => {
    const desk = await fetch(baseUrl + "/api/macro/latest?demo=1", {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    }).then((r) => r.json());
    expect(desk.isPublicDemo).toBe(true);
    expect(desk.isDemo).toBe(true);
    expect(desk.isLiveDriver).toBe(false);
    expect(desk.driver?.label).toBe(PUBLIC_DEMO_DRIVER.label);
    expect(desk.driverPath).toBe(PUBLIC_DEMO_FIXTURE_PATH);

    const res = await fetch(baseUrl + "/demo", {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    expect(res.status).toBe(200);
    const html = await res.text();

    expect(html).toContain('class="v2-app"');
    expect(html).toContain('data-testid="demo-route-banner"');
    expect(html).toContain("Synthetic fixtures only via");
    expect(html).toContain('data-testid="banner-illustrative-demo"');
    expect(html).toContain("Illustrative methodology preview");
    expect(html).toContain(PUBLIC_DEMO_DRIVER.label);
    expect(html).toContain('data-testid="v2-gamma-SPY"');
    expect(html).toContain('data-testid="v2-gamma-QQQ"');
    expect(html).not.toContain("fixture missing or invalid");
    expect(html).not.toContain("ENOENT");
  });

  it("redirects legacy /v2 routes to / and /demo while preserving lang", async () => {
    const live = await fetch(baseUrl + "/v2?lang=zh", {
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    expect(live.status).toBe(307);
    expect(live.headers.get("location")).toBe("/?lang=zh");

    const demo = await fetch(baseUrl + "/v2?preview=1&lang=en", {
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    expect(demo.status).toBe(307);
    expect(demo.headers.get("location")).toBe("/demo?lang=en");
  });

  it("distinguishes default desk API from explicit demo flag", async () => {
    const desk = await fetch(baseUrl + "/api/macro/latest", {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    }).then((r) => r.json());
    expect(desk.isPublicDemo).toBe(false);
    expect(desk.isDemo).toBe(false);
    expect(desk.driverPath).not.toBe(PUBLIC_DEMO_FIXTURE_PATH);

    const demoDesk = await fetch(baseUrl + "/api/macro/latest?demo=1", {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    }).then((r) => r.json());
    expect(demoDesk.isPublicDemo).toBe(true);
    expect(demoDesk.isDemo).toBe(true);
    expect(demoDesk.isLiveDriver).toBe(false);
    expect(demoDesk.driver?.label).toBe(PUBLIC_DEMO_DRIVER.label);
    expect(demoDesk.driverPath).toBe(PUBLIC_DEMO_FIXTURE_PATH);

    const catalysts = await fetch(baseUrl + "/api/catalysts", {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    }).then((r) => r.json());
    expect(catalysts.isPublicDemo).toBe(false);
    expect(catalysts.mode).not.toBe("synthetic_demo");

    const demoCatalysts = await fetch(baseUrl + "/api/catalysts?demo=1", {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    }).then((r) => r.json());
    expect(demoCatalysts.mode).toBe("synthetic_demo");
    expect(demoCatalysts.banner).toBe(CATALYST_DEMO_BANNER);
    expect(demoCatalysts.isPublicDemo).toBe(true);
    expect(Array.isArray(demoCatalysts.catalysts)).toBe(true);
  });
});
