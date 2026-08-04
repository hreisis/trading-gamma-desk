#!/usr/bin/env npx tsx
import { readFileSync } from "node:fs";
import { isPublicDemoMode } from "@/desk/public-demo";
import {
  runDeskLiveAudit,
  writeDeskLiveAuditReport,
} from "@/desk/live-audit/run-audit";

function loadEnvFile(path: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      env[key] = value;
    }
  } catch {
    // ignore
  }
  return env;
}

function parseArgs(argv: string[]) {
  let sessionDate: string | null = null;
  let liveAi = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--date" && argv[i + 1]) {
      sessionDate = argv[i + 1]!;
      i += 1;
    }
    if (argv[i] === "--live") liveAi = true;
  }
  return { sessionDate, liveAi };
}

async function main(): Promise<void> {
  const { sessionDate, liveAi } = parseArgs(process.argv.slice(2));
  const env = loadEnvFile(".env");
  if (isPublicDemoMode(env)) {
    console.error("Refusing desk live audit in public demo mode");
    process.exit(1);
  }
  const report = await runDeskLiveAudit({
    env,
    sessionDate,
    liveAi,
  });
  const { jsonPath, markdownPath } = await writeDeskLiveAuditReport(report);
  console.log(JSON.stringify({ jsonPath, markdownPath, overallStatus: report.overallStatus }, null, 2));
  if (report.overallStatus === "failed" || report.overallStatus === "blocked") {
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
