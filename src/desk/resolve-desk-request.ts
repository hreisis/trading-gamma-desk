import {
  loadMacroDesk,
  type LoadMacroDeskOptions,
  type MacroDeskView,
} from "./load-macro-desk";
import {
  LIVE_DATA_UNAVAILABLE_MESSAGE,
  loadPublicDemoDeskView,
  resolvePublicDemoMode,
} from "./public-demo";

export type DeskSourceQuery = "live" | "fixture" | undefined;

export interface ResolveDeskRequestOptions {
  readonly source?: DeskSourceQuery | string | null;
  readonly publicDemo?: boolean;
  readonly demoQuery?: string | null;
  readonly demoPath?: boolean;
  readonly dataRoot?: string;
  readonly fixturePath?: string;
}

function liveUnavailableView(publicDemo: boolean): MacroDeskView {
  return {
    status: "live_unavailable",
    source: null,
    sourceLabel: null,
    isDemo: false,
    isLiveDriver: false,
    isPublicDemo: publicDemo,
    driver: null,
    driverPath: null,
    snapshotPresent: false,
    snapshotPath: null,
    sessionStale: false,
    pipeline: null,
    error: {
      code: "live_unavailable",
      message: LIVE_DATA_UNAVAILABLE_MESSAGE,
    },
  };
}

/**
 * Resolve page/API query into a desk view.
 *
 * Local (publicDemo=false): unchanged M1-10 filesystem behaviour.
 * Public demo: bundled synthetic fixture only; `?source=live` → live_unavailable.
 */
export function resolveDeskRequest(
  options: ResolveDeskRequestOptions = {},
): MacroDeskView {
  const publicDemo = resolvePublicDemoMode({
    publicDemo: options.publicDemo,
    demoQuery: options.demoQuery,
    demoPath: options.demoPath,
  });
  const source =
    options.source === "live" || options.source === "fixture"
      ? options.source
      : undefined;

  if (publicDemo) {
    if (source === "live") {
      return liveUnavailableView(true);
    }
    // Ignore dataRoot / fixturePath — public demo never opens the filesystem.
    return loadPublicDemoDeskView();
  }

  const loadOptions: LoadMacroDeskOptions = {
    dataRoot: options.dataRoot,
    fixturePath: options.fixturePath,
    preferFixture: source === "fixture",
    allowFixture: source === "fixture",
  };
  const view = loadMacroDesk(loadOptions);
  return { ...view, isPublicDemo: false };
}
