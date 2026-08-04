import { join } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import { loadAlpacaMarketPanel } from "@/alpaca";
import { loadMarketNewsPanel } from "@/news";
import { loadAiStudyBriefing, collectAiStudyInputs } from "@/ai-study";
import { claimText } from "@/ai-study/claim-utils";
import { loadCatalystFeed } from "@/catalyst";
import { writeJsonAtomic } from "@/desk/atomic-write";
import { isPublicDemoMode } from "@/desk/public-demo";
import { loadSessionDriver } from "@/desk/load-session-driver";
import { loadSessionBoundedGamma } from "@/desk/load-session-bounded-gamma";
import { resolveExplicitMarketSessionDate } from "@/desk/resolve-market-session";
import {
  DeskLiveAuditReport,
  type DeskLiveAuditComparisonRow,
} from "@/contracts/desk-live-audit";
import { studyEvidenceBundlePath } from "@/studies/pipeline-store";

export interface RunDeskLiveAuditOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly now?: Date;
  readonly sessionDate?: string | null;
  readonly dataRoot?: string;
  readonly liveAi?: boolean;
}

export function deskLiveAuditJsonPath(dataRoot = "data"): string {
  return join(dataRoot, "desk", "live-audit-latest.json");
}

export function deskLiveAuditMarkdownPath(dataRoot = "data"): string {
  return join(dataRoot, "desk", "live-audit-latest.md");
}

function compareNum(
  field: string,
  module: string,
  displayed: number | null | undefined,
  providerInput: number | null | undefined,
  tolerance = 0.01,
): DeskLiveAuditComparisonRow {
  const disp = displayed ?? null;
  const prov = providerInput ?? null;
  const match =
    disp === null && prov === null
      ? true
      : disp !== null &&
        prov !== null &&
        Math.abs(disp - prov) <= tolerance;
  return {
    field,
    module,
    displayed: disp,
    providerInput: prov,
    match,
    note: match ? undefined : "value mismatch",
  };
}

export function formatDeskLiveAuditMarkdown(
  report: DeskLiveAuditReport,
): string {
  const lines = [
    `# Desk live audit — ${report.sessionDate ?? "unknown session"}`,
    "",
    `- Generated: ${report.generatedAt}`,
    `- Overall: **${report.overallStatus}**`,
    `- Session aligned: ${report.sessionAlignment.aligned ? "yes" : "no"}`,
    "",
    "## Sources",
    "",
    "| Module | Provider | Session | Fetched | Freshness | Status |",
    "| --- | --- | --- | --- | --- | --- |",
  ];
  for (const row of report.sources) {
    lines.push(
      `| ${row.module} | ${row.provider} | ${row.sessionDate ?? "—"} | ${row.fetchedAt ?? "—"} | ${row.freshness} | ${row.status} |`,
    );
  }
  if (report.sessionAlignment.conflicts.length) {
    lines.push("", "## Session conflicts", "");
    for (const c of report.sessionAlignment.conflicts) {
      lines.push(`- ${c}`);
    }
  }
  lines.push("", "## Value comparisons", "", "| Field | Module | Displayed | Provider | Match |", "| --- | --- | --- | --- | --- |");
  for (const row of report.comparisons) {
    lines.push(
      `| ${row.field} | ${row.module} | ${row.displayed ?? "—"} | ${row.providerInput ?? "—"} | ${row.match ? "yes" : "no"} |`,
    );
  }
  if (report.aiStudy) {
    lines.push(
      "",
      "## AI Study",
      "",
      `- Status: ${report.aiStudy.status}`,
      `- Model: ${report.aiStudy.model ?? "—"}`,
    );
    if (report.aiStudy.usage) {
      lines.push(
        `- Tokens: in=${report.aiStudy.usage.inputTokens} out=${report.aiStudy.usage.outputTokens} retries=${report.aiStudy.usage.retryCount} est=$${report.aiStudy.usage.estimatedCostUsd}`,
      );
    }
    if (report.aiStudy.grounding) {
      lines.push(
        `- Grounding: citations=${report.aiStudy.grounding.citationsValid} numbers=${report.aiStudy.grounding.numbersValid} prohibited=${report.aiStudy.grounding.prohibitedLanguageDetected}`,
      );
      if (report.aiStudy.grounding.errors.length) {
        lines.push(`- Grounding errors: ${report.aiStudy.grounding.errors.slice(0, 3).join("; ")}`);
      }
    }
    if (report.aiStudy.sampleRegime) {
      lines.push("", `Sample regime: ${report.aiStudy.sampleRegime}`);
    }
  }
  if (report.notes.length) {
    lines.push("", "## Notes", "");
    for (const n of report.notes) lines.push(`- ${n}`);
  }
  return lines.join("\n");
}

export async function runDeskLiveAudit(
  options: RunDeskLiveAuditOptions = {},
): Promise<DeskLiveAuditReport> {
  const env = options.env ?? process.env;
  if (isPublicDemoMode(env)) {
    throw new Error("Desk live audit refused in public demo mode");
  }

  const now = options.now ?? new Date();
  const dataRoot = options.dataRoot ?? join(process.cwd(), "data");
  const sessionDate =
    options.sessionDate ??
    resolveExplicitMarketSessionDate({ dataRoot }) ??
    null;

  const notes: string[] = [];
  const comparisons: DeskLiveAuditComparisonRow[] = [];
  const sources: DeskLiveAuditReport["sources"] = [];

  const macro = sessionDate
    ? loadSessionDriver(sessionDate, dataRoot)
    : { driver: null, driverPath: null, issues: [] };
  const gamma = sessionDate
    ? loadSessionBoundedGamma({ sessionDate, symbol: "SPY" })
    : { snapshot: null, snapshotPath: null, issues: [] };
  const catalysts = loadCatalystFeed({}, { now, dataRoot });
  const market = await loadAlpacaMarketPanel({ env, now, publicDemo: false });
  const news = await loadMarketNewsPanel({ env, now, publicDemo: false });
  const packet = await collectAiStudyInputs({ env, now, sessionDate, dataRoot });

  if (macro.driver) {
    sources.push({
      module: "macro",
      provider: "local_store",
      sessionDate: macro.driver.marketSessionDate,
      fetchedAt: null,
      freshness: macro.issues.some((i) => i.severity === "stale") ? "stale" : "cached",
      status: "ready",
    });
    const us10 = macro.driver.assets.find((a) => a.symbol === "US10Y");
    const btc = macro.driver.assets.find((a) => a.symbol === "BTC");
    if (us10) {
      comparisons.push(
        compareNum("macro.US10Y.value", "macro", us10.value, us10.value),
      );
    }
    if (btc) {
      comparisons.push(
        compareNum("macro.BTC.value", "macro", btc.value, btc.value),
      );
    }
  } else {
    sources.push({
      module: "macro",
      provider: "local_store",
      sessionDate,
      fetchedAt: null,
      freshness: "unavailable",
      status: "unavailable",
      note: macro.issues[0]?.message,
    });
  }

  if (gamma.snapshot && !gamma.issues.some((i) => i.severity === "mismatched")) {
    sources.push({
      module: "gamma",
      provider: "marketdata_app",
      sessionDate: gamma.snapshot.sessionDate,
      fetchedAt: gamma.snapshot.source.fetchedAt,
      freshness: gamma.issues.some((i) => i.severity === "stale")
        ? "stale"
        : "cached",
      status: gamma.snapshot.status,
    });
    comparisons.push(
      compareNum(
        "gamma.spot",
        "gamma",
        gamma.snapshot.spot,
        packet.facts.gammaStructure?.spot as number | null,
      ),
    );
  } else {
    const mismatch = gamma.issues.find((i) => i.severity === "mismatched");
    sources.push({
      module: "gamma",
      provider: "marketdata_app",
      sessionDate: sessionDate,
      fetchedAt: gamma.snapshot?.source.fetchedAt ?? null,
      freshness: mismatch ? "stale" : "unavailable",
      status: "unavailable",
      note:
        mismatch?.message ??
        gamma.issues[0]?.message ??
        "No bounded gamma for target session",
    });
  }

  sources.push({
    module: "catalyst",
    provider: catalysts.source.type,
    sessionDate: null,
    fetchedAt: now.toISOString(),
    freshness: catalysts.mode === "stale_calendar" ? "stale" : "cached",
    status: catalysts.mode,
  });

  sources.push({
    module: "market",
    provider: "alpaca",
    sessionDate: null,
    fetchedAt: market.fetchedAt,
    freshness: market.status === "ready" ? "live" : market.status,
    status: market.status,
  });
  for (const q of market.quotes.filter((x) =>
    ["SPY", "QQQ", "BTC/USD"].includes(x.symbol),
  )) {
    const packetQuote = packet.facts.marketQuotes.find(
      (p) => (p as { symbol?: string }).symbol === q.symbol,
    ) as { latestPrice?: number | null } | undefined;
    comparisons.push(
      compareNum(
        `quote.${q.symbol}.latestPrice`,
        "market",
        q.latestPrice,
        packetQuote?.latestPrice ?? null,
      ),
    );
  }

  sources.push({
    module: "news",
    provider: news.provider,
    sessionDate: null,
    fetchedAt: news.fetchedAt,
    freshness: news.status === "ready" ? "live" : news.status,
    status: news.status,
    note: news.diagnostics
      ? `macroRaw=${news.diagnostics.macroRawCount} symbolRaw=${news.diagnostics.symbolRawCount}` +
        (news.diagnostics.providerError
          ? ` — ${news.diagnostics.providerError}`
          : "")
      : news.message,
  });

  const histPath = sessionDate
    ? studyEvidenceBundlePath(dataRoot, sessionDate, "SPY")
    : null;
  sources.push({
    module: "historical_study",
    provider: "local_store",
    sessionDate,
    fetchedAt: (packet.facts.historicalStudy as { computedAt?: string } | null)
      ?.computedAt ?? null,
    freshness: packet.inputs.find((i) => i.id === "historical_study")?.freshness ?? "unavailable",
    status:
      packet.inputs.find((i) => i.id === "historical_study")?.status ??
      "unavailable",
    note: histPath ?? undefined,
  });

  let aiStudyReport: DeskLiveAuditReport["aiStudy"] = null;
  if (options.liveAi) {
    const briefing = await loadAiStudyBriefing({ env, now, sessionDate });
    aiStudyReport = {
      status: briefing.status,
      model: briefing.model,
      usage: briefing.usage,
      grounding: briefing.grounding,
      sampleRegime: briefing.report
        ? claimText(briefing.report.marketRegime)
        : null,
    };
    sources.push({
      module: "ai_study",
      provider: briefing.provider,
      sessionDate: briefing.sessionDate,
      fetchedAt: briefing.generatedAt,
      freshness: briefing.status === "ready" ? "live" : briefing.status,
      status: briefing.status,
    });
  } else if (packet.blocked) {
    notes.push("AI Study skipped — session conflict (use --live to attempt anyway after fix)");
  }

  const conflicts = packet.sessionAlignment.conflicts;
  const mismatchCount = comparisons.filter((c) => !c.match).length;
  const overallStatus = packet.blocked
    ? "blocked"
    : mismatchCount > 0 || conflicts.length > 0
      ? "partial"
      : macro.driver && gamma.snapshot
        ? "ready"
        : "partial";

  const report = DeskLiveAuditReport.parse({
    kind: "DeskLiveAuditReport",
    schemaVersion: "0.1.0",
    generatedAt: now.toISOString(),
    sessionDate,
    overallStatus,
    sessionAlignment: {
      aligned: packet.sessionAlignment.aligned,
      conflicts,
    },
    sources,
    comparisons,
    aiStudy: aiStudyReport,
    notes,
  });

  return report;
}

export async function writeDeskLiveAuditReport(
  report: DeskLiveAuditReport,
  dataRoot = "data",
): Promise<{ jsonPath: string; markdownPath: string }> {
  const jsonPath = deskLiveAuditJsonPath(dataRoot);
  const markdownPath = deskLiveAuditMarkdownPath(dataRoot);
  mkdirSync(join(dataRoot, "desk"), { recursive: true });
  writeJsonAtomic(jsonPath, report);
  writeFileSync(markdownPath, formatDeskLiveAuditMarkdown(report), "utf8");
  return { jsonPath, markdownPath };
}
