import { runMacroIngest, DEFAULT_DATA_ROOT } from "@/ingest";
import { writePipelineError } from "@/desk/pipeline-status";
import {
  interpretAndWriteDriver,
  type InterpretWriteResult,
} from "./interpret-and-write";
import type { IngestRunResult } from "@/ingest";

export interface DailyRunResult {
  readonly ingest: IngestRunResult;
  readonly interpret: InterpretWriteResult;
}

/**
 * Daily desk refresh: ingest (+ compute snapshot) → interpret → atomic driver.
 * On any failure, previous valid drivers remain and pipeline status records
 * the error for the UI.
 */
export async function runDailyPipeline(options: {
  readonly dataRoot?: string;
  readonly force?: boolean;
  readonly token?: string;
} = {}): Promise<DailyRunResult> {
  const dataRoot = options.dataRoot ?? DEFAULT_DATA_ROOT;

  let ingest: IngestRunResult;
  try {
    ingest = await runMacroIngest({
      dataRoot,
      force: options.force,
      token: options.token,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    writePipelineError({
      dataRoot,
      stage: "ingest",
      error: message,
    });
    throw error instanceof Error ? error : new Error(message);
  }

  try {
    const interpret = interpretAndWriteDriver({
      dataRoot,
      session: ingest.snapshot.marketSessionDate,
      updatePipelineStatus: true,
    });
    return { ingest, interpret };
  } catch (error: unknown) {
    // interpretAndWriteDriver already wrote pipeline error; rethrow.
    throw error instanceof Error ? error : new Error(String(error));
  }
}
