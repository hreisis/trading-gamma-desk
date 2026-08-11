import type { BreadthInternalsSnapshot } from "@/contracts/breadth-internals";
import {
  BREADTH_INTERNALS_SCHEMA_VERSION,
  BreadthInternalsSnapshot as BreadthInternalsSnapshotSchema,
  isCurrentBreadthInternalsSnapshot,
} from "@/contracts/breadth-internals";
import type { BreadthSnapshotPointer } from "@/contracts/breadth-snapshot-pointer";
import { defaultSessionCalendar } from "@/macro/calendar";
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
 * Read SPY breadth from durable latest pointer + versioned snapshot only.
 * Never fetches constituent universes or Alpaca bar panels.
 */
export async function loadDurableSpyBreadthForMarketInput(
  options: LoadDurableSpyBreadthOptions,
): Promise<DurableBreadthReadOutcome> {
  if (options.publicDemo) {
    return {
      snapshot: null,
      sourceArtifact: null,
      missingReason: "SPY breadth is not computed on the public demo path.",
    };
  }

  let store: BreadthSnapshotStore;
  if (options.store) {
    store = options.store;
  } else {
    const resolution = resolveBreadthSnapshotStoreFromEnv(
      options.env ?? process.env,
      { dataRoot: options.dataRoot },
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
        missingReason: "No durable breadth latest pointer published.",
      };
    }

    const stored = await store.readSnapshot(pointer);
    if (!isCurrentBreadthInternalsSnapshot(stored)) {
      return {
        snapshot: null,
        sourceArtifact: artifactFromPointer(pointer),
        missingReason: `Durable breadth latest is schema ${stored.schemaVersion}; only ${BREADTH_INTERNALS_SCHEMA_VERSION} snapshots feed market input.`,
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
      missingReason: `Durable breadth read failed: ${detail}`,
    };
  }
}
