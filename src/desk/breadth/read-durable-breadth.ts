import type { BreadthInternalsSnapshot } from "@/contracts/breadth-internals";
import {
  BREADTH_INTERNALS_SCHEMA_VERSION,
  BreadthInternalsSnapshot as BreadthInternalsSnapshotSchema,
  isCurrentBreadthInternalsSnapshot,
} from "@/contracts/breadth-internals";
import type { BreadthSnapshotPointer } from "@/contracts/breadth-snapshot-pointer";
import { defaultSessionCalendar } from "@/macro/calendar";
import { isServerlessHost } from "@/desk/production-runtime";
import { breadthConfigForFund } from "./config";
import { tradingSessionLag } from "./universe/session-lag";
import {
  BreadthStoreError,
  resolveBreadthSnapshotStoreFromEnv,
  type BreadthSnapshotStore,
} from "./store";

export interface DurableBreadthReadOutcome {
  readonly snapshot: BreadthInternalsSnapshot | null;
  readonly sourceArtifact: string | null;
  readonly missingReason: string | null;
}

export interface LoadDurableSpyBreadthOptions {
  readonly targetMarketSessionDate: string;
  readonly env?: Record<string, string | undefined>;
  readonly dataRoot?: string;
  readonly publicDemo?: boolean;
  /** Explicit store for hermetic tests and local filesystem dev. */
  readonly store?: BreadthSnapshotStore;
}

export type LoadDurableQqqBreadthOptions = LoadDurableSpyBreadthOptions;

export function evaluateDurableBreadthSessionFreshness(input: {
  readonly snapshotMarketSessionDate: string;
  readonly targetMarketSessionDate: string;
}): { readonly stale: boolean; readonly missingReason: string | null } {
  if (input.snapshotMarketSessionDate === input.targetMarketSessionDate) {
    return { stale: false, missingReason: null };
  }

  const calendar = defaultSessionCalendar;
  if (!calendar.isSession(input.targetMarketSessionDate)) {
    return {
      stale: true,
      missingReason: `Target ${input.targetMarketSessionDate} is not a US trading session.`,
    };
  }

  const lag = tradingSessionLag(
    input.snapshotMarketSessionDate,
    input.targetMarketSessionDate,
    calendar,
  );

  if (lag === null) {
    return {
      stale: true,
      missingReason: `Unable to compare breadth snapshot session ${input.snapshotMarketSessionDate} to target ${input.targetMarketSessionDate}.`,
    };
  }

  if (lag > 0) {
    return {
      stale: true,
      missingReason: `Durable breadth snapshot session ${input.snapshotMarketSessionDate} lags target ${input.targetMarketSessionDate} by ${lag} trading session(s).`,
    };
  }

  return {
    stale: true,
    missingReason: `Durable breadth snapshot session ${input.snapshotMarketSessionDate} is after target ${input.targetMarketSessionDate}.`,
  };
}

function artifactFromPointer(pointer: BreadthSnapshotPointer): string {
  return `breadth/${pointer.snapshotPath}`;
}

/**
 * Read ETF breadth from durable latest pointer + versioned snapshot only.
 * Never fetches constituent universes or Alpaca bar panels.
 */
async function loadDurableBreadthForFund(
  fundSymbol: "SPY" | "QQQ",
  options: LoadDurableSpyBreadthOptions,
): Promise<DurableBreadthReadOutcome> {
  const config = breadthConfigForFund(fundSymbol);
  if (options.publicDemo) {
    return {
      snapshot: null,
      sourceArtifact: null,
      missingReason: `${config.fundSymbol} breadth is not computed on the public demo path.`,
    };
  }

  let store: BreadthSnapshotStore;
  if (options.store) {
    store = options.store;
  } else {
    const resolution = resolveBreadthSnapshotStoreFromEnv(
      options.env ?? process.env,
      { dataRoot: options.dataRoot, fundSymbol },
    );
    if (!resolution.ok) {
      return {
        snapshot: null,
        sourceArtifact: null,
        missingReason: resolution.message,
      };
    }
    store = resolution.store;
  }

  try {
    const pointer = await store.readLatestPointer();
    if (!pointer) {
      return {
        snapshot: null,
        sourceArtifact: null,
        missingReason: `No durable ${config.fundSymbol} breadth latest pointer published.`,
      };
    }

    const stored = await store.readSnapshot(pointer);
    if (!isCurrentBreadthInternalsSnapshot(stored)) {
      return {
        snapshot: null,
        sourceArtifact: artifactFromPointer(pointer),
        missingReason: `Durable ${config.fundSymbol} breadth latest is schema ${stored.schemaVersion}; only ${BREADTH_INTERNALS_SCHEMA_VERSION} snapshots feed market input.`,
      };
    }

    const sessionFreshness = evaluateDurableBreadthSessionFreshness({
      snapshotMarketSessionDate: stored.marketSessionDate,
      targetMarketSessionDate: options.targetMarketSessionDate,
    });

    const merged = BreadthInternalsSnapshotSchema.parse({
      ...stored,
      stale: stored.stale || sessionFreshness.stale,
      missingReason: sessionFreshness.missingReason ?? stored.missingReason,
    });

    return {
      snapshot: merged,
      sourceArtifact: artifactFromPointer(pointer),
      missingReason: null,
    };
  } catch (error) {
    if (error instanceof BreadthStoreError) {
      return {
        snapshot: null,
        sourceArtifact: null,
        missingReason: error.message,
      };
    }
    const detail = error instanceof Error ? error.message : String(error);
    return {
      snapshot: null,
      sourceArtifact: null,
      missingReason: `Durable ${config.fundSymbol} breadth read failed: ${detail}`,
    };
  }
}

export async function loadDurableSpyBreadthForMarketInput(
  options: LoadDurableSpyBreadthOptions,
): Promise<DurableBreadthReadOutcome> {
  return loadDurableBreadthForFund("SPY", options);
}

export async function loadDurableQqqBreadthForMarketInput(
  options: LoadDurableQqqBreadthOptions,
): Promise<DurableBreadthReadOutcome> {
  return loadDurableBreadthForFund("QQQ", options);
}

const BREADTH_POINTER_MISSING = "No durable breadth latest pointer published.";

function isBreadthPointerMissing(missingReason: string | null): boolean {
  return (
    missingReason === BREADTH_POINTER_MISSING ||
    missingReason?.includes("No durable SPY breadth latest pointer") === true ||
    missingReason?.includes("No durable QQQ breadth latest pointer") === true
  );
}

async function ensureDurableBreadthForFund(
  fundSymbol: "SPY" | "QQQ",
  options: LoadDurableSpyBreadthOptions,
): Promise<DurableBreadthReadOutcome> {
  const outcome = await loadDurableBreadthForFund(fundSymbol, options);
  if (outcome.snapshot || options.publicDemo) {
    return outcome;
  }

  if (!isBreadthPointerMissing(outcome.missingReason)) {
    return outcome;
  }

  const env = options.env ?? process.env;
  const dataRoot = options.dataRoot ?? "data";
  let store: BreadthSnapshotStore;
  if (options.store) {
    store = options.store;
  } else {
    const resolution = resolveBreadthSnapshotStoreFromEnv(env, {
      dataRoot,
      fundSymbol,
    });
    if (!resolution.ok) {
      return outcome;
    }
    store = resolution.store;
  }

  const serverless = isServerlessHost(env as NodeJS.ProcessEnv);
  if (fundSymbol === "SPY") {
    const { produceDailySpyBreadth } = await import("./produce-daily-spy-breadth");
    const produce = await produceDailySpyBreadth({
      store,
      dataRoot,
      env: env as NodeJS.ProcessEnv,
      bootstrapBars: true,
      allowUniversePersistedFallback: true,
      persistUniverse: !serverless,
      persistBars: !serverless,
    });
    if (produce.status !== "published") {
      return {
        ...outcome,
        missingReason:
          produce.status === "skipped"
            ? `Breadth producer skipped: ${produce.detail ?? produce.reason}`
            : `Breadth producer failed: ${produce.detail ?? produce.reason}`,
      };
    }
  } else {
    const { produceDailyQqqBreadth } = await import("./produce-daily-qqq-breadth");
    const produce = await produceDailyQqqBreadth({
      store,
      dataRoot,
      env: env as NodeJS.ProcessEnv,
      bootstrapBars: true,
      allowUniversePersistedFallback: true,
      persistUniverse: !serverless,
      persistBars: !serverless,
    });
    if (produce.status !== "published") {
      return {
        ...outcome,
        missingReason:
          produce.status === "skipped"
            ? `QQQ breadth producer skipped: ${produce.detail ?? produce.reason}`
            : `QQQ breadth producer failed: ${produce.detail ?? produce.reason}`,
      };
    }
  }

  return loadDurableBreadthForFund(fundSymbol, {
    ...options,
    store,
    dataRoot,
  });
}

/**
 * Load durable SPY breadth; when the latest pointer is absent, run the daily
 * producer once so local dev can publish from Alpaca without a separate cron step.
 */
export async function ensureDurableSpyBreadthForMarketInput(
  options: LoadDurableSpyBreadthOptions,
): Promise<DurableBreadthReadOutcome> {
  return ensureDurableBreadthForFund("SPY", options);
}

export async function ensureDurableQqqBreadthForMarketInput(
  options: LoadDurableQqqBreadthOptions,
): Promise<DurableBreadthReadOutcome> {
  return ensureDurableBreadthForFund("QQQ", options);
}
