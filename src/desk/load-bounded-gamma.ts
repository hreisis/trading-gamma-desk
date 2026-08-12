import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BoundedGammaProviderSnapshot,
  type BoundedGammaProviderSnapshot as BoundedGammaProviderSnapshotDto,
} from "@/contracts";
import {
  boundedGammaLatestPath,
  DEFAULT_BOUNDED_GAMMA_DATA_ROOT,
} from "@/gamma/marketdata-app/paths";
import {
  boundedGammaFreshnessLabel,
  isBoundedGammaSessionStale,
  resolveBoundedGammaTargetSession,
  type BoundedGammaFreshnessLabel,
} from "./bounded-gamma-freshness";
import { isPublicDemoMode } from "./public-demo";
import spyBoundedUiFixture from "../../fixtures/gamma/providers/marketdata-app/spy-bounded-ui.json";

export type BoundedGammaDeskStatus =
  | "ready"
  | "incomplete"
  | "empty"
  | "malformed"
  | "unavailable";

export interface BoundedGammaDeskView {
  readonly status: BoundedGammaDeskStatus;
  readonly snapshot: BoundedGammaProviderSnapshotDto | null;
  /** Parsed artifact when levels are withheld (e.g. stale session) but IV context may remain. */
  readonly withheldSnapshot: BoundedGammaProviderSnapshotDto | null;
  readonly sourceLabel: string;
  readonly isFixture: boolean;
  readonly freshness?: BoundedGammaFreshnessLabel;
  readonly error?: { readonly code: string; readonly message: string };
}

export const BOUNDED_GAMMA_UI_FIXTURE_PATH =
  "fixtures/gamma/providers/marketdata-app/spy-bounded-ui.json";

export interface LoadBoundedGammaOptions {
  readonly symbol?: string;
  readonly dataRoot?: string;
  readonly publicDemo?: boolean;
  /** Force the checked-in UI fixture (tests / ?gamma=fixture). */
  readonly forceFixture?: boolean;
  readonly env?: NodeJS.ProcessEnv;
  /** Override target session for hermetic tests. */
  readonly targetSession?: string;
  readonly now?: Date;
}

function normalizeLegacyBoundedSnapshot(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const record = raw as Record<string, unknown>;
  if (record.gammaFlip !== undefined && record.gammaFlip !== null) {
    return raw;
  }
  return {
    ...record,
    gammaFlip: {
      status: "unavailable",
      reason:
        "Gamma Flip missing from cached bounded snapshot — refresh bounded gamma to recompute.",
      scope: "bounded_single_expiry",
    },
  };
}

function parseSnapshot(
  raw: unknown,
  sourceLabel: string,
  isFixture: boolean,
): BoundedGammaDeskView {
  const parsed = BoundedGammaProviderSnapshot.safeParse(
    normalizeLegacyBoundedSnapshot(raw),
  );
  if (!parsed.success) {
    return {
      status: "malformed",
      snapshot: null,
      withheldSnapshot: null,
      sourceLabel,
      isFixture,
      error: {
        code: "malformed",
        message:
          "Bounded gamma snapshot failed contract validation. UI does not repair vendor or engine payloads.",
      },
    };
  }
  if (parsed.data.status === "unavailable") {
    return {
      status: "unavailable",
      snapshot: parsed.data,
      withheldSnapshot: null,
      sourceLabel,
      isFixture,
      error: {
        code: "unavailable",
        message: "Bounded gamma snapshot is present but status is unavailable.",
      },
    };
  }
  if (parsed.data.status === "incomplete") {
    return {
      status: "incomplete",
      snapshot: parsed.data,
      withheldSnapshot: null,
      sourceLabel,
      isFixture,
      freshness: "incomplete",
    };
  }
  return {
    status: "ready",
    snapshot: parsed.data,
    withheldSnapshot: null,
    sourceLabel,
    isFixture,
  };
}

/**
 * Session gate for live bounded gamma: stale vendor session → fail closed;
 * fresh incomplete → incomplete (not ready).
 */
export function applyBoundedGammaSessionGate(
  view: BoundedGammaDeskView,
  targetSession: string,
  options?: { readonly skipSessionGate?: boolean },
): BoundedGammaDeskView {
  if (options?.skipSessionGate) {
    if (view.snapshot && view.status === "ready") {
      return {
        ...view,
        freshness: boundedGammaFreshnessLabel(view.snapshot, targetSession),
      };
    }
    if (view.status === "incomplete" && view.snapshot) {
      return { ...view, freshness: "incomplete" };
    }
    return view;
  }

  if (
    view.status === "empty" ||
    view.status === "malformed" ||
    view.snapshot === null
  ) {
    return view;
  }

  const snapshot = view.snapshot;

  if (isBoundedGammaSessionStale(snapshot.sessionDate, targetSession)) {
    const deskStatus =
      snapshot.status === "incomplete"
        ? "incomplete"
        : snapshot.status === "unavailable"
          ? "unavailable"
          : "ready";
    return {
      status: deskStatus,
      snapshot,
      withheldSnapshot: null,
      sourceLabel: view.sourceLabel,
      isFixture: view.isFixture,
      freshness: boundedGammaFreshnessLabel(snapshot, targetSession),
      error:
        deskStatus === "unavailable"
          ? {
              code: "stale_session",
              message: `Bounded gamma session ${snapshot.sessionDate} lags ${targetSession} and snapshot status is unavailable.`,
            }
          : undefined,
    };
  }

  const freshness = boundedGammaFreshnessLabel(snapshot, targetSession);

  if (snapshot.status === "incomplete") {
    return {
      status: "incomplete",
      snapshot,
      withheldSnapshot: null,
      sourceLabel: view.sourceLabel,
      isFixture: view.isFixture,
      freshness: "incomplete",
    };
  }

  if (view.status === "unavailable") {
    return view;
  }

  return {
    status: "ready",
    snapshot,
    withheldSnapshot: null,
    sourceLabel: view.sourceLabel,
    isFixture: view.isFixture,
    freshness,
  };
}

/**
 * Load BoundedGammaProviderSnapshot for the desk.
 * Never calls MarketData.app. Never requires API credentials.
 */
export function loadBoundedGammaDeskView(
  options: LoadBoundedGammaOptions = {},
): BoundedGammaDeskView {
  const symbol = (options.symbol ?? "SPY").toUpperCase();
  const publicDemo =
    options.publicDemo ?? isPublicDemoMode(options.env ?? process.env);
  const targetSession =
    options.targetSession ??
    resolveBoundedGammaTargetSession(options.now ?? new Date());
  const skipSessionGate = publicDemo || options.forceFixture === true;

  if (options.forceFixture || publicDemo) {
    if (symbol !== "SPY") {
      return {
        status: "empty",
        snapshot: null,
        withheldSnapshot: null,
        sourceLabel: `${symbol} demo fixture not configured`,
        isFixture: false,
        error: {
          code: "empty",
          message:
            `${symbol} is unavailable because the demo must not reuse the SPY fixture.`,
        },
      };
    }
    return applyBoundedGammaSessionGate(
      parseSnapshot(
        spyBoundedUiFixture,
        BOUNDED_GAMMA_UI_FIXTURE_PATH,
        true,
      ),
      targetSession,
      { skipSessionGate: true },
    );
  }

  const dataRoot =
    options.dataRoot ??
    join(process.cwd(), "data", "gamma", "providers", "marketdata-app");
  const path =
    options.dataRoot !== undefined
      ? boundedGammaLatestPath(symbol, dataRoot)
      : boundedGammaLatestPath(symbol, DEFAULT_BOUNDED_GAMMA_DATA_ROOT);

  if (!existsSync(path)) {
    return {
      status: "empty",
      snapshot: null,
      withheldSnapshot: null,
      sourceLabel: path,
      isFixture: false,
      error: {
        code: "empty",
        message:
          "No bounded gamma snapshot yet. Run npm run gamma:fetch locally (requires MARKETDATA_API_TOKEN). The desk never calls MarketData.app from the UI.",
      },
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (cause) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    return {
      status: "malformed",
      snapshot: null,
      withheldSnapshot: null,
      sourceLabel: path,
      isFixture: false,
      error: {
        code: "malformed",
        message: `Bounded gamma snapshot is not valid JSON: ${msg}`,
      },
    };
  }

  return applyBoundedGammaSessionGate(
    parseSnapshot(raw, path, false),
    targetSession,
    { skipSessionGate },
  );
}
