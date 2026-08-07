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
import { isPublicDemoMode } from "./public-demo";
import spyBoundedUiFixture from "../../fixtures/gamma/providers/marketdata-app/spy-bounded-ui.json";

export type BoundedGammaDeskStatus =
  | "ready"
  | "empty"
  | "malformed"
  | "unavailable";

export interface BoundedGammaDeskView {
  readonly status: BoundedGammaDeskStatus;
  readonly snapshot: BoundedGammaProviderSnapshotDto | null;
  readonly sourceLabel: string;
  readonly isFixture: boolean;
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
}

function parseSnapshot(
  raw: unknown,
  sourceLabel: string,
  isFixture: boolean,
): BoundedGammaDeskView {
  const parsed = BoundedGammaProviderSnapshot.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "malformed",
      snapshot: null,
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
      sourceLabel,
      isFixture,
      error: {
        code: "unavailable",
        message: "Bounded gamma snapshot is present but status is unavailable.",
      },
    };
  }
  return {
    status: "ready",
    snapshot: parsed.data,
    sourceLabel,
    isFixture,
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

  if (options.forceFixture || publicDemo) {
    if (symbol !== "SPY") {
      return {
        status: "empty",
        snapshot: null,
        sourceLabel: `${symbol} demo fixture not configured`,
        isFixture: false,
        error: {
          code: "empty",
          message:
            `${symbol} is unavailable because the demo must not reuse the SPY fixture.`,
        },
      };
    }
    return parseSnapshot(
      spyBoundedUiFixture,
      BOUNDED_GAMMA_UI_FIXTURE_PATH,
      true,
    );
  }

  const dataRoot =
    options.dataRoot ??
    join(process.cwd(), "data", "gamma", "providers", "marketdata-app");
  // Prefer helper path when using default root layout.
  const path =
    options.dataRoot !== undefined
      ? boundedGammaLatestPath(symbol, dataRoot)
      : boundedGammaLatestPath(symbol, DEFAULT_BOUNDED_GAMMA_DATA_ROOT);

  if (!existsSync(path)) {
    return {
      status: "empty",
      snapshot: null,
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
      sourceLabel: path,
      isFixture: false,
      error: {
        code: "malformed",
        message: `Bounded gamma snapshot is not valid JSON: ${msg}`,
      },
    };
  }

  return parseSnapshot(raw, path, false);
}
