import type { StudyMemoWorkflowResult } from "./build-memo-workflow";
import { runStudyMemoWorkflow } from "./build-memo-workflow";
import {
  readStudyEvidenceBundle,
  studyMemoPath,
  writeStudyMemo,
} from "./memo-store";

export interface StudyMemoCliArgs {
  readonly date: string;
  readonly bundlePath: string;
  readonly dataRoot: string;
  readonly outPath: string | null;
  readonly dryRun: boolean;
  readonly forceFallback: boolean;
}

export function parseStudyMemoCliArgs(argv: readonly string[]): StudyMemoCliArgs {
  let date: string | undefined;
  let bundlePath: string | undefined;
  let dataRoot = "data";
  let outPath: string | null = null;
  let dryRun = false;
  let forceFallback = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--force-fallback") {
      forceFallback = true;
      continue;
    }
    if (arg.startsWith("--date=")) {
      date = arg.slice("--date=".length);
      continue;
    }
    if (arg === "--date") {
      date = argv[++i];
      continue;
    }
    if (arg.startsWith("--bundle=")) {
      bundlePath = arg.slice("--bundle=".length);
      continue;
    }
    if (arg === "--bundle") {
      bundlePath = argv[++i];
      continue;
    }
    if (arg.startsWith("--data-root=")) {
      dataRoot = arg.slice("--data-root=".length);
      continue;
    }
    if (arg === "--data-root") {
      dataRoot = argv[++i] ?? dataRoot;
      continue;
    }
    if (arg.startsWith("--out=")) {
      outPath = arg.slice("--out=".length);
      continue;
    }
    if (arg === "--out") {
      outPath = argv[++i] ?? null;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  if (!date) {
    throw new Error("--date is required (exact sessionDate — no latest fallback)");
  }
  if (!bundlePath) {
    throw new Error("--bundle is required (exact evidence bundle path)");
  }

  return {
    date,
    bundlePath,
    dataRoot,
    outPath,
    dryRun,
    forceFallback,
  };
}

export interface RunStudyMemoCliOptions extends StudyMemoCliArgs {
  readonly generatedAt?: string;
}

export interface RunStudyMemoCliResult extends StudyMemoWorkflowResult {
  readonly outPath: string;
  readonly written: boolean;
}

export async function runStudyMemoCli(
  argv: readonly string[],
  options: { readonly generatedAt?: string } = {},
): Promise<RunStudyMemoCliResult> {
  const args = parseStudyMemoCliArgs(argv);
  const bundle = readStudyEvidenceBundle(args.bundlePath);

  if (bundle.queryContext.sessionDate !== args.date) {
    throw new Error(
      `bundle sessionDate ${bundle.queryContext.sessionDate} != --date ${args.date}`,
    );
  }

  const workflow = await runStudyMemoWorkflow({
    bundle,
    generatedAt: options.generatedAt ?? bundle.computedAt,
    forceFallback: args.forceFallback,
    synthetic: bundle.queryContext.symbol === "SPY",
  });

  const outPath = args.outPath ?? studyMemoPath(args.dataRoot, args.date);
  let written = false;
  if (!args.dryRun) {
    writeStudyMemo(outPath, workflow.memo);
    written = true;
  }

  return {
    ...workflow,
    outPath,
    written,
  };
}

export async function mainStudyMemoCli(argv: readonly string[]): Promise<void> {
  const result = await runStudyMemoCli(argv);
  if (!result.written) {
    console.log(`dry-run memo source=${result.source} status=${result.memo.status}`);
  } else {
    console.log(`wrote ${result.outPath}`);
  }
  console.log(`memoId: ${result.memo.id}`);
  console.log(`status: ${result.memo.status}`);
  console.log(`source: ${result.source}`);
  if (result.fallbackReason) {
    console.log(`fallback: ${result.fallbackReason}`);
  }
}
